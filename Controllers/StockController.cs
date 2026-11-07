
using System.Security.Claims;
using EquinoxAI.Data;
using EquinoxAI.Models;
using EquinoxAI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EquinoxAI.Controllers;

[ApiController]
[Route("api/stock")]
[Authorize]
public class StockController(
    StockAnalysisService analysis,
    StockDbContext db) : ControllerBase
{
    // Shared built-in research universe.
    private static readonly string[] DefaultUniverse =
    {
        "NVDA", "MSFT", "AAPL", "AMZN", "TSLA"
    };

    private string? CurrentUserId =>
        User.FindFirstValue(ClaimTypes.NameIdentifier);

    private static bool IsValidSymbol(string? symbol) =>
        !string.IsNullOrWhiteSpace(symbol) &&
        symbol.Length <= 10 &&
        symbol.All(c =>
            char.IsAsciiLetterOrDigit(c) || c is '.' or '-');

    // ==================================================
    // HEALTH CHECK - PUBLIC
    // ==================================================

    [AllowAnonymous]
    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken ct)
    {
        return Ok(new
        {
            status = "ok",
            database = await db.Database.CanConnectAsync(ct)
                ? "connected"
                : "unavailable",
            utc = DateTime.UtcNow
        });
    }

    // ==================================================
    // STOCK CHART
    // ==================================================

    [HttpGet("chart/{symbol}")]
    public async Task<IActionResult> Chart(
        string symbol,
        [FromServices] MarketDataService market,
        [FromQuery] string range = "1M",
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return BadRequest(new { message = "Stock symbol is required." });

        try
        {
            var outputSize = range.ToUpperInvariant() switch
            {
                "1W" => 5,
                "1M" => 21,
                "3M" => 63,
                "1Y" => 252,
                _ => 30
            };

            var snapshot = await market.GetSnapshotAsync(
                symbol.Trim().ToUpperInvariant(),
                ct,
                outputSize);

            return Ok(new
            {
                symbol = snapshot.Symbol,
                latestPrice = snapshot.LatestPrice,
                return20DayPercent = snapshot.Return20DayPercent,
                closes = snapshot.Closes,
                dates = snapshot.Dates,
                note = snapshot.Note
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { message = ex.Message });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new
            {
                message = "Market data provider could not be reached. Check the API key and quota."
            });
        }
    }

    // ==================================================
    // STOCK ANALYSIS - SAVED FOR CURRENT USER
    // ==================================================

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze(
        [FromBody] AnalyzeRequest request,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized(new { message = "User authentication is required." });

        if (string.IsNullOrWhiteSpace(request.Symbol))
            return BadRequest(new { message = "Symbol is required." });

        try
        {
            var result = await analysis.AnalyzeAsync(
                request.Symbol,
                request.IncludeAiExplanation,
                request.Horizon,
                userId,
                ct);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { message = ex.Message });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new
            {
                message = "Market data provider could not be reached. Check API key, quota and network."
            });
        }
    }

    // ==================================================
    // ANALYSIS HISTORY - CURRENT USER ONLY
    // ==================================================

    [HttpGet("history")]
    public async Task<IActionResult> History(
        [FromQuery] int take = 50,
        CancellationToken ct = default)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var records = await analysis.GetHistoryAsync(
            userId,
            take,
            ct);

        return Ok(records);
    }

    // Individual analysis - owner only.
    [HttpGet("history/{id:long}")]
    public async Task<IActionResult> HistoryDetail(
        long id,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var record = await analysis.GetHistoryDetailAsync(
            userId,
            id,
            ct);

        if (record is null)
            return NotFound(new { message = "Saved analysis not found." });

        // Do not expose UserId or the complete ApplicationUser entity.
        return Ok(new
        {
            record.Id,
            record.Symbol,
            record.CompanyName,
            record.LatestPrice,
            record.Return20DayPercent,
            record.AnnualizedVolatility20DayPercent,
            record.Score,
            record.Action,
            record.Summary,
            record.FactorScoresJson,
            record.MissingFactorsJson,
            record.AiExplanation,
            record.DataNote,
            record.CreatedUtc
        });
    }

    // Clear only the authenticated user's analysis history.
    [HttpDelete("history")]
    public async Task<IActionResult> ClearHistory(CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        await db.StockAnalyses
            .Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(ct);

        return NoContent();
    }

    // ==================================================
    // WATCHLIST - CURRENT USER ONLY
    // ==================================================

    [HttpGet("watchlist")]
    public async Task<IActionResult> Watchlist(CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var items = await db.WatchlistItems
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderBy(x => x.Symbol)
            .ToListAsync(ct);

        var symbols = items.Select(i => i.Symbol).ToList();

        // Analysis metrics must also belong to this user.
        var analyses = await db.StockAnalyses
            .AsNoTracking()
            .Where(a =>
                a.UserId == userId &&
                symbols.Contains(a.Symbol))
            .OrderByDescending(a => a.CreatedUtc)
            .Select(a => new
            {
                a.Symbol,
                a.LatestPrice,
                a.Score,
                a.Action,
                a.Summary,
                a.CreatedUtc
            })
            .Take(2000)
            .ToListAsync(ct);

        var latest = analyses
            .GroupBy(a => a.Symbol)
            .ToDictionary(g => g.Key, g => g.First());

        return Ok(items.Select(i =>
        {
            latest.TryGetValue(i.Symbol, out var a);

            return new
            {
                i.Id,
                i.Symbol,
                i.Label,
                i.AddedUtc,
                latestPrice = a?.LatestPrice,
                score = a?.Score,
                action = a?.Action,
                summary = a?.Summary,
                lastAnalyzedUtc = a?.CreatedUtc
            };
        }));
    }

    [HttpPost("watchlist")]
    public async Task<IActionResult> AddToWatchlist(
        [FromBody] WatchlistRequest request,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var symbol = request.Symbol?.Trim().ToUpperInvariant();

        if (!IsValidSymbol(symbol))
            return BadRequest(new
            {
                message = "A valid stock symbol is required."
            });

        var existing = await db.WatchlistItems
            .FirstOrDefaultAsync(
                x => x.UserId == userId && x.Symbol == symbol,
                ct);

        if (existing is not null)
            return Ok(new
            {
                existing.Id,
                existing.Symbol,
                existing.Label,
                existing.AddedUtc
            });

        var item = new WatchlistItem
        {
            UserId = userId,
            Symbol = symbol!,
            Label = request.Label?.Trim(),
            AddedUtc = DateTime.UtcNow
        };

        db.WatchlistItems.Add(item);

        await db.SaveChangesAsync(ct);

        return CreatedAtAction(
            nameof(Watchlist),
            new { },
            new
            {
                item.Id,
                item.Symbol,
                item.Label,
                item.AddedUtc
            });
    }

    [HttpDelete("watchlist/{symbol}")]
    public async Task<IActionResult> RemoveFromWatchlist(
        string symbol,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var item = await db.WatchlistItems
            .FirstOrDefaultAsync(
                x => x.UserId == userId &&
                     x.Symbol == symbol.Trim().ToUpperInvariant(),
                ct);

        if (item is null)
            return NotFound(new
            {
                message = "Watchlist item not found."
            });

        db.WatchlistItems.Remove(item);

        await db.SaveChangesAsync(ct);

        return NoContent();
    }

    // ==================================================
    // SHARED RESEARCH UNIVERSE
    // All authenticated users can access the same universe.
    // ==================================================

    [HttpGet("universe")]
    public async Task<IActionResult> Universe(
        [FromServices] MarketDataService market,
        CancellationToken ct)
    {
        List<string> custom;

        try
        {
            custom = await db.UniverseStocks
                .OrderBy(x => x.AddedUtc)
                .Select(x => x.Symbol)
                .ToListAsync(ct);
        }
        catch (Exception ex) when (
            ex is not OperationCanceledException)
        {
            custom = new List<string>();
        }

        var symbols = DefaultUniverse
            .Concat(custom.Where(s => !DefaultUniverse.Contains(s)))
            .ToList();

        var rows = new List<object>();

        foreach (var symbol in symbols)
        {
            ct.ThrowIfCancellationRequested();

            var isCustom = !DefaultUniverse.Contains(symbol);

            try
            {
                var snap = await market.GetSnapshotAsync(
                    symbol,
                    ct,
                    30);

                rows.Add(new
                {
                    symbol,
                    isCustom,
                    price = snap.LatestPrice,
                    return20DayPercent = snap.Return20DayPercent,
                    volatilityPercent = snap.AnnualizedVolatility20DayPercent,
                    dataNote = snap.Note
                });
            }
            catch (Exception ex) when (
                ex is InvalidOperationException or HttpRequestException)
            {
                rows.Add(new
                {
                    symbol,
                    isCustom,
                    error = ex.Message
                });
            }
        }

        return Ok(new
        {
            asOfUtc = DateTime.UtcNow,
            rows
        });
    }

    [HttpPost("universe")]
    public async Task<IActionResult> AddUniverseStock(
        [FromBody] UniverseStockRequest request,
        [FromServices] MarketDataService market,
        CancellationToken ct)
    {
        var symbol = request.Symbol?.Trim().ToUpperInvariant();

        if (!IsValidSymbol(symbol))
        {
            return BadRequest(new
            {
                message = "Enter a valid ticker symbol (letters, digits, dot or hyphen; max 10 characters)."
            });
        }

        if (DefaultUniverse.Contains(symbol!) ||
            await db.UniverseStocks.AnyAsync(
                x => x.Symbol == symbol,
                ct))
        {
            return Conflict(new
            {
                message = $"{symbol} is already in the research universe."
            });
        }

        try
        {
            await market.GetSnapshotAsync(symbol!, ct, 30);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { message = ex.Message });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new
            {
                message = "Market-data provider could not be reached. Check API key, quota and network."
            });
        }

        var item = new UniverseStock
        {
            Symbol = symbol!,
            AddedUtc = DateTime.UtcNow
        };

        db.UniverseStocks.Add(item);

        await db.SaveChangesAsync(ct);

        return Ok(new
        {
            item.Id,
            item.Symbol
        });
    }

    [HttpDelete("universe/{symbol}")]
    public async Task<IActionResult> RemoveUniverseStock(
        string symbol,
        CancellationToken ct)
    {
        symbol = symbol.Trim().ToUpperInvariant();

        if (DefaultUniverse.Contains(symbol))
        {
            return BadRequest(new
            {
                message = "Default stocks cannot be removed."
            });
        }

        var item = await db.UniverseStocks
            .FirstOrDefaultAsync(x => x.Symbol == symbol, ct);

        if (item is null)
        {
            return NotFound(new
            {
                message = $"{symbol} is not in the custom universe."
            });
        }

        db.UniverseStocks.Remove(item);

        await db.SaveChangesAsync(ct);

        return NoContent();
    }

    // ==================================================
    // MARKET PULSE - SHARED MARKET DATA
    // ==================================================

    [HttpGet("market-pulse")]
    public async Task<IActionResult> MarketPulse(
        [FromServices] MarketDataService market,
        CancellationToken ct)
    {
        var symbols = new[]
        {
            "SPY", "QQQ", "DIA", "IWM", "TLT", "GLD"
        };

        var rows = new List<object>();

        foreach (var symbol in symbols)
        {
            ct.ThrowIfCancellationRequested();

            try
            {
                var snap = await market.GetSnapshotAsync(
                    symbol,
                    ct,
                    30);

                rows.Add(new
                {
                    symbol,
                    price = snap.LatestPrice,
                    return20DayPercent = snap.Return20DayPercent,
                    volatilityPercent = snap.AnnualizedVolatility20DayPercent,
                    dataNote = snap.Note
                });
            }
            catch (Exception ex) when (
                ex is InvalidOperationException or HttpRequestException)
            {
                rows.Add(new
                {
                    symbol,
                    error = ex.Message
                });
            }
        }

        return Ok(new
        {
            asOfUtc = DateTime.UtcNow,
            rows
        });
    }

    // ==================================================
    // PORTFOLIO - CURRENT USER ONLY
    // ==================================================

    [HttpGet("portfolio")]
    public async Task<IActionResult> Portfolio(
        [FromServices] MarketDataService market,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var holdings = await db.PortfolioHoldings
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderBy(x => x.Symbol)
            .ToListAsync(ct);

        var rows = new List<object>();

        decimal totalValue = 0;
        decimal totalCost = holdings.Sum(
            h => h.AverageCost * h.Quantity);

        var missingPrice = false;

        foreach (var h in holdings)
        {
            try
            {
                var snap = await market.GetSnapshotAsync(
                    h.Symbol,
                    ct,
                    30);

                if (snap.LatestPrice is not decimal price)
                {
                    missingPrice = true;

                    rows.Add(new
                    {
                        h.Id,
                        h.Symbol,
                        h.Quantity,
                        h.AverageCost,
                        error = "Latest verified price is unavailable."
                    });

                    continue;
                }

                var currentValue = price * h.Quantity;
                var cost = h.AverageCost * h.Quantity;

                totalValue += currentValue;

                rows.Add(new
                {
                    h.Id,
                    h.Symbol,
                    h.Quantity,
                    h.AverageCost,
                    price,
                    currentValue,
                    costBasis = cost,
                    gainLoss = currentValue - cost,
                    gainLossPercent = cost == 0
                        ? (decimal?)null
                        : (currentValue / cost - 1) * 100,
                    dataNote = snap.Note
                });
            }
            catch (Exception ex) when (
                ex is InvalidOperationException or HttpRequestException)
            {
                missingPrice = true;

                rows.Add(new
                {
                    h.Id,
                    h.Symbol,
                    h.Quantity,
                    h.AverageCost,
                    error = ex.Message
                });
            }
        }

        decimal? verifiedTotalValue =
            missingPrice ? null : totalValue;

        decimal? gainLoss =
            verifiedTotalValue.HasValue
                ? verifiedTotalValue.Value - totalCost
                : null;

        return Ok(new
        {
            rows,
            totalValue = verifiedTotalValue,
            totalCost,
            gainLoss,
            gainLossPercent =
                !verifiedTotalValue.HasValue || totalCost == 0
                    ? (decimal?)null
                    : (verifiedTotalValue.Value / totalCost - 1) * 100,
            asOfUtc = DateTime.UtcNow,
            note = "Market value uses current provider prices. Gain/loss compares against the average cost you entered; this is not a brokerage connection."
        });
    }

    [HttpPost("portfolio")]
    public async Task<IActionResult> AddPortfolioHolding(
        [FromBody] PortfolioHoldingRequest request,
        [FromServices] MarketDataService market,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        var symbol = request.Symbol?.Trim().ToUpperInvariant();

        if (!IsValidSymbol(symbol) ||
            request.Quantity <= 0 ||
            request.AverageCost <= 0)
        {
            return BadRequest(new
            {
                message = "Enter a valid ticker, positive quantity, and positive average cost."
            });
        }

        var exists = await db.PortfolioHoldings
            .AnyAsync(
                x => x.UserId == userId &&
                     x.Symbol == symbol,
                ct);

        if (exists)
        {
            return Conflict(new
            {
                message = $"{symbol} is already in your portfolio. Remove it before adding it again."
            });
        }

        try
        {
            await market.GetSnapshotAsync(symbol!, ct, 30);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { message = ex.Message });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new
            {
                message = "Market-data provider could not be reached. Check API key, quota and network."
            });
        }

        var holding = new PortfolioHolding
        {
            UserId = userId,
            Symbol = symbol!,
            Quantity = request.Quantity,
            AverageCost = request.AverageCost,
            CreatedUtc = DateTime.UtcNow
        };

        db.PortfolioHoldings.Add(holding);

        await db.SaveChangesAsync(ct);

        return CreatedAtAction(
            nameof(Portfolio),
            new { },
            new
            {
                holding.Id,
                holding.Symbol,
                holding.Quantity,
                holding.AverageCost
            });
    }

    [HttpDelete("portfolio/{id:int}")]
    public async Task<IActionResult> RemovePortfolioHolding(
        int id,
        CancellationToken ct)
    {
        var userId = CurrentUserId;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized();

        // The owner ID is part of the query.
        // Another user's holding can never be deleted here.
        var item = await db.PortfolioHoldings
            .FirstOrDefaultAsync(
                x => x.Id == id && x.UserId == userId,
                ct);

        if (item is null)
        {
            return NotFound(new
            {
                message = "Portfolio holding not found."
            });
        }

        db.PortfolioHoldings.Remove(item);

        await db.SaveChangesAsync(ct);

        return NoContent();
    }
}

public record WatchlistRequest(
    string? Symbol,
    string? Label = null);
