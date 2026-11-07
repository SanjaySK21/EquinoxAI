
using System.Net;
using System.Text;
using System.Text.Json;

namespace EquinoxAI.Services;

public record GeminiResult(string? Text, string? Error);

public class GeminiService(
    HttpClient http,
    IConfiguration config,
    ILogger<GeminiService> logger)
{
    private const int MaxAttemptsPerModel = 3;

    private const string DefaultModel = "gemini-3.5-flash-lite";
    private const string DefaultFallbackModel = "gemini-3.8-flash";

    public async Task<GeminiResult> ExplainAsync(
        string symbol,
        string horizon,
        decimal? price,
        decimal? return20,
        decimal? volatility,
        int score,
        string action,
        IReadOnlyDictionary<string, int> factors,
        CancellationToken ct)
    {
        // --------------------------------------------------
        // API KEY
        // --------------------------------------------------

        var key = config["Gemini:ApiKey"];

        if (string.IsNullOrWhiteSpace(key))
        {
            return new(
                null,
                "Gemini API key is not configured. Set Gemini:ApiKey using .NET User Secrets."
            );
        }

        // --------------------------------------------------
        // MODEL CONFIGURATION
        // --------------------------------------------------

        var baseUrl = (
            config["Gemini:BaseUrl"]
            ?? "https://generativelanguage.googleapis.com/v1beta/models"
        ).TrimEnd('/');

        var primaryModel =
            config["Gemini:Model"] ?? DefaultModel;

        var fallbackModel =
            config["Gemini:FallbackModel"] ?? DefaultFallbackModel;

        var models = new[]
        {
            primaryModel,
            fallbackModel
        }
        .Where(x => !string.IsNullOrWhiteSpace(x))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

        // --------------------------------------------------
        // PROMPT
        // --------------------------------------------------

        var prompt =
            $"""
            Explain this educational stock-analysis output in plain language.

            Include:
            - Main positive and negative signals.
            - Important risk considerations.
            - Limitations of the available data.
            - A clear explanation of the model score.

            Do not make guaranteed predictions.
            Do not present this as personalized financial advice.

            Stock symbol: {symbol}
            Requested research horizon: {horizon}
            Latest available daily close: {price}
            20-day return (%): {return20}
            Annualized volatility (%): {volatility}
            Composite score: {score}/100
            Action label: {action}
            Factor scores: {JsonSerializer.Serialize(factors)}

            Mention that valuation, sentiment and fundamental information
            may be missing.

            Keep the explanation under 250 words.
            """;

        var payload = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[]
                    {
                        new { text = prompt }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.3,
                maxOutputTokens = 700
            }
        };

        var body = JsonSerializer.Serialize(payload);

        string lastError = "Gemini request failed.";

        // --------------------------------------------------
        // PRIMARY MODEL AND FALLBACK MODEL
        // --------------------------------------------------

        foreach (var model in models)
        {
            var endpoint =
                $"{baseUrl}/{Uri.EscapeDataString(model)}:generateContent";

            logger.LogInformation(
                "Starting Gemini request using model {Model}.",
                model);

            for (var attempt = 1;
                 attempt <= MaxAttemptsPerModel;
                 attempt++)
            {
                try
                {
                    using var request = new HttpRequestMessage(
                        HttpMethod.Post,
                        endpoint)
                    {
                        Content = new StringContent(
                            body,
                            Encoding.UTF8,
                            "application/json")
                    };

                    request.Headers.TryAddWithoutValidation(
                        "x-goog-api-key",
                        key);

                    using var response = await http.SendAsync(
                        request,
                        HttpCompletionOption.ResponseHeadersRead,
                        ct);

                    var responseText =
                        await response.Content.ReadAsStringAsync(ct);

                    // --------------------------------------
                    // SUCCESS
                    // --------------------------------------

                    if (response.IsSuccessStatusCode)
                    {
                        var generatedText = ExtractText(
                            responseText,
                            out var finishReason);

                        if (!string.IsNullOrWhiteSpace(generatedText))
                        {
                            logger.LogInformation(
                                "Gemini explanation generated using {Model}.",
                                model);

                            return new(generatedText.Trim(), null);
                        }

                        lastError =
                            $"Gemini model {model} returned no text. Finish reason: {finishReason ?? "unknown"}.";

                        logger.LogWarning("{Error}", lastError);

                        // A successful HTTP response without
                        // generated text is not an overload error.
                        return new(null, lastError);
                    }

                    // --------------------------------------
                    // FAILURE
                    // --------------------------------------

                    var statusCode = response.StatusCode;

                    lastError =
                        $"Gemini HTTP {(int)statusCode} from model {model}: {ExtractError(responseText)}";

                    logger.LogWarning(
                        "Gemini model {Model}, attempt {Attempt}/{MaxAttempts}, returned HTTP {StatusCode}: {Error}",
                        model,
                        attempt,
                        MaxAttemptsPerModel,
                        (int)statusCode,
                        ExtractError(responseText));

                    // --------------------------------------
                    // RATE LIMIT
                    // --------------------------------------

                    if (statusCode == HttpStatusCode.TooManyRequests)
                    {
                        if (attempt < MaxAttemptsPerModel)
                        {
                            var delay = GetRetryDelay(
                                response,
                                attempt);

                            logger.LogInformation(
                                "Gemini rate limit encountered. Retrying in {DelaySeconds} seconds.",
                                delay.TotalSeconds);

                            await Task.Delay(delay, ct);
                            continue;
                        }

                        // A quota/rate-limit error should be
                        // reported rather than repeatedly switching
                        // models for the same exhausted quota.
                        return new(null, lastError);
                    }

                    // --------------------------------------
                    // TEMPORARY SERVER ERRORS
                    // --------------------------------------

                    if (IsTemporaryServerError(statusCode))
                    {
                        if (attempt < MaxAttemptsPerModel)
                        {
                            var delay = GetRetryDelay(
                                response,
                                attempt);

                            logger.LogInformation(
                                "Gemini service temporarily unavailable. Retrying in {DelaySeconds} seconds.",
                                delay.TotalSeconds);

                            await Task.Delay(delay, ct);
                            continue;
                        }

                        // All attempts for this model failed.
                        // Move to the configured fallback model.
                        logger.LogWarning(
                            "All retries failed for Gemini model {Model}. Trying the next configured model.",
                            model);

                        break;
                    }

                    // --------------------------------------
                    // MODEL NOT FOUND
                    // --------------------------------------

                    if (statusCode == HttpStatusCode.NotFound)
                    {
                        logger.LogWarning(
                            "Gemini model {Model} was not found. Trying the next configured model.",
                            model);

                        break;
                    }

                    // --------------------------------------
                    // OTHER ERRORS
                    // --------------------------------------

                    // For example:
                    // 401 = invalid/expired API key
                    // 403 = permission or project restriction
                    // 400 = invalid request
                    //
                    // Switching models will not normally fix these.
                    return new(null, lastError);
                }
                catch (TaskCanceledException)
                    when (!ct.IsCancellationRequested)
                {
                    lastError =
                        $"Gemini request timed out for model {model}.";

                    logger.LogWarning("{Error}", lastError);

                    break;
                }
                catch (HttpRequestException ex)
                {
                    lastError =
                        $"Could not reach Gemini: {ex.Message}";

                    logger.LogError(ex, "{Error}", lastError);

                    break;
                }
            }
        }

        // --------------------------------------------------
        // ALL MODELS FAILED
        // --------------------------------------------------

        logger.LogError(
            "Gemini explanation could not be generated. {Error}",
            lastError);

        return new(
            null,
            lastError +
            " Both configured Gemini model attempts were unsuccessful. Please try again later."
        );
    }

    // ------------------------------------------------------
    // RETRYABLE SERVER ERRORS
    // ------------------------------------------------------

    private static bool IsTemporaryServerError(
        HttpStatusCode statusCode)
    {
        return statusCode is
            HttpStatusCode.RequestTimeout or
            HttpStatusCode.InternalServerError or
            HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or
            HttpStatusCode.GatewayTimeout;
    }

    // ------------------------------------------------------
    // EXPONENTIAL BACKOFF
    // ------------------------------------------------------

    private static TimeSpan GetRetryDelay(
        HttpResponseMessage response,
        int attempt)
    {
        var retryAfter = response.Headers.RetryAfter;

        if (retryAfter?.Delta is TimeSpan delta &&
            delta > TimeSpan.Zero)
        {
            return TimeSpan.FromSeconds(
                Math.Min(delta.TotalSeconds, 15));
        }

        if (retryAfter?.Date is DateTimeOffset retryDate)
        {
            var wait = retryDate - DateTimeOffset.UtcNow;

            if (wait > TimeSpan.Zero)
            {
                return TimeSpan.FromSeconds(
                    Math.Min(wait.TotalSeconds, 15));
            }
        }

        // Attempt 1: 2 seconds
        // Attempt 2: 4 seconds
        return TimeSpan.FromSeconds(Math.Pow(2, attempt));
    }

    // ------------------------------------------------------
    // EXTRACT GENERATED TEXT
    // ------------------------------------------------------

    private static string? ExtractText(
        string json,
        out string? finishReason)
    {
        finishReason = null;

        try
        {
            using var doc = JsonDocument.Parse(json);

            if (!doc.RootElement.TryGetProperty(
                    "candidates",
                    out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                return null;
            }

            var first = candidates[0];

            if (first.TryGetProperty(
                    "finishReason",
                    out var fr) &&
                fr.ValueKind == JsonValueKind.String)
            {
                finishReason = fr.GetString();
            }

            if (!first.TryGetProperty(
                    "content",
                    out var content) ||
                !content.TryGetProperty(
                    "parts",
                    out var parts) ||
                parts.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var result = new StringBuilder();

            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty(
                        "thought",
                        out var thought) &&
                    thought.ValueKind == JsonValueKind.True)
                {
                    continue;
                }

                if (part.TryGetProperty(
                        "text",
                        out var text) &&
                    text.ValueKind == JsonValueKind.String)
                {
                    result.Append(text.GetString());
                }
            }

            return result.ToString();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ------------------------------------------------------
    // EXTRACT PROVIDER ERROR
    // ------------------------------------------------------

    private static string ExtractError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);

            if (doc.RootElement.TryGetProperty(
                    "error",
                    out var error))
            {
                if (error.TryGetProperty(
                        "message",
                        out var message))
                {
                    var result =
                        message.GetString() ?? "Unknown Gemini error.";

                    return result.Length > 300
                        ? result[..300] + "..."
                        : result;
                }
            }
        }
        catch (JsonException)
        {
            // Return the generic error below.
        }

        return "Unknown Gemini provider error.";
    }
}
