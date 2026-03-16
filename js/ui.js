// js/ui.js
// Owns all shared UI behaviour that isn't tied to a specific data domain:
//   - Clock tick (time display + sweep arc)
//   - Toast notification system
//   - Shared DOM helpers used by tasks.js / user.js / piechart.js

// ═══════════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════════

const _clockTime = document.getElementById("clock-time");
const _clockDate = document.getElementById("clock-date");
const _sweepArc  = document.getElementById("sweep-arc");

// sweep-arc circumference = 2π × r = 2π × 88 ≈ 553  (matches the SVG)
const CIRCUMFERENCE = 553;

const DAY_NAMES   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function _pad(n) { return String(n).padStart(2, "0"); }

function _tickClock() {
    const now = new Date();

    // ── Time string ─────────────────────────────────────────────
    const hh  = _pad(now.getHours());
    const mm  = _pad(now.getMinutes());
    const ss  = _pad(now.getSeconds());
    const timeStr = `${hh}:${mm}:${ss}`;

    if (_clockTime) {
        _clockTime.textContent = timeStr;
        _clockTime.setAttribute("datetime", now.toISOString());
    }

    // ── Date string ─────────────────────────────────────────────
    if (_clockDate) {
        const day   = DAY_NAMES[now.getDay()];
        const date  = now.getDate();
        const month = MONTH_NAMES[now.getMonth()];
        const year  = now.getFullYear();
        _clockDate.textContent = `${day}, ${date} ${month} ${year}`;
    }

    // ── Sweep arc — fraction of the current minute elapsed ──────
    // offset = CIRCUMFERENCE × (1 - seconds/60)
    // At 0 s the arc is fully hidden (offset = 553).
    // At 59 s the arc almost completes the circle (offset ≈ 0).
    if (_sweepArc) {
        const frac   = now.getSeconds() / 60;
        const offset = CIRCUMFERENCE * (1 - frac);
        _sweepArc.style.strokeDashoffset = offset.toFixed(3);
    }
}

// Kick immediately (no blank second on load), then tick every second
_tickClock();
setInterval(_tickClock, 1_000);


// ═══════════════════════════════════════════════════════════════
//  TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════

const _toastContainer = document.getElementById("toast-container");

/**
 * Show a toast notification.
 *
 * @param {string} message
 * @param {"success"|"error"|"warn"|"info"} [type="info"]
 * @param {number} [duration=3500]   ms before auto-dismiss
 */
export function toast(message, type = "info", duration = 3500) {
    if (!_toastContainer) return;

    const el = document.createElement("div");
    el.className = `toast${type !== "info" ? ` toast--${type}` : ""}`;
    el.setAttribute("role", "status");
    el.textContent = message;

    _toastContainer.appendChild(el);

    // Auto-remove
    const timer = setTimeout(() => _removeToast(el), duration);

    // Click to dismiss early
    el.addEventListener("click", () => {
        clearTimeout(timer);
        _removeToast(el);
    }, { once: true });
}

function _removeToast(el) {
    if (!el.parentNode) return;
    el.style.animation = "toastIn 0.22s var(--ease) reverse both";
    el.addEventListener("animationend", () => el.remove(), { once: true });
}

// ── Convenience wrappers ─────────────────────────────────────
export const toastSuccess = (msg, dur)  => toast(msg, "success", dur);
export const toastError   = (msg, dur)  => toast(msg, "error",   dur);
export const toastWarn    = (msg, dur)  => toast(msg, "warn",    dur);


// ═══════════════════════════════════════════════════════════════
//  SHARED DOM HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Replace the contents of a container with a loading skeleton.
 * Other modules call this while their data is in-flight.
 *
 * @param {HTMLElement} container
 * @param {number}      [rows=2]     number of shimmer rows
 * @param {string}      [height="48px"]
 */
export function showSkeleton(container, rows = 2, height = "48px") {
    if (!container) return;
    container.innerHTML = Array.from({ length: rows }, () =>
        `<div class="shimmer"
              style="height:${height};margin-bottom:8px;border-radius:8px"
              aria-hidden="true"></div>`
    ).join("");
}

/**
 * Show a centred empty-state message inside a container.
 *
 * @param {HTMLElement} container
 * @param {string}      [icon="📭"]
 * @param {string}      [message="Nothing here yet"]
 */
export function showEmpty(container, icon = "📭", message = "Nothing here yet") {
    if (!container) return;
    container.innerHTML = `
        <div class="panel-empty">
            <span class="panel-empty-icon" aria-hidden="true">${icon}</span>
            <span>${message}</span>
        </div>`;
}

/**
 * Format a dueDate ISO string into a human-readable relative label.
 * Matches the urgency thresholds in the backend's deadline_urgency().
 *
 *   overdue   → "Overdue by X"
 *   < 1 hr    → "Xm left"
 *   < 24 hr   → "Xh Ym left"
 *   < 7 days  → "Xd Yh left"
 *   else      → short locale date string
 *
 * @param {string} isoString
 * @returns {string}
 */
export function formatTimeLeft(isoString) {
    if (!isoString) return "No deadline";

    const due  = new Date(isoString);
    const now  = Date.now();
    const diff = due.getTime() - now;   // ms, negative = overdue

    if (isNaN(due.getTime())) return "Invalid date";

    const abs = Math.abs(diff);
    const mins  = Math.floor(abs / 60_000);
    const hours = Math.floor(abs / 3_600_000);
    const days  = Math.floor(abs / 86_400_000);

    if (diff < 0) {
        // Overdue
        if (mins < 60)    return `Overdue by ${mins}m`;
        if (hours < 24)   return `Overdue by ${hours}h`;
        return `Overdue by ${days}d`;
    }

    if (mins  < 60)              return `${mins}m left`;
    if (hours < 24) {
        const m = Math.floor((abs % 3_600_000) / 60_000);
        return `${hours}h ${m}m left`;
    }
    if (days  < 7) {
        const h = Math.floor((abs % 86_400_000) / 3_600_000);
        return `${days}d ${h}h left`;
    }

    // Far future — show a short date
    return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Convert a datetime-local input value ("2025-06-01T18:00")
 * to a full ISO-8601 string with UTC offset that the backend expects.
 *
 * The input gives us local time with no timezone info, so we construct
 * a Date from it (browser interprets as local) then call toISOString()
 * which gives UTC, then replace the trailing "Z" with "+00:00".
 *
 * Pydantic v2 rejects the "Z" suffix — it requires the explicit "+00:00"
 * offset form.  Both are valid ISO-8601, but only "+00:00" passes
 * Pydantic's datetime validator without extra config on the backend.
 *
 * @param {string} localDatetimeValue  e.g. "2025-06-01T18:00"
 * @returns {string}                   e.g. "2025-06-01T12:30:00.000+00:00"
 */
export function localInputToISO(localDatetimeValue) {
    if (!localDatetimeValue) return null;
    return new Date(localDatetimeValue).toISOString().replace("Z", "+00:00");
}

/**
 * Build a category badge element string.
 * Matches the .badge-{category} classes defined in base.css.
 *
 * @param {string} category
 * @returns {string}  HTML string
 */
export function categoryBadgeHTML(category) {
    const labels = {
        DSA:           "🧩 DSA",
        WebDev:        "💻 WebDev",
        Cybersecurity: "🔒 Cyber",
        GATE:          "📐 GATE",
        General:       "📋 General",
    };
    const label = labels[category] ?? category;
    return `<span class="badge badge-${category}">${label}</span>`;
}

/**
 * Update a panel badge counter element.
 *
 * @param {string}  id     element id, e.g. "tasks-badge"
 * @param {number}  count
 */
export function updateBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count;
    el.setAttribute("aria-label", `${count} ${id.replace("-badge", "")}`);
}