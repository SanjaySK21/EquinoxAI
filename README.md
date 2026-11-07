# Equinox AI — integrated stock research application

This project combines the Equinox web interface and ASP.NET Core 8 backend in one runnable folder. It is designed to show provider-backed data only: when a provider, API key, or database is unavailable, the UI displays an unavailable/error state rather than substituting demo prices or scores.

## Requirements
- .NET 8 SDK
- SQL Server Express/Developer/LocalDB (default connection: `localhost\SQLEXPRESS`)
- Twelve Data API key for daily stock-price history (required for market data and analysis)
- Gemini API key for optional AI explanations (analysis still works without Gemini; its explanation is marked unavailable)

## Run on Windows / VS Code
1. Extract the ZIP.
2. Open the `EquinoxAI` folder containing `EquinoxAI.csproj` in VS Code.
3. Check `ConnectionStrings:StockDb` in `appsettings.json` if your SQL Server instance is different.
4. In the VS Code terminal, run these commands from the `EquinoxAI` folder:

```powershell
dotnet restore
dotnet user-secrets set "MarketData:ApiKey" "YOUR_TWELVE_DATA_KEY"
dotnet user-secrets set "Gemini:ApiKey" "YOUR_GEMINI_API_KEY"
dotnet run
```

Replace each placeholder locally with the actual key. If you do not have a Gemini key yet, skip that command. Do not paste keys into browser JavaScript, `appsettings.json`, screenshots, or chat. Open the URL printed by `dotnet run`, usually `http://localhost:5184/` or `https://localhost:7184/`.

The backend initializes the database schema on startup and creates the portfolio table for an existing local database if needed. If SQL Server cannot be reached, database-backed functions will show errors until the connection is fixed.

## Features and endpoints
- Overview: latest available daily closes, 20-trading-day return/annualized volatility, historical chart, and refresh/export.
- Chart: `GET /api/stock/chart/{symbol}?range=1W|1M|3M|1Y` requests 5, 21, 63, or 252 daily observations respectively. The provider may limit the available history or reject large requests; the UI shows that error.
- Market Pulse: latest available daily closes and price-derived metrics for SPY, QQQ, DIA, IWM, TLT, and GLD. These are labelled ETF proxies, not the actual underlying indexes.
- AI Research: `POST /api/stock/analyze`; saves successful analyses to SQL Server and marks unavailable factors as missing.
- Watchlist: `GET/POST/DELETE /api/stock/watchlist...`, stored in SQL Server.
- Portfolio Lab: `GET/POST /api/stock/portfolio` and `DELETE /api/stock/portfolio/{id}`. Holdings are entered by the user; market value uses the latest available daily close. This is not a brokerage connection.
- Reports: `GET/DELETE /api/stock/history`, stored in SQL Server and exportable as JSON.
- Preferences: API endpoint check and browser-only display preferences.
- Health: `GET /api/stock/health`; Swagger is available at `/swagger` in Development.

## Data scope and limitations
- Market prices are the provider's latest available **daily close**, not a guaranteed real-time/intraday quote.
- Trend, momentum, and volatility are derived from price history. Valuation/quality and sentiment are **not implemented** because no verified fundamentals/sentiment data source is configured; those factors display `N/A` and are not treated as zero.
- The BUY/HOLD/SELL label is a preliminary rule-based indicator derived from available price factors, not financial advice or a prediction.
- Portfolio gain/loss compares the user's entered average cost with provider daily closes; it does not include dividends, fees, taxes, FX, or brokerage transactions.
- Watchlist, portfolio, and report data are SQL Server-backed. UI preferences and the selected API URL are stored in this browser only.
- Provider limits, unsupported symbols, market holidays, and network failures can cause unavailable rows. These are not filled with invented data.

## Verification
After startup, test:
- `/api/stock/health`
- `/api/stock/chart/NVDA?range=1M`
- `/api/stock/universe`
- `/api/stock/market-pulse`
- `/swagger`

The source package was syntax-checked for JavaScript and JSON. A full `dotnet build` must be run on a machine with the .NET 8 SDK and package restore access; the packaging environment does not have the .NET SDK installed, so a successful C# compilation cannot be claimed here.
