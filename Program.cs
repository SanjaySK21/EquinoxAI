
using EquinoxAI.Data;
using EquinoxAI.Models;
using EquinoxAI.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// --------------------------------------------------
// APPLICATION SERVICES
// --------------------------------------------------

builder.Services.AddDataProtection();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// --------------------------------------------------
// SQL SERVER
// --------------------------------------------------

builder.Services.AddDbContext<StockDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("StockDb")));

// --------------------------------------------------
// ASP.NET CORE IDENTITY
// --------------------------------------------------

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        options.User.RequireUniqueEmail = true;

        options.Password.RequiredLength = 8;
        options.Password.RequiredUniqueChars = 4;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;

        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan =
            TimeSpan.FromMinutes(15);

        options.SignIn.RequireConfirmedAccount = false;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<StockDbContext>()
    .AddSignInManager()
    .AddDefaultTokenProviders();

// --------------------------------------------------
// COOKIE AUTHENTICATION
// --------------------------------------------------

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme =
            IdentityConstants.ApplicationScheme;

        options.DefaultChallengeScheme =
            IdentityConstants.ApplicationScheme;

        options.DefaultSignInScheme =
            IdentityConstants.ApplicationScheme;
    })
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = "EquinoxAI.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy =
            CookieSecurePolicy.SameAsRequest;

        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;

        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode =
                StatusCodes.Status401Unauthorized;

            return Task.CompletedTask;
        };

        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode =
                StatusCodes.Status403Forbidden;

            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

// --------------------------------------------------
// APPLICATION SERVICES
// --------------------------------------------------

builder.Services.AddHttpClient<MarketDataService>();
builder.Services.AddHttpClient<GeminiService>();

builder.Services.AddScoped<StockAnalysisService>();

// --------------------------------------------------
// CORS
// --------------------------------------------------

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
        policy
            .WithOrigins(
                "http://localhost:5184",
                "https://localhost:7184",
                "http://localhost:5000",
                "https://localhost:5001",
                "http://127.0.0.1:5500",
                "http://localhost:5500")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

// --------------------------------------------------
// BUILD APPLICATION
// --------------------------------------------------

var app = builder.Build();

// --------------------------------------------------
// MIDDLEWARE PIPELINE
// IMPORTANT: KEEP THIS ORDER
// --------------------------------------------------

app.UseRouting();

app.UseCors("Frontend");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Authentication must execute before dashboard protection.
app.UseAuthentication();
app.UseAuthorization();

// --------------------------------------------------
// DASHBOARD PROTECTION
// MUST BE BEFORE STATIC FILE MIDDLEWARE
// --------------------------------------------------

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value;

    bool isDashboard =
        (HttpMethods.IsGet(context.Request.Method) ||
         HttpMethods.IsHead(context.Request.Method))
        &&
        (
            string.Equals(
                path,
                "/",
                StringComparison.OrdinalIgnoreCase)
            ||
            string.Equals(
                path,
                "/index.html",
                StringComparison.OrdinalIgnoreCase)
        );

    bool isAuthenticated =
        context.User.Identity?.IsAuthenticated ?? false;

    if (isDashboard && !isAuthenticated)
    {
        context.Response.Redirect("/auth.html");
        return;
    }

    await next();
});

// --------------------------------------------------
// STATIC FILES
// Dashboard protection must remain above these.
// --------------------------------------------------

app.UseDefaultFiles();
app.UseStaticFiles();

// --------------------------------------------------
// API ENDPOINTS
// --------------------------------------------------

app.MapControllers();

app.MapGet("/", () => Results.Redirect("/index.html"));

// --------------------------------------------------
// DATABASE INITIALIZATION
// PRESERVE EXISTING DATA
// --------------------------------------------------

using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("DatabaseStartup");

    try
    {
        var db = scope.ServiceProvider
            .GetRequiredService<StockDbContext>();

        db.Database.EnsureCreated();

        var ensureTablesSql = new[]
        {
            """
            IF OBJECT_ID(N'dbo.PortfolioHoldings', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.PortfolioHoldings
                (
                    Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    Symbol nvarchar(20) NOT NULL,
                    Quantity decimal(18,6) NOT NULL,
                    AverageCost decimal(18,6) NOT NULL,
                    CreatedUtc datetime2 NOT NULL
                );

                CREATE UNIQUE INDEX IX_PortfolioHoldings_Symbol
                ON dbo.PortfolioHoldings(Symbol);
            END
            """,

            """
            IF OBJECT_ID(N'dbo.UniverseStocks', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.UniverseStocks
                (
                    Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    Symbol nvarchar(20) NOT NULL,
                    AddedUtc datetime2 NOT NULL
                );

                CREATE UNIQUE INDEX IX_UniverseStocks_Symbol
                ON dbo.UniverseStocks(Symbol);
            END
            """
        };

        foreach (var sql in ensureTablesSql)
        {
            db.Database.ExecuteSqlRaw(sql);
        }

        // Create the default User role if it does not exist.

        var roleManager = scope.ServiceProvider
            .GetRequiredService<RoleManager<IdentityRole>>();

        const string roleName = "User";

        if (!await roleManager.RoleExistsAsync(roleName))
        {
            var roleResult = await roleManager.CreateAsync(
                new IdentityRole(roleName));

            if (!roleResult.Succeeded)
            {
                var errors = string.Join(
                    "; ",
                    roleResult.Errors.Select(e => e.Description));

                throw new InvalidOperationException(
                    $"Could not create User role: {errors}");
            }

            logger.LogInformation(
                "User role created successfully.");
        }
        else
        {
            logger.LogInformation(
                "User role already exists.");
        }
    }
    catch (Exception ex)
    {
        logger.LogError(
            ex,
            "Could not initialize EquinoxStockDb.");
    }
}

// --------------------------------------------------
// RUN APPLICATION
// --------------------------------------------------

app.Run();
