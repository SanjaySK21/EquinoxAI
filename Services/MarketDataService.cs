using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;

namespace EquinoxAI.Services;

public record MarketSnapshot(string Symbol, decimal? LatestPrice, decimal? Return20DayPercent,
    decimal? AnnualizedVolatility20DayPercent, List<decimal> Closes, List<string> Dates, string? Note);

public class MarketDataService(HttpClient http, IConfiguration config, ILogger<MarketDataService> logger)
{
    private sealed record CachedSeries(List<decimal> Closes, List<string> Dates, DateTime FetchedUtc);

    // Shared by all requests: one cache, one lock per symbol, one rate gate for Twelve Data.
    private static readonly ConcurrentDictionary<string, CachedSeries> Cache = new();
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> SymbolLocks = new();
    private static readonly SemaphoreSlim RateGate = new(1, 1);
    private static readonly Queue<DateTime> CallTimes = new();

    private const int FetchSize = 252;          // always fetch 1 year; 1 credit no matter the size
    private const int MaxCallsPerMinute = 7;    // free plan = 8 per minute, keep 1 spare
    private static readonly TimeSpan MaxRateWait = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan StaleLimit = TimeSpan.FromHours(24);

    public async Task<MarketSnapshot> GetSnapshotAsync(string symbol, CancellationToken ct, int outputSize = 30)
    {
        symbol = symbol.Trim().ToUpperInvariant();
        if (symbol.Length is < 1 or > 10 || !symbol.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-'))
            throw new ArgumentException("Enter a valid ticker symbol (letters, digits, dot or hyphen; max 10 characters).");
        var apiKey = config["MarketData:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("Live market data is not configured. Add MarketData:ApiKey with .NET user-secrets, then restart the app.");

        outputSize = Math.Clamp(outputSize, 5, FetchSize);
        var cacheMinutes = int.TryParse(config["MarketData:CacheMinutes"], out var cm) && cm > 0 ? cm : 30;

        string? staleNote = null;
        var series = GetFresh(symbol, cacheMinutes);
        if (series is null)
        {
            var symbolLock = SymbolLocks.GetOrAdd(symbol, _ => new SemaphoreSlim(1, 1));
            await symbolLock.WaitAsync(ct);
            try
            {
                series = GetFresh(symbol, cacheMinutes); // another request may have filled it while we waited
                if (series is null)
                {
                    try
                    {
                        await WaitForRateSlotAsync(ct);
                        series = await FetchSeriesAsync(symbol, apiKey, ct);
                        Cache[symbol] = series;
                    }
                    catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException)
                    {
                        logger.LogWarning("Twelve Data failed for {Symbol}: {Message}", symbol, ex.Message);
                        if (Cache.TryGetValue(symbol, out var old) && DateTime.UtcNow - old.FetchedUtc < StaleLimit)
                        {
                            series = old;
                            staleNote = $"Showing cached data from {old.FetchedUtc:yyyy-MM-dd HH:mm} UTC. Live refresh failed: {ex.Message}";
                        }
                        else throw;
                    }
                }
            }
            finally { symbolLock.Release(); }
        }
        return BuildSnapshot(symbol, series, outputSize, staleNote);
    }

    private static CachedSeries? GetFresh(string symbol, int minutes) =>
        Cache.TryGetValue(symbol, out var c) && DateTime.UtcNow - c.FetchedUtc < TimeSpan.FromMinutes(minutes) ? c : null;

    private static MarketSnapshot BuildSnapshot(string symbol, CachedSeries series, int outputSize, string? staleNote)
    {
        var closes = series.Closes;
        var metricCloses = closes.TakeLast(Math.Min(21, closes.Count)).ToList();
        decimal? return20 = metricCloses.Count >= 21 && metricCloses[0] != 0 ? (metricCloses[^1] / metricCloses[0] - 1m) * 100m : null;
        decimal? volatility = null;
        if (metricCloses.Count >= 3)
        {
            var returns = metricCloses.Skip(1).Select((v, i) => (double)(v / metricCloses[i] - 1m)).ToArray();
            var avg = returns.Average();
            var variance = returns.Sum(x => Math.Pow(x - avg, 2)) / Math.Max(1, returns.Length - 1);
            volatility = (decimal)(Math.Sqrt(variance) * Math.Sqrt(252) * 100);
        }
        var notes = new List<string>();
        if (closes.Count < 21) notes.Add("Provider returned fewer than 21 daily closes; a full 20-trading-day return is unavailable.");
        if (staleNote is not null) notes.Add(staleNote);
        return new(symbol, closes[^1], return20, volatility,
            closes.TakeLast(outputSize).ToList(), series.Dates.TakeLast(outputSize).ToList(),
            notes.Count > 0 ? string.Join(" ", notes) : null);
    }

    // Allows at most MaxCallsPerMinute calls in any 61-second window. Waits instead of failing.
    private static async Task WaitForRateSlotAsync(CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + MaxRateWait;
        while (true)
        {
            TimeSpan wait;
            await RateGate.WaitAsync(ct);
            try
            {
                var now = DateTime.UtcNow;
                while (CallTimes.Count > 0 && now - CallTimes.Peek() >= TimeSpan.FromSeconds(61)) CallTimes.Dequeue();
                if (CallTimes.Count < MaxCallsPerMinute) { CallTimes.Enqueue(now); return; }
                wait = CallTimes.Peek().AddSeconds(61) - now;
            }
            finally { RateGate.Release(); }
            if (DateTime.UtcNow + wait > deadline)
                throw new InvalidOperationException("Twelve Data free-plan limit reached (8 requests per minute). Wait one minute and refresh.");
            await Task.Delay(wait, ct);
        }
    }

    private async Task<CachedSeries> FetchSeriesAsync(string symbol, string apiKey, CancellationToken ct)
    {
        var baseUrl = (config["MarketData:BaseUrl"] ?? "https://api.twelvedata.com/").TrimEnd('/') + "/";
        var url = $"{baseUrl}time_series?symbol={Uri.EscapeDataString(symbol)}&interval=1day&outputsize={FetchSize}&order=ASC&apikey={Uri.EscapeDataString(apiKey)}";
        string json;
        int statusCode;
        try
        {
            using var response = await http.GetAsync(url, ct);
            statusCode = (int)response.StatusCode;
            json = await response.Content.ReadAsStringAsync(ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new HttpRequestException("Twelve Data request timed out.");
        }

        JsonDocument doc;
        try { doc = JsonDocument.Parse(json); }
        catch (JsonException)
        {
            if (statusCode is < 200 or > 299) throw new HttpRequestException($"Twelve Data time-series request failed with HTTP {statusCode}.");
            throw new InvalidOperationException("Market-data provider returned an invalid response. Try again later.");
        }
        using (doc)
        {
            ThrowIfProviderError(doc.RootElement);
            if (statusCode is < 200 or > 299)
                throw new HttpRequestException($"Twelve Data time-series request failed with HTTP {statusCode}.");

            var closes = new List<decimal>();
            var dates = new List<string>();
            if (doc.RootElement.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in values.EnumerateArray())
                {
                    if (ReadDecimal(item, "close") is decimal close)
                    {
                        closes.Add(close);
                        dates.Add(item.TryGetProperty("datetime", out var dt) ? dt.GetString() ?? "" : "");
                    }
                }
            }
            if (closes.Count < 2)
                throw new InvalidOperationException($"Twelve Data returned insufficient price history for {symbol}. Verify the ticker and provider access.");
            return new CachedSeries(closes, dates, DateTime.UtcNow);
        }
    }

    private static void ThrowIfProviderError(JsonElement root)
    {
        if (root.TryGetProperty("status", out var status) &&
            status.ValueKind == JsonValueKind.String && status.GetString() == "error")
        {
            var message = root.TryGetProperty("message", out var msg) ? msg.GetString() : null;
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(message)
                ? "Twelve Data returned an API error. Check the ticker, API key, and request quota."
                : message);
        }
        if (root.TryGetProperty("code", out var code) && root.TryGetProperty("message", out var errorMessage) &&
            code.ValueKind != JsonValueKind.Null && errorMessage.ValueKind == JsonValueKind.String &&
            !root.TryGetProperty("values", out _))
            throw new InvalidOperationException(errorMessage.GetString() ?? "Twelve Data returned an API error.");
    }

    private static decimal? ReadDecimal(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value)) return null;
        var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        return decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var number) ? number : null;
    }
}