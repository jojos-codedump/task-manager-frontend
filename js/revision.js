// js/revision.js
// Owns the Revision Queue panel (#revision-panel).
//
// Renders on:
//   - "auth:ready"    (initial page load)
//   - "tasks:updated" (a task was just completed — new revision may exist)
//
// Tabs:  Due Now  |  Upcoming  |  Done
// Data source: GET /revisions  and  POST /revisions/:task_id/advance

import { getIdToken } from "./auth.js";
import { toastSuccess, toastError, showSkeleton } from "./ui.js";

// ── API base (mirrors api.js) ─────────────────────────────────
const API_BASE = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? "http://localhost:8000"
    : "https://task-manager-backend-unld.onrender.com";

// ── DOM refs ──────────────────────────────────────────────────
const revisionList  = document.getElementById("revision-list");
const revisionBadge = document.getElementById("revision-badge");
const tabButtons    = document.querySelectorAll(".rev-tab");

// ── Stage chip config ─────────────────────────────────────────
const STAGE_META = {
    "14d": { label: "14d",  cls: "rev-item-stage--14"  },
    "1mo": { label: "1mo",  cls: "rev-item-stage--30"  },
    "6mo": { label: "6mo",  cls: "rev-item-stage--180" },
    "done":{ label: "✓",    cls: "rev-item-stage--done"},
};

// Category badge colours reuse base.css .badge-* classes
const CAT_LABEL = {
    DSA:           "DSA",
    WebDev:        "WebDev",
    Cybersecurity: "Cyber",
    GATE:          "GATE",
    General:       "General",
};

// ── Module state ──────────────────────────────────────────────
let _activeTab  = "due";      // "due" | "upcoming" | "done"
let _data       = null;       // last successful RevisionListResponse
let _advancing  = new Set();  // task IDs currently being advanced


// ═══════════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════════

document.addEventListener("auth:ready",    () => { _loadRevisions(); _wireTabs(); });
document.addEventListener("tasks:updated", () => _loadRevisions());


// ═══════════════════════════════════════════════════════════════
//  API calls (inline — keeps revision.js self-contained)
// ═══════════════════════════════════════════════════════════════

async function _fetch(path, options = {}) {
    const token = await getIdToken();
    const res   = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "Authorization": `Bearer ${token}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
        },
    });
    if (res.status === 204) return undefined;
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail ?? `HTTP ${res.status}`);
    return data;
}

async function _getRevisions()       { return _fetch("/revisions"); }
async function _advance(taskId)      { return _fetch(`/revisions/${taskId}/advance`, { method: "POST" }); }


// ═══════════════════════════════════════════════════════════════
//  Load + render
// ═══════════════════════════════════════════════════════════════

async function _loadRevisions() {
    if (!revisionList) return;

    // Only show skeleton on first load
    if (!_data) showSkeleton(revisionList, 2, "44px");

    try {
        _data = await _getRevisions();
    } catch (err) {
        console.error("[revision] _getRevisions failed:", err);
        _renderError();
        return;
    }

    _updateBadge();
    _renderTab(_activeTab);
}

// ── Badge: count of due-now items ────────────────────────────
function _updateBadge() {
    if (!revisionBadge || !_data) return;
    const count = _data.due.length;
    revisionBadge.textContent = count;
    revisionBadge.setAttribute("aria-label", `${count} due`);
}

// ── Render whichever tab is active ───────────────────────────
function _renderTab(tab) {
    if (!revisionList || !_data) return;
    _activeTab = tab;

    const items = _data[tab] ?? [];

    if (items.length === 0) {
        revisionList.innerHTML = _emptyStateHTML(tab);
        return;
    }

    revisionList.innerHTML = items.map(r => _revItemHTML(r, tab)).join("");
    _bindAdvanceButtons();
}

// ── Single revision item ─────────────────────────────────────
function _revItemHTML(rev, tab) {
    const stage    = STAGE_META[rev.stage] ?? STAGE_META["14d"];
    const catLabel = CAT_LABEL[rev.taskCategory] ?? rev.taskCategory;
    const isDone   = rev.stage === "done";

    const dueLine  = isDone
        ? _doneLabel(rev.lastReviewAt)
        : _dueLabel(rev.nextDue, tab);

    const advanceBtn = (!isDone) ? `
        <button class="btn-outline revision-item-btn rev-advance-btn"
                data-taskid="${rev.taskId}"
                aria-label="Mark '${_esc(rev.taskTitle)}' review done">
            Done
        </button>` : "";

    const rowClass = tab === "due"
        ? "revision-item revision-item--due"
        : tab === "done"
            ? "revision-item revision-item--done"
            : "revision-item";

    return `
        <div class="${rowClass}" data-taskid="${rev.taskId}">
            <div class="revision-item-info">
                <div class="revision-item-title">${_esc(rev.taskTitle)}</div>
                <div class="revision-item-due">
                    <span class="badge badge-${rev.taskCategory}">${catLabel}</span>
                    &nbsp;${dueLine}
                </div>
            </div>
            <span class="rev-item-stage ${stage.cls}">${stage.label}</span>
            ${advanceBtn}
        </div>`;
}

function _dueLabel(nextDueISO, tab) {
    if (!nextDueISO) return "";
    const due  = new Date(nextDueISO);
    const diff = due.getTime() - Date.now();
    const days = Math.round(Math.abs(diff) / 86_400_000);

    if (tab === "due") {
        return diff < 0
            ? `<span style="color:var(--dl-overdue)">Overdue by ${days}d</span>`
            : `<span style="color:var(--dl-urgent)">Due today</span>`;
    }
    return `<span style="color:var(--text-muted)">in ${days}d</span>`;
}

function _doneLabel(lastReviewISO) {
    if (!lastReviewISO) return "";
    const d    = new Date(lastReviewISO);
    const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
    return `<span style="color:var(--dl-ok)">Consolidated ${days}d ago</span>`;
}

function _emptyStateHTML(tab) {
    const msgs = {
        due:      { icon: "✅", text: "Nothing due right now" },
        upcoming: { icon: "🗓️", text: "No upcoming reviews" },
        done:     { icon: "🏆", text: "No completed reviews yet" },
    };
    const { icon, text } = msgs[tab] ?? { icon: "📭", text: "Nothing here" };
    return `
        <div class="panel-empty">
            <span class="panel-empty-icon" aria-hidden="true">${icon}</span>
            <span>${text}</span>
        </div>`;
}

function _renderError() {
    if (!revisionList) return;
    revisionList.innerHTML = `
        <div class="panel-empty">
            <span class="panel-empty-icon" aria-hidden="true">⚠️</span>
            <span>Could not load revisions</span>
        </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  Tab wiring
// ═══════════════════════════════════════════════════════════════

function _wireTabs() {
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.stage;
            if (!tab) return;

            // Update active state
            tabButtons.forEach(b => {
                b.classList.toggle("rev-tab--active", b === btn);
                b.setAttribute("aria-selected", String(b === btn));
            });

            _renderTab(tab);
        });
    });
}


// ═══════════════════════════════════════════════════════════════
//  Advance button wiring
// ═══════════════════════════════════════════════════════════════

function _bindAdvanceButtons() {
    revisionList?.querySelectorAll(".rev-advance-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const taskId = btn.dataset.taskid;
            if (!taskId || _advancing.has(taskId)) return;

            _advancing.add(taskId);
            btn.disabled     = true;
            btn.textContent  = "...";

            try {
                const updated = await _advance(taskId);

                // Optimistically update _data so re-render is instant
                _patchLocalData(taskId, updated);
                _updateBadge();
                _renderTab(_activeTab);

                const nextStage = updated.stage;
                if (nextStage === "done") {
                    toastSuccess("Revision complete! 🎉 Fully consolidated.");
                } else {
                    const labels = { "1mo": "1 month", "6mo": "6 months" };
                    toastSuccess(`Review done! Next in ${labels[nextStage] ?? nextStage}.`);
                }
            } catch (err) {
                toastError("Could not advance revision. Try again.");
                console.error("[revision] advance failed:", err);
                btn.disabled    = false;
                btn.textContent = "Done";
            } finally {
                _advancing.delete(taskId);
            }
        });
    });
}

// Update the local _data cache after an advance so we don't need
// a full network round-trip to re-render correctly.
function _patchLocalData(taskId, updated) {
    if (!_data) return;

    // Remove from all buckets
    for (const bucket of ["due", "upcoming", "done"]) {
        _data[bucket] = _data[bucket].filter(r => r.taskId !== taskId);
    }

    // Insert into the correct bucket
    if (updated.stage === "done") {
        _data.done.unshift(updated);
    } else {
        // Check if it's now due
        const nextDue = updated.nextDue ? new Date(updated.nextDue) : null;
        if (nextDue && nextDue <= new Date()) {
            _data.due.push(updated);
        } else {
            _data.upcoming.push(updated);
        }
    }
}


// ═══════════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════════

function _esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}