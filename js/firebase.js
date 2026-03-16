// js/firebase.js
// Firebase app initialisation — single source of truth for the whole frontend.
// Other modules import { auth } from './firebase.js' — nothing else needed.
//
// NOTE: Analytics is intentionally omitted; it's not required for the
//       task manager and avoids an unnecessary network call on every load.

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider }
                                from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── App config ────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyC2FXyuECB_CopEQopYoVP3DJ3Ht9A7OBA",
    authDomain:        "taskman4ger.firebaseapp.com",
    projectId:         "taskman4ger",
    storageBucket:     "taskman4ger.firebasestorage.app",
    messagingSenderId: "744282554268",
    appId:             "1:744282554268:web:26fbec8286037f75459259",
    measurementId:     "G-8L869KQFNH"
};

// ── Initialise (idempotent — safe if imported by multiple modules) ─
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// Request the user's email scope so the profile panel can show it
provider.addScope("email");
provider.addScope("profile");

// Force account picker on every login so users can switch accounts
provider.setCustomParameters({ prompt: "select_account" });

export { app, auth, provider };