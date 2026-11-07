
(() => {
    "use strict";

    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const messageBox = document.getElementById("message");
    const loginButton = document.getElementById("loginButton");
    const registerButton = document.getElementById("registerButton");

    const API_ORIGIN = ["5184", "7184"].includes(window.location.port)
        ? window.location.origin
        : "http://localhost:5184";

    const AUTH_API = `${API_ORIGIN}/api/auth`;

    // --------------------------------------------------
    // MESSAGE HANDLING
    // --------------------------------------------------

    function showMessage(message, type = "error") {
        messageBox.textContent = message;
        messageBox.className = `message ${type}`;
    }

    function clearMessage() {
        messageBox.textContent = "";
        messageBox.className = "message";
    }

    // --------------------------------------------------
    // FORM NAVIGATION
    // --------------------------------------------------

    function showLogin() {
        loginForm.classList.remove("hidden");
        registerForm.classList.add("hidden");
        clearMessage();

        if (window.location.hash !== "#login") {
            window.history.replaceState(
                {},
                document.title,
                `${window.location.pathname}${window.location.search}#login`
            );
        }
    }

    function showRegister() {
        registerForm.classList.remove("hidden");
        loginForm.classList.add("hidden");
        clearMessage();

        if (window.location.hash !== "#register") {
            window.history.replaceState(
                {},
                document.title,
                `${window.location.pathname}${window.location.search}#register`
            );
        }
    }

    document.getElementById("showRegister").addEventListener("click", e => {
        e.preventDefault();
        showRegister();
    });

    document.getElementById("showLogin").addEventListener("click", e => {
        e.preventDefault();
        showLogin();
    });

    // --------------------------------------------------
    // API ERROR HANDLING
    // --------------------------------------------------

    function getApiError(data, fallback) {
        if (data?.message) {
            return data.message;
        }

        if (Array.isArray(data?.errors) && data.errors.length) {
            return data.errors.join(" ");
        }

        if (data?.errors && typeof data.errors === "object") {
            return Object.values(data.errors).flat().join(" ");
        }

        return fallback;
    }

    async function authRequest(endpoint, payload) {
        let response;

        try {
            response = await fetch(`${AUTH_API}/${endpoint}`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(payload)
            });
        } catch {
            throw new Error(
                `Cannot reach ${API_ORIGIN}. Start EquinoxAI backend and check the API URL.`
            );
        }

        const raw = await response.text();
        let data = {};

        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = { message: raw };
        }

        if (!response.ok) {
            throw new Error(
                getApiError(
                    data,
                    `Request failed with HTTP ${response.status}.`
                )
            );
        }

        return data;
    }

    // --------------------------------------------------
    // VERIFY AUTHENTICATION COOKIE
    // Used after registration only.
    // --------------------------------------------------

    async function verifySession() {
        try {
            const response = await fetch(`${AUTH_API}/me`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Accept": "application/json"
                }
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    // --------------------------------------------------
    // LOGIN
    // --------------------------------------------------

    loginForm.addEventListener("submit", async e => {
        e.preventDefault();
        clearMessage();

        if (!loginForm.reportValidity()) {
            return;
        }

        loginButton.disabled = true;
        loginButton.textContent = "Logging in...";

        try {
            const email =
                document.getElementById("loginEmail").value.trim();

            const password =
                document.getElementById("loginPassword").value;

            await authRequest("login", {
                email,
                password
            });

            showMessage(
                "Login successful. Redirecting...",
                "success"
            );

            setTimeout(() => {
                window.location.replace("/index.html");
            }, 1200);

        } catch (error) {
            showMessage(error.message);

        } finally {
            loginButton.disabled = false;
            loginButton.textContent = "Login";
        }
    });

    // --------------------------------------------------
    // REGISTRATION
    // --------------------------------------------------

    registerForm.addEventListener("submit", async e => {
        e.preventDefault();
        clearMessage();

        if (!registerForm.reportValidity()) {
            return;
        }

        const fullName =
            document.getElementById("registerFullName").value.trim();

        const email =
            document.getElementById("registerEmail").value.trim();

        const password =
            document.getElementById("registerPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        if (fullName.length < 2) {
            showMessage("Full name must contain at least 2 characters.");
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Password and confirmation password do not match.");
            return;
        }

        const passwordPattern =
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;

        if (!passwordPattern.test(password)) {
            showMessage(
                "Password must contain at least 8 characters, including uppercase, lowercase, number, and special character."
            );
            return;
        }

        registerButton.disabled = true;
        registerButton.textContent = "Creating account...";

        try {
            await authRequest("register", {
                fullName,
                email,
                password
            });

            // The backend automatically signs in the new user.
            const authenticated = await verifySession();

            if (!authenticated) {
                showLogin();

                showMessage(
                    "Registration succeeded, but automatic login could not be verified. Please log in."
                );

                return;
            }

            showMessage(
                "Registration successful. You are now logged in.",
                "success"
            );

            setTimeout(() => {
                window.location.replace("/index.html");
            }, 1200);

        } catch (error) {
            showMessage(error.message);

        } finally {
            registerButton.disabled = false;
            registerButton.textContent = "Register";
        }
    });

    // --------------------------------------------------
    // INITIAL FORM SELECTION
    // --------------------------------------------------

    if (window.location.hash === "#register") {
        showRegister();
    } else {
        showLogin();
    }

    // --------------------------------------------------
    // LOGOUT SUCCESS MESSAGE
    // --------------------------------------------------

    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get("loggedOut") === "1") {
        showMessage(
            "You have been logged out successfully.",
            "success"
        );

        window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}#login`
        );
    }

    // --------------------------------------------------
    // IMPORTANT:
    // Do NOT automatically redirect authenticated users
    // from auth.html to index.html.
    //
    // This allows the login page to remain accessible
    // even when an old authentication cookie exists.
    // --------------------------------------------------

})();
