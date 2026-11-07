
using System.ComponentModel.DataAnnotations;
using EquinoxAI.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace EquinoxAI.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly RoleManager<IdentityRole> _roleManager;
    private readonly SignInManager<ApplicationUser> _signInManager;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        RoleManager<IdentityRole> roleManager,
        SignInManager<ApplicationUser> signInManager)
    {
        _userManager = userManager;
        _roleManager = roleManager;
        _signInManager = signInManager;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        var existingUser = await _userManager.FindByEmailAsync(request.Email);

        if (existingUser != null)
            return Conflict(new { message = "Email is already registered." });

        const string roleName = "User";

        if (!await _roleManager.RoleExistsAsync(roleName))
            return StatusCode(500, new { message = "User role is not configured." });

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            FullName = request.FullName,
            CreatedAtUtc = DateTime.UtcNow,
            IsActive = true
        };

        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Registration failed.",
                errors = result.Errors.Select(e => e.Description)
            });
        }

        var roleResult = await _userManager.AddToRoleAsync(user, roleName);

        if (!roleResult.Succeeded)
        {
            await _userManager.DeleteAsync(user);

            return StatusCode(500, new
            {
                message = "Could not assign user role."
            });
        }

        // Automatically sign in after successful registration.
        await _signInManager.SignInAsync(user, isPersistent: false);

        return Ok(new
        {
            message = "Registration successful. You are now logged in.",
            userId = user.Id,
            fullName = user.FullName,
            email = user.Email,
            role = roleName
        });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        if (user == null || !user.IsActive)
            return Unauthorized(new { message = "Invalid email or password." });

        var result = await _signInManager.PasswordSignInAsync(
            user,
            request.Password,
            isPersistent: false,
            lockoutOnFailure: true);

        if (result.IsLockedOut)
        {
            return StatusCode(423, new
            {
                message = "Account temporarily locked. Try again after 15 minutes."
            });
        }

        if (!result.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });

        return Ok(new
        {
            message = "Login successful.",
            userId = user.Id,
            fullName = user.FullName,
            email = user.Email
        });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await _signInManager.SignOutAsync();

        return Ok(new { message = "Logout successful." });
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await _userManager.GetUserAsync(User);

        if (user == null || !user.IsActive)
        {
            await _signInManager.SignOutAsync();
            return Unauthorized(new { message = "User account is unavailable." });
        }

        return Ok(new
        {
            userId = user.Id,
            fullName = user.FullName,
            email = user.Email,
            isActive = user.IsActive
        });
    }
}

public class RegisterRequest
{
    [Required]
    [StringLength(150, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string Password { get; set; } = string.Empty;
}

public class LoginRequest
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}
