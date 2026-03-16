// js/user.js
// Owns the Profile panel (#user-profile / #user-stats).
//
// Renders on:
//   - "auth:ready"    (initial page load)
//   - "tasks:updated" (after any task mutation — XP / level may have changed)
//
// Data sources:
//   - getCurrentUser()  from auth.js  → displayName, email, photoURL
//   - getXPSummary()    from api.js   → total_xp, level, by_category counts

import { getCurrentUser } from "./auth.js";
import { getXPSummary }   from "./api.js";
import { toastError, showSkeleton } from "./ui.js";

// ── DOM ref ───────────────────────────────────────────────────
const userStats = document.getElementById("user-stats");


// ═══════════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════════

// Cache the Firebase user from the auth:ready event detail so that
// tasks:updated (which carries no user payload) can still access it.
let _cachedUser = null;

document.addEventListener("auth:ready", (e) => {
    _cachedUser = e.detail?.user ?? getCurrentUser();
    _loadProfile();
});

document.addEventListener("tasks:updated", () => {
    _loadProfile();
});


// ═══════════════════════════════════════════════════════════════
//  Load + render
// ═══════════════════════════════════════════════════════════════

async function _loadProfile() {
    if (!userStats) return;

    showSkeleton(userStats, 4, "76px");

    // Use the cached user; never silently bail with skeleton still showing.
    const user = _cachedUser ?? getCurrentUser();
    if (!user) {
        console.warn("[user] no user available -- retrying in 1s");
        setTimeout(_loadProfile, 1000);
        return;
    }

    let summary;
    try {
        summary = await getXPSummary();
    } catch (err) {
        toastError("Could not load profile stats.");
        console.error("[user] getXPSummary failed:", err);
        _renderError();
        return;
    }

    _renderProfile(user, summary);
}


// ═══════════════════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════════════════

function _renderProfile(user, summary) {
    const { total_xp, level: lvl, by_category } = summary;

    // ── Derived values ───────────────────────────────────────
    const levelNum    = lvl.level;
    const xpInto      = lvl.xp_into_level;
    const xpToNext    = lvl.xp_to_next;
    const progressPct = lvl.progress_pct;

    // Task counts from by_category (XP = 0 means 0 done tasks for General,
    // but we don't have task counts here — show total XP per category instead)
    const totalDoneXP  = total_xp;

    // ── Display name: prefer Firebase display name, fall back to email prefix
    const displayName = user.displayName
        ?? user.email?.split("@")[0]
        ?? "Commander";

    // ── Avatar HTML ─────────────────────────────────────────
    const avatarHTML = user.photoURL
        ? `<img src="${user.photoURL}"
                alt="${_esc(displayName)}'s avatar"
                referrerpolicy="no-referrer"
                crossorigin="anonymous"
                style="width:44px;height:44px;border-radius:50%;
                       border:2px solid rgba(168,85,247,0.45);
                       box-shadow:0 0 10px rgba(139,92,246,0.40);
                       object-fit:cover;display:block;">`
        : `<div style="width:44px;height:44px;border-radius:50%;
                       background:linear-gradient(135deg,var(--p3),var(--p2));
                       border:2px solid rgba(168,85,247,0.45);
                       box-shadow:0 0 10px rgba(139,92,246,0.40);
                       display:flex;align-items:center;justify-content:center;
                       font-size:1.2rem;font-weight:700;color:#fff;
                       font-family:'Orbitron',sans-serif;">
               ${_esc(displayName[0].toUpperCase())}
           </div>`;

    // ── Level title ─────────────────────────────────────────
    const levelTitle = _levelTitle(levelNum);

    // ── Stat cards ───────────────────────────────────────────
    const stats = [
        { icon: "👤", value: _shortName(displayName), label: "Operator" },
        { icon: "⚡", value: `Lv ${levelNum}`,          label: levelTitle },
        { icon: "✨", value: _fmtXP(totalDoneXP),       label: "Total XP" },
        { icon: "🎯", value: _fmtXP(xpToNext),          label: "To Next Level" },
    ];

    const statsHTML = stats.map(s => `
        <div class="stat">
            <div class="stat-icon" aria-hidden="true">${s.icon}</div>
            <div class="stat-value">${_esc(String(s.value))}</div>
            <div class="stat-label">${s.label}</div>
        </div>`
    ).join("");

    // ── XP bar ───────────────────────────────────────────────
    const xpBarHTML = `
        <div class="xp-bar-container" style="grid-column:1/-1">
            <div class="xp-bar-label">
                <span>
                    ${avatarHTML.includes("img")
                        ? `<span style="vertical-align:middle;">${_esc(displayName)}</span>`
                        : `<span style="vertical-align:middle;">${_esc(displayName)}</span>`
                    }
                    &nbsp;·&nbsp; Level ${levelNum}
                </span>
                <span>${_fmtXP(xpInto)} / ${_fmtXP(xpInto + xpToNext)} XP</span>
            </div>
            <div class="xp-bar" role="progressbar"
                 aria-valuenow="${Math.round(progressPct)}"
                 aria-valuemin="0" aria-valuemax="100"
                 aria-label="XP progress to next level">
                <div class="xp-bar-fill"
                     style="width:${progressPct.toFixed(2)}%"></div>
            </div>
        </div>`;

    // ── Avatar card (replaces first stat on larger screens) ──
    // We slot the avatar inline as a stat-like card so it sits
    // naturally in the auto-fit grid without breaking layout.
    const avatarCardHTML = `
        <div class="stat" style="display:flex;flex-direction:column;
             align-items:center;justify-content:center;gap:0.4rem;">
            ${avatarHTML}
            <div class="stat-label" style="margin-top:0.2rem">
                ${_esc(user.email ?? "")}
            </div>
        </div>`;

    // Replace the first stat (name) with the avatar card
    const allCards = [avatarCardHTML, ...stats.slice(1).map(s => `
        <div class="stat">
            <div class="stat-icon" aria-hidden="true">${s.icon}</div>
            <div class="stat-value">${_esc(String(s.value))}</div>
            <div class="stat-label">${s.label}</div>
        </div>`)];

    userStats.innerHTML = allCards.join("") + xpBarHTML;
}

function _renderError() {
    if (!userStats) return;
    userStats.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;
                    color:var(--text-muted);font-size:0.80rem;padding:1.2rem;">
            Could not load profile data.
        </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/** Truncate display name to fit the stat card value area. */
function _shortName(name) {
    if (!name) return "—";
    return name.length > 10 ? name.slice(0, 9) + "…" : name;
}

/** Format XP with a K suffix for readability above 999. */
function _fmtXP(xp) {
    if (xp >= 1000) return `${(xp / 1000).toFixed(1)}k`;
    return String(xp);
}

/**
 * Map level number to a flavour title shown under the level stat.
 * Titles are intentionally cyberpunk-flavoured to match the vibe.
 */
function _levelTitle(level) {
    if (level >= 20) return "Architect";
    if (level >= 15) return "Phantom";
    if (level >= 12) return "Specter";
    if (level >= 10) return "Ghost";
    if (level >= 8)  return "Cipher";
    if (level >= 6)  return "Hacker";
    if (level >= 4)  return "Operative";
    if (level >= 2)  return "Recruit";
    return "Initiate";
}

/** Escape HTML entities to prevent XSS. */
function _esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}