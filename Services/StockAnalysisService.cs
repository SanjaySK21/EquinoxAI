
using System.Text.Json;
using EquinoxAI.Data;
using EquinoxAI.Models;
using Microsoft.EntityFrameworkCore;

namespace EquinoxAI.Services;

public class StockAnalysisService(
    MarketDataService market,
    GeminiService gemini,
    StockDbContext db)
{
    public async Task<object> AnalyzeAsync(
        string symbol,
        bool includeAi,
        string horizon,
        string userId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new UnauthorizedAccessException(
                "Authenticated user ID is required.");

        symbol = symbol.Trim().ToUpperInvariant();

        if (symbol.Length is < 1 or > 10 ||
            !symbol.All(c =>
                char.IsAsciiLetterOrDigit(c) || c is '.' or '-'))
        {
            throw new ArgumentException(
                "Enter a valid ticker symbol (letters, digits, dot or hyphen; max 10 characters).");
        }

        horizon = new[] { "swing", "position", "long" }
            .Contains(horizon, StringComparer.OrdinalIgnoreCase)
            ? horizon.ToLowerInvariant()
            : "position";

        var snapshot = await market.GetSnapshotAsync(symbol, ct);

        var trend = ToFactor(
            snapshot.Return20DayPercent is decimal ret
                ? (int)Math.Clamp(Math.Round((double)ret * 2), -100, 100)
                : null);

        var momentum = ToFactor(
            snapshot.Return20DayPercent is decimal m
                ? (int)Math.Clamp(Math.Round((double)m * 2.5), -100, 100)
                : null);

        var risk = ToFactor(
            snapshot.AnnualizedVolatility20DayPercent is decimal vol
                ? (int)Math.Clamp(70 - (double)vol, -100, 100)
                : null);

        var factors = new Dictionary<string, int?>
        {
            ["trend"] = trend,
            ["momentum"] = momentum,
            ["valuation_quality"] = null,
            ["risk"] = risk,
            ["sentiment"] = null
        };

        var weights = new Dictionary<string, double>
        {
            ["trend"] = .30,
            ["momentum"] = .20,
            ["valuation_quality"] = .20,
            ["risk"] = .15,
            ["sentiment"] = .15
        };

        var knownWeight = factors
            .Where(x => x.Value.HasValue)
            .Sum(x => weights[x.Key]);

        if (trend is null && momentum is null)
        {
            throw new InvalidOperationException(
                "At least 21 daily closes are required to calculate a trend-based score. No recommendation was generated.");
        }

        if (knownWeight <= 0)
        {
            throw new InvalidOperationException(
                "Not enough verified daily price history to calculate a score. No recommendation was generated.");
        }

        var score = (int)Math.Round(
            factors
                .Where(x => x.Value.HasValue)
                .Sum(x => x.Value!.Value * weights[x.Key])
            / knownWeight);

        score = Math.Clamp(score, -100, 100);

        var action = score > 25
            ? "BUY"
            : score < -25 ? "SELL" : "HOLD";

        var missing = factors
            .Where(x => !x.Value.HasValue)
            .Select(x => x.Key)
            .ToArray();

        var availableFactors = factors
            .Where(x => x.Value.HasValue)
            .ToDictionary(x => x.Key, x => x.Value!.Value);

        var summary = missing.Length > 0
            ? $"Preliminary {action} signal based only on available price-derived factors. Missing factors: {string.Join(", ", missing)}. The score is renormalized over available factor weights and is not a complete five-factor score."
            : $"Composite score is {score}; current rule maps it to {action}.";

        string? ai = null;
        string? aiError = null;

        if (includeAi)
        {
            try
            {
                var g = await gemini.ExplainAsync(
                    symbol,
                    horizon,
                    snapshot.LatestPrice,
                    snapshot.Return20DayPercent,
                    snapshot.AnnualizedVolatility20DayPercent,
                    score,
                    action,
                    availableFactors,
                    ct);

                ai = g.Text;
                aiError = g.Error;
            }
            catch (Exception ex) when (
                ex is not OperationCanceledException)
            {
                aiError = ex.Message;
            }
        }

        // Save analysis for the authenticated user only.
        var entity = new StockAnalysis
        {
            UserId = userId,
            Symbol = symbol,
            CompanyName = symbol,
            LatestPrice = snapshot.LatestPrice,
            Return20DayPercent = snapshot.Return20DayPercent,
            AnnualizedVolatility20DayPercent =
                snapshot.AnnualizedVolatility20DayPercent,
            Score = score,
            Action = action,
            Summary = summary,
            FactorScoresJson = JsonSerializer.Serialize(factors),
            MissingFactorsJson = JsonSerializer.Serialize(missing),
            AiExplanation = ai,
            DataNote = snapshot.Note,
            CreatedUtc = DateTime.UtcNow
        };

        long? savedId = null;
        string? saveWarning = null;

        try
        {
            db.StockAnalyses.Add(entity);
            await db.SaveChangesAsync(ct);

            savedId = entity.Id;
        }
        catch (Exception ex) when (
            ex is not OperationCanceledException)
        {
            saveWarning =
                "Result was not saved because SQL Server could not save the analysis.";
        }

        // Automatically add the analyzed stock to THIS user's watchlist.
        if (savedId is not null)
        {
            try
            {
                var alreadyTracked = await db.WatchlistItems
                    .AnyAsync(
                        x => x.UserId == userId &&
                             x.Symbol == symbol,
                        ct);

                if (!alreadyTracked)
                {
                    db.WatchlistItems.Add(new WatchlistItem
                    {
                        UserId = userId,
                        Symbol = symbol,
                        AddedUtc = DateTime.UtcNow
                    });

                    await db.SaveChangesAsync(ct);
                }
            }
            catch (Exception ex) when (
                ex is not OperationCanceledException)
            {
                saveWarning = string.Join(
                    " ",
                    new[]
                    {
                        saveWarning,
                        "Analysis saved, but automatic watchlist update failed."
                    }.Where(x => !string.IsNullOrWhiteSpace(x)));
            }
        }

        var combinedNote = string.Join(
            " ",
            new[]
            {
                snapshot.Note,
                saveWarning
            }.Where(s => !string.IsNullOrWhiteSpace(s)));

        return new
        {
            id = savedId,
            symbol,
            companyName = entity.CompanyName,
            researchHorizon = horizon,

            technicalMetrics = new
            {
                latestPrice = snapshot.LatestPrice,
                return20DayPercent = snapshot.Return20DayPercent,
                annualizedVolatility20DayPercent =
                    snapshot.AnnualizedVolatility20DayPercent
            },

            scorecard = new
            {
                complete = missing.Length == 0,
                score,
                action,
                summary,
                factorScores = factors,
                missingFactors = missing
            },

            aiExplanation = ai,

            aiExplanationError =
                includeAi && string.IsNullOrWhiteSpace(ai)
                    ? (aiError ??
                       "AI explanation unavailable. Check Gemini:ApiKey, model access, and provider quota.")
                    : null,

            dataNote = string.IsNullOrWhiteSpace(combinedNote)
                ? null
                : combinedNote,

            disclaimer =
                "Educational information only; not investment advice. Market data may be delayed or incomplete. Verify independently before making financial decisions."
        };
    }

    private static int? ToFactor(int? value) =>
        value is null
            ? null
            : Math.Clamp(value.Value, -100, 100);

    // Analysis history belonging only to the requested user.
    public async Task<List<HistoryDto>> GetHistoryAsync(
        string userId,
        int take,
        CancellationToken ct)
    {
        return await db.StockAnalyses
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedUtc)
            .Take(Math.Clamp(take, 1, 200))
            .Select(x => new HistoryDto(
                x.Id,
                x.Symbol,
                x.LatestPrice,
                x.Return20DayPercent,
                x.AnnualizedVolatility20DayPercent,
                x.Score,
                x.Action,
                x.CreatedUtc,
                x.Summary))
            .ToListAsync(ct);
    }

    // Only the owner can retrieve the full saved analysis.
    public Task<StockAnalysis?> GetHistoryDetailAsync(
        string userId,
        long id,
        CancellationToken ct)
    {
        return db.StockAnalyses
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.Id == id && x.UserId == userId,
                ct);
    }
}

public record HistoryDto(
    long Id,
    string Symbol,
    decimal? LatestPrice,
    decimal? Return20DayPercent,
    decimal? AnnualizedVolatility20DayPercent,
    int Score,
    string Action,
    DateTime CreatedUtc,
    string Summary);
