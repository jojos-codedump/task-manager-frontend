// js/auth.js
// Handles:
//   - Route guard: index.html redirects to dashboard if already signed in
//                  dashboard.html redirects to index if NOT signed in
//   - Google sign-in via popup (index.html)
//   - Logout (dashboard.html)
//   - Exports getIdToken() for api.js to attach Bearer tokens

import { auth, provider } from "./firebase.js";
import {
    onAuthStateChanged,
    signInWithPopup,
    signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Page detection ────────────────────────────────────────────
const ON_DASHBOARD = document.getElementById("tasks-panel") !== null;
const ON_LOGIN     = document.getElementById("google-signin-btn") !== null;

// ── Cached user reference (set by onAuthStateChanged) ────────
let _currentUser = null;

// ── Auth state listener ───────────────────────────────────────
// Fires once immediately on page load with the persisted session (or null).
onAuthStateChanged(auth, (user) => {
    _currentUser = user;

    if (ON_LOGIN) {
        // Already signed in → skip the login page
        if (user) {
            window.location.replace("dashboard.html");
        } else {
            // Not signed in → show the login UI (remove loading state if any)
            showLoginUI();
        }
    }

    if (ON_DASHBOARD) {
        if (!user) {
            // Not authenticated → back to login
            window.location.replace("index.html");
        } else {
            // Authenticated → let other modules know they can start
            document.dispatchEvent(new CustomEvent("auth:ready", { detail: { user } }));
        }
    }
});

// ── Login page wiring ─────────────────────────────────────────
if (ON_LOGIN) {
    const btn       = document.getElementById("google-signin-btn");
    const btnText   = document.getElementById("signin-btn-text");
    const errorBox  = document.getElementById("login-error");

    btn?.addEventListener("click", async () => {
        clearError();
        setLoading(true);

        try {
            await signInWithPopup(auth, provider);
            // onAuthStateChanged will fire next and redirect
        } catch (err) {
            setLoading(false);
            showError(friendlyError(err.code));
        }
    });

    function setLoading(on) {
        if (!btn) return;
        btn.disabled = on;
        if (on) {
            btnText.textContent = "Signing in...";
            // Inject spinner if not already present
            if (!btn.querySelector(".btn-spinner")) {
                const spinner = document.createElement("div");
                spinner.className = "btn-spinner";
                btn.prepend(spinner);
            }
        } else {
            btnText.textContent = "Continue with Google";
            btn.querySelector(".btn-spinner")?.remove();
        }
    }

    function showError(msg) {
        if (!errorBox) return;
        errorBox.textContent = msg;
        errorBox.classList.add("visible");
    }

    function clearError() {
        if (!errorBox) return;
        errorBox.textContent = "";
        errorBox.classList.remove("visible");
    }

    function showLoginUI() {
        // Nothing to unhide right now — card is visible by default.
        // Hook here if you add a page-level loading skeleton later.
    }

    // Map Firebase error codes to human-readable messages
    function friendlyError(code) {
        switch (code) {
            case "auth/popup-closed-by-user":
            case "auth/cancelled-popup-request":
                return "Sign-in cancelled. Try again when you're ready.";
            case "auth/popup-blocked":
                return "Popup was blocked — please allow popups for this site.";
            case "auth/network-request-failed":
                return "Network error. Check your connection and try again.";
            case "auth/too-many-requests":
                return "Too many attempts. Please wait a moment and try again.";
            case "auth/user-disabled":
                return "This account has been disabled. Contact support.";
            default:
                return `Sign-in failed (${code ?? "unknown"}). Please try again.`;
        }
    }
}

// ── Dashboard page wiring ─────────────────────────────────────
if (ON_DASHBOARD) {
    document.getElementById("logout-btn")?.addEventListener("click", async () => {
        try {
            await signOut(auth);
            window.location.replace("index.html");
        } catch (err) {
            console.error("Logout failed:", err);
        }
    });
}

// ── Exported helpers ──────────────────────────────────────────

/**
 * Returns the current user's Firebase ID token (refreshes if expired).
 * api.js calls this before every request to get a fresh Bearer token.
 * Throws if called before auth is ready or when user is signed out.
 */
export async function getIdToken() {
    if (!_currentUser) throw new Error("Not authenticated");
    return _currentUser.getIdToken(/* forceRefresh= */ false);
}

/**
 * Returns the current Firebase User object, or null if not signed in.
 * user.js calls this to populate the profile panel.
 */
export function getCurrentUser() {
    return _currentUser;
}