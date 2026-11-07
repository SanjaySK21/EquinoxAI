
using EquinoxAI.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace EquinoxAI.Data;

public class StockDbContext(
    DbContextOptions<StockDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<StockAnalysis> StockAnalyses => Set<StockAnalysis>();

    public DbSet<WatchlistItem> WatchlistItems => Set<WatchlistItem>();

    public DbSet<PortfolioHolding> PortfolioHoldings => Set<PortfolioHolding>();

    public DbSet<UniverseStock> UniverseStocks => Set<UniverseStock>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ------------------------------------------
        // APPLICATION USER
        // ------------------------------------------

        modelBuilder.Entity<ApplicationUser>(entity =>
        {
            entity.Property(x => x.FullName)
                .HasMaxLength(150)
                .IsRequired();

            entity.Property(x => x.CreatedAtUtc)
                .HasColumnType("datetime2");

            entity.Property(x => x.IsActive)
                .HasDefaultValue(true);
        });

        // ------------------------------------------
        // STOCK ANALYSIS
        // Each new analysis belongs to one user.
        // Existing records may have UserId = NULL.
        // ------------------------------------------

        modelBuilder.Entity<StockAnalysis>(entity =>
        {
            entity.Property(x => x.UserId)
                .HasMaxLength(450);

            entity.Property(x => x.LatestPrice)
                .HasPrecision(18, 6);

            entity.Property(x => x.Return20DayPercent)
                .HasPrecision(18, 6);

            entity.Property(x => x.AnnualizedVolatility20DayPercent)
                .HasPrecision(18, 6);

            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => x.CreatedUtc);

            entity.HasIndex(x => x.Symbol);

            entity.HasIndex(x => new { x.UserId, x.CreatedUtc })
                .HasDatabaseName("IX_StockAnalyses_UserId_CreatedUtc");
        });

        // ------------------------------------------
        // WATCHLIST
        // Same symbol can belong to different users.
        // A user cannot add the same symbol twice.
        // ------------------------------------------

        modelBuilder.Entity<WatchlistItem>(entity =>
        {
            entity.Property(x => x.UserId)
                .HasMaxLength(450);

            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => new { x.UserId, x.Symbol })
                .IsUnique()
                .HasDatabaseName("IX_WatchlistItems_UserId_Symbol");
        });

        // ------------------------------------------
        // PORTFOLIO
        // Each user has their own holdings.
        // Same symbol can exist in multiple users' portfolios.
        // ------------------------------------------

        modelBuilder.Entity<PortfolioHolding>(entity =>
        {
            entity.Property(x => x.UserId)
                .HasMaxLength(450);

            entity.Property(x => x.Quantity)
                .HasPrecision(18, 6);

            entity.Property(x => x.AverageCost)
                .HasPrecision(18, 6);

            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => new { x.UserId, x.Symbol })
                .IsUnique()
                .HasDatabaseName("IX_PortfolioHoldings_UserId_Symbol");
        });

        // ------------------------------------------
        // SHARED STOCK UNIVERSE
        // No UserId. All authorized users share it.
        // ------------------------------------------

        modelBuilder.Entity<UniverseStock>(entity =>
        {
            entity.HasIndex(x => x.Symbol)
                .IsUnique();
        });
    }
}
