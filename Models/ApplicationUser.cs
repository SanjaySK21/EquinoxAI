using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;

namespace EquinoxAI.Models;

public class ApplicationUser : IdentityUser
{
    [Required]
    [MaxLength(150)]
    public string FullName { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public bool IsActive { get; set; } = true;
}