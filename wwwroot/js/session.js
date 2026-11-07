(() => {
    "use strict";

    const AUTH_API = `${window.location.origin}/api/auth`;

    const logoutButton = document.getElementById("logoutButton");

    const sidebarUserName =
        document.getElementById("sidebarUserName");

    const sidebarUserEmail =
        document.getElementById("sidebarUserEmail");

    const sidebarUserAvatar =
        document.getElementById("sidebarUserAvatar");

    const topUserAvatar =
        document.getElementById("topUserAvatar");

    let logoutInProgress = false;

    // --------------------------------------------------
    // USER DISPLAY
    // --------------------------------------------------

    function getInitials(fullName, email) {
        const name = String(fullName || "").trim();

        if (name) {
            return name
                .split(/\s+/)
                .slice(0, 2)
                .map(part => part.charAt(0))
                .join("")
                .toUpperCase();
        }

        return String(email || "U")
            .trim()
            .charAt(0)
            .toUpperCase();
    }

    function displayUser(user) {
        const fullName =
            user.fullName || "EquinoxAI User";

        const email =
            user.email || "";

        const initials =
            getInitials(fullName, email);

        if (sidebarUserName) {
            sidebarUserName.textContent = fullName;
        }

        if (sidebarUserEmail) {
            sidebarUserEmail.textContent = email;
        }

        if (sidebarUserAvatar) {
            sidebarUserAvatar.textContent = initials;
        }

        if (topUserAvatar) {
            topUserAvatar.textContent = initials;
        }
    }

    // --------------------------------------------------
    // VERIFY AUTHENTICATED SESSION
    // --------------------------------------------------

    async function verifyDashboardSession() {
        try {
            const response = await fetch(
                `${AUTH_API}/me`,
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

            if (response.status === 401) {
                window.location.replace("/auth.html");
                return;
            }

            if (!response.ok) {
                throw new Error(
                    `Session verification failed: HTTP ${response.status}`
                );
            }

            const user = await response.json();

            displayUser(user);

        } catch (error) {
            console.error(
                "Could not verify the authentication session:",
                error
            );

            if (sidebarUserName) {
                sidebarUserName.textContent =
                    "Account verification unavailable";
            }

            if (sidebarUserEmail) {
                sidebarUserEmail.textContent =
                    "Check backend connection";
            }
        }
    }

    // --------------------------------------------------
    // LOGOUT
    // --------------------------------------------------

    async function logout() {
        if (logoutInProgress || !logoutButton) {
            return;
        }

        const confirmed = window.confirm(
            "Are you sure you want to logout from EquinoxAI?"
        );

        if (!confirmed) {
            return;
        }

        logoutInProgress = true;

        logoutButton.disabled = true;

        logoutButton.innerHTML =
            '<i class="bi bi-hourglass-split"></i><span>Logging out...</span>';

        try {
            const response = await fetch(
                `${AUTH_API}/logout`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

            if (response.status === 401) {
                // The session has already expired or is no longer valid.
                window.location.replace("/auth.html");
                return;
            }

            const rawResponse = await response.text();

            let result = {};

            try {
                result = rawResponse
                    ? JSON.parse(rawResponse)
                    : {};
            } catch {
                result = {
                    message: rawResponse
                };
            }

            if (!response.ok) {
                throw new Error(
                    result.message ||
                    `Logout failed with HTTP ${response.status}.`
                );
            }

            // The backend has signed out the Identity cookie.
            // Return to the login page.
            window.location.replace(
                "/auth.html?loggedOut=1#login"
            );

        } catch (error) {
            console.error("Logout error:", error);

            window.alert(
                "Logout could not be completed.\n\n" +
                error.message +
                "\n\nPlease check that the EquinoxAI backend is running."
            );

            logoutInProgress = false;

            logoutButton.disabled = false;

            logoutButton.innerHTML =
                '<i class="bi bi-box-arrow-right"></i><span>Logout</span>';
        }
    }

    // --------------------------------------------------
    // EVENT LISTENER
    // --------------------------------------------------

    if (logoutButton) {
        logoutButton.addEventListener("click", logout);
    }

    // --------------------------------------------------
    // INITIALIZE DASHBOARD SESSION
    // --------------------------------------------------

    verifyDashboardSession();

})();