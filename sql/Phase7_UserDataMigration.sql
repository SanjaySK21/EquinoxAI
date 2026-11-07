
USE [EquinoxStockDb];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Verify required tables exist.
IF OBJECT_ID(N'dbo.AspNetUsers', N'U') IS NULL
    THROW 50001, 'AspNetUsers table not found.', 1;

IF OBJECT_ID(N'dbo.StockAnalyses', N'U') IS NULL
    THROW 50002, 'StockAnalyses table not found.', 1;

IF OBJECT_ID(N'dbo.WatchlistItems', N'U') IS NULL
    THROW 50003, 'WatchlistItems table not found.', 1;

IF OBJECT_ID(N'dbo.PortfolioHoldings', N'U') IS NULL
    THROW 50004, 'PortfolioHoldings table not found.', 1;

-- Capture existing record counts.
DECLARE @StockCountBefore BIGINT =
    (SELECT COUNT_BIG(*) FROM dbo.StockAnalyses);

DECLARE @WatchlistCountBefore BIGINT =
    (SELECT COUNT_BIG(*) FROM dbo.WatchlistItems);

DECLARE @PortfolioCountBefore BIGINT =
    (SELECT COUNT_BIG(*) FROM dbo.PortfolioHoldings);

BEGIN TRY

    BEGIN TRANSACTION;

    --------------------------------------------------
    -- 1. ADD USER ID TO STOCK ANALYSES
    --------------------------------------------------

    IF COL_LENGTH('dbo.StockAnalyses', 'UserId') IS NULL
    BEGIN
        ALTER TABLE dbo.StockAnalyses
        ADD UserId NVARCHAR(450) NULL;
    END;

    --------------------------------------------------
    -- 2. ADD USER ID TO WATCHLIST
    --------------------------------------------------

    IF COL_LENGTH('dbo.WatchlistItems', 'UserId') IS NULL
    BEGIN
        ALTER TABLE dbo.WatchlistItems
        ADD UserId NVARCHAR(450) NULL;
    END;

    --------------------------------------------------
    -- 3. ADD USER ID TO PORTFOLIO
    --------------------------------------------------

    IF COL_LENGTH('dbo.PortfolioHoldings', 'UserId') IS NULL
    BEGIN
        ALTER TABLE dbo.PortfolioHoldings
        ADD UserId NVARCHAR(450) NULL;
    END;

    --------------------------------------------------
    -- 4. ADD STOCK ANALYSIS FOREIGN KEY
    --------------------------------------------------

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_StockAnalyses_AspNetUsers_UserId'
    )
    BEGIN
        ALTER TABLE dbo.StockAnalyses
        ADD CONSTRAINT FK_StockAnalyses_AspNetUsers_UserId
        FOREIGN KEY (UserId)
        REFERENCES dbo.AspNetUsers(Id)
        ON DELETE SET NULL;
    END;

    --------------------------------------------------
    -- 5. ADD WATCHLIST FOREIGN KEY
    --------------------------------------------------

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_WatchlistItems_AspNetUsers_UserId'
    )
    BEGIN
        ALTER TABLE dbo.WatchlistItems
        ADD CONSTRAINT FK_WatchlistItems_AspNetUsers_UserId
        FOREIGN KEY (UserId)
        REFERENCES dbo.AspNetUsers(Id)
        ON DELETE SET NULL;
    END;

    --------------------------------------------------
    -- 6. ADD PORTFOLIO FOREIGN KEY
    --------------------------------------------------

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.foreign_keys
        WHERE name = 'FK_PortfolioHoldings_AspNetUsers_UserId'
    )
    BEGIN
        ALTER TABLE dbo.PortfolioHoldings
        ADD CONSTRAINT FK_PortfolioHoldings_AspNetUsers_UserId
        FOREIGN KEY (UserId)
        REFERENCES dbo.AspNetUsers(Id)
        ON DELETE SET NULL;
    END;

    --------------------------------------------------
    -- 7. UPDATE WATCHLIST UNIQUE INDEX
    -- Allow different users to save the same symbol.
    --------------------------------------------------

    IF EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_WatchlistItems_Symbol'
          AND object_id = OBJECT_ID('dbo.WatchlistItems')
    )
    BEGIN
        DROP INDEX IX_WatchlistItems_Symbol
        ON dbo.WatchlistItems;
    END;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_WatchlistItems_UserId_Symbol'
          AND object_id = OBJECT_ID('dbo.WatchlistItems')
    )
    BEGIN
        CREATE UNIQUE INDEX IX_WatchlistItems_UserId_Symbol
        ON dbo.WatchlistItems(UserId, Symbol);
    END;

    --------------------------------------------------
    -- 8. UPDATE PORTFOLIO UNIQUE INDEX
    -- Allow different users to hold the same symbol.
    --------------------------------------------------

    IF EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_PortfolioHoldings_Symbol'
          AND object_id = OBJECT_ID('dbo.PortfolioHoldings')
    )
    BEGIN
        DROP INDEX IX_PortfolioHoldings_Symbol
        ON dbo.PortfolioHoldings;
    END;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_PortfolioHoldings_UserId_Symbol'
          AND object_id = OBJECT_ID('dbo.PortfolioHoldings')
    )
    BEGIN
        CREATE UNIQUE INDEX IX_PortfolioHoldings_UserId_Symbol
        ON dbo.PortfolioHoldings(UserId, Symbol);
    END;

    --------------------------------------------------
    -- 9. ADD STOCK ANALYSIS USER HISTORY INDEX
    --------------------------------------------------

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'IX_StockAnalyses_UserId_CreatedUtc'
          AND object_id = OBJECT_ID('dbo.StockAnalyses')
    )
    BEGIN
        CREATE INDEX IX_StockAnalyses_UserId_CreatedUtc
        ON dbo.StockAnalyses(UserId, CreatedUtc);
    END;

    COMMIT TRANSACTION;

    PRINT 'Phase 7 database migration completed successfully.';

END TRY

BEGIN CATCH

    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    THROW;

END CATCH;

--------------------------------------------------
-- 10. VERIFY EXISTING RECORDS WERE PRESERVED
--------------------------------------------------

SELECT
    'StockAnalyses' AS TableName,
    @StockCountBefore AS RecordsBefore,
    COUNT_BIG(*) AS RecordsAfter
FROM dbo.StockAnalyses

UNION ALL

SELECT
    'WatchlistItems',
    @WatchlistCountBefore,
    COUNT_BIG(*)
FROM dbo.WatchlistItems

UNION ALL

SELECT
    'PortfolioHoldings',
    @PortfolioCountBefore,
    COUNT_BIG(*)
FROM dbo.PortfolioHoldings;

--------------------------------------------------
-- 11. VERIFY USER ID COLUMNS
--------------------------------------------------

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    IS_NULLABLE,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND COLUMN_NAME = 'UserId'
ORDER BY TABLE_NAME;

--------------------------------------------------
-- 12. VERIFY SHARED STOCK UNIVERSE
--------------------------------------------------

SELECT
    TABLE_NAME,
    COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UniverseStocks'
  AND COLUMN_NAME = 'UserId';

-- Expected: zero rows. UniverseStocks remains shared.
