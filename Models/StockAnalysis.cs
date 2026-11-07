
using System.ComponentModel.DataAnnotations;

namespace EquinoxAI.Models;

public class StockAnalysis
{
    public long Id { get; set; }

    // Nullable to preserve existing unassigned records.
    [MaxLength(450)]
    public string? UserId { get; set; }

    public ApplicationUser? User { get; set; }

    [MaxLength(20)]
    public string Symbol { get; set; } = "";

    [MaxLength(120)]
    public string CompanyName { get; set; } = "";

    public decimal? LatestPrice { get; set; }

    public decimal? Return20DayPercent { get; set; }

    public decimal? AnnualizedVolatility20DayPercent { get; set; }

    public int Score { get; set; }

    [MaxLength(10)]
    public string Action { get; set; } = "HOLD";

    [MaxLength(2000)]
    public string Summary { get; set; } = "";

    public string FactorScoresJson { get; set; } = "{}";

    public string MissingFactorsJson { get; set; } = "[]";

    public string? AiExplanation { get; set; }

    [MaxLength(1000)]
    public string? DataNote { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public class WatchlistItem
{
    public int Id { get; set; }

    // Nullable to preserve existing unassigned records.
    [MaxLength(450)]
    public string? UserId { get; set; }

    public ApplicationUser? User { get; set; }

    [MaxLength(20)]
    public string Symbol { get; set; } = "";

    [MaxLength(100)]
    public string? Label { get; set; }

    public DateTime AddedUtc { get; set; } = DateTime.UtcNow;
}

public record AnalyzeRequest(
    string Symbol,
    bool IncludeAiExplanation = true,
    string Horizon = "position");

public class PortfolioHolding
{
    public int Id { get; set; }

    // Nullable to preserve existing unassigned records.
    [MaxLength(450)]
    public string? UserId { get; set; }

    public ApplicationUser? User { get; set; }

    [MaxLength(20)]
    public string Symbol { get; set; } = "";

    [Range(0.000001, 1000000000)]
    public decimal Quantity { get; set; }

    [Range(0.000001, 1000000000)]
    public decimal AverageCost { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public record PortfolioHoldingRequest(
    string Symbol,
    decimal Quantity,
    decimal AverageCost);

// Shared research universe. It is intentionally not user-specific.
public class UniverseStock
{
    public int Id { get; set; }

    [MaxLength(20)]
    public string Symbol { get; set; } = "";

    public DateTime AddedUtc { get; set; } = DateTime.UtcNow;
}

public record UniverseStockRequest(string? Symbol);

