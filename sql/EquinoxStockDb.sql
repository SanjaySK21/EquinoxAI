/* Run this script in SQL Server Management Studio (SSMS) as an alternative to EF EnsureCreated.
   If the app already created these tables, do not run this script again. */
IF DB_ID(N'EquinoxStockDb') IS NULL CREATE DATABASE EquinoxStockDb;
GO
USE EquinoxStockDb;
GO
IF OBJECT_ID(N'dbo.StockAnalyses', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.StockAnalyses (
   Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StockAnalyses PRIMARY KEY,
   Symbol NVARCHAR(20) NOT NULL,
   CompanyName NVARCHAR(120) NOT NULL,
   LatestPrice DECIMAL(18,4) NULL,
   Return20DayPercent DECIMAL(18,4) NULL,
   AnnualizedVolatility20DayPercent DECIMAL(18,4) NULL,
   Score INT NOT NULL,
   Action NVARCHAR(10) NOT NULL,
   Summary NVARCHAR(2000) NOT NULL,
   FactorScoresJson NVARCHAR(MAX) NOT NULL,
   MissingFactorsJson NVARCHAR(MAX) NOT NULL,
   AiExplanation NVARCHAR(MAX) NULL,
   DataNote NVARCHAR(1000) NULL,
   CreatedUtc DATETIME2 NOT NULL
 );
 CREATE INDEX IX_StockAnalyses_CreatedUtc ON dbo.StockAnalyses(CreatedUtc);
 CREATE INDEX IX_StockAnalyses_Symbol ON dbo.StockAnalyses(Symbol);
END;
GO
IF OBJECT_ID(N'dbo.WatchlistItems', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WatchlistItems (
   Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WatchlistItems PRIMARY KEY,
   Symbol NVARCHAR(20) NOT NULL,
   Label NVARCHAR(100) NULL,
   AddedUtc DATETIME2 NOT NULL
 );
 CREATE UNIQUE INDEX IX_WatchlistItems_Symbol ON dbo.WatchlistItems(Symbol);
END;
GO

IF OBJECT_ID(N'dbo.PortfolioHoldings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PortfolioHoldings (
        Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Symbol nvarchar(20) NOT NULL,
        Quantity decimal(18,6) NOT NULL,
        AverageCost decimal(18,6) NOT NULL,
        CreatedUtc datetime2 NOT NULL CONSTRAINT DF_PortfolioHoldings_CreatedUtc DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX IX_PortfolioHoldings_Symbol ON dbo.PortfolioHoldings(Symbol);
END;
GO

IF OBJECT_ID(N'dbo.UniverseStocks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UniverseStocks (
        Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Symbol nvarchar(20) NOT NULL,
        AddedUtc datetime2 NOT NULL CONSTRAINT DF_UniverseStocks_AddedUtc DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX IX_UniverseStocks_Symbol ON dbo.UniverseStocks(Symbol);
END;