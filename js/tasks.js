// js/tasks.js
// Owns everything task-related on the dashboard:
//   - Loads + renders tasks grouped by category (tasks panel)
//   - Renders the deadlines panel (tasks with dueDate, sorted by urgency)
//   - Add task (POST /tasks)
//   - Complete task (PATCH /tasks/:id  { status: "done" })
//   - Delete task   (DELETE /tasks/:id)
//   - Fires "tasks:updated" after any mutation so user.js + piechart.js refresh

import { listTasks, createTask, completeTask, deleteTask } from "./api.js";
import {
    toast, toastSuccess, toastError,
    showSkeleton, showEmpty,
    formatTimeLeft, localInputToISO,
    categoryBadgeHTML, updateBadge,
} from "./ui.js";

// ── DOM refs ──────────────────────────────────────────────────
const tasksList      = document.getElementById("tasks-list");
const deadlinesList  = document.getElementById("deadlines-list");
const deadlinesBadge = document.getElementById("deadlines-badge");
const tasksBadge     = document.getElementById("tasks-badge");

const titleInput     = document.getElementById("new-task-title");
const categorySelect = document.getElementById("new-task-category");
const deadlineInput  = document.getElementById("new-task-deadline");
const addBtn         = document.getElementById("add-task-btn");

// ── Category display metadata ─────────────────────────────────
const CAT_META = {
    DSA:           { label: "DSA",           icon: "🧩" },
    WebDev:        { label: "WebDev",         icon: "💻" },
    Cybersecurity: { label: "Cybersecurity",  icon: "🔒" },
    GATE:          { label: "GATE",           icon: "📐" },
    General:       { label: "General",        icon: "📋" },
};

// ── Module state ──────────────────────────────────────────────
let _busy            = false;   // prevents double-submit
let _initialLoadDone = false;   // skeletons only on first load
let _showCompleted   = false;   // which tab is active in the tasks panel
let _lastGrouped     = null;    // cached from last fetch — lets tab clicks
                                // re-render instantly without a network call

// ── API base (for revision enrolment) ────────────────────────
const _API_BASE = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? "http://localhost:8000"
    : "https://task-manager-backend-unld.onrender.com";

/**
 * Enrol a just-completed task in the spaced-repetition schedule.
 * Fire-and-forget — a failure here must NEVER block the task
 * completion flow; we only show a soft warning toast if it errors.
 *
 * @param {string} taskId
 */
async function _startRevision(taskId) {
    try {
        const { getIdToken } = await import("./auth.js");
        const token = await getIdToken();
        await fetch(`${_API_BASE}/revisions/${taskId}/start`, {
            method:  "POST",
            headers: { "Authorization": `Bearer ${token}` },
        });
        // Notify revision.js to refresh its panel
        document.dispatchEvent(new CustomEvent("tasks:updated"));
    } catch (err) {
        // Soft warning — task is already marked done, revision is a bonus
        console.warn("[tasks] startRevision failed (non-critical):", err);
    }
}


// ═══════════════════════════════════════════════════════════════
//  Bootstrap — wait for auth then load
// ═══════════════════════════════════════════════════════════════

document.addEventListener("auth:ready", () => {
    _loadTasks();
    _wireAddTask();

    // ── Silent background refresh every 30 s ──────────────────
    // Only re-renders the DOM; does NOT dispatch tasks:updated so
    // user.js and piechart.js are NOT triggered (they have their
    // own refresh cadence via tasks:updated from real mutations).
    setInterval(() => _loadTasks(/* silent= */ true), 30_000);
});


// ═══════════════════════════════════════════════════════════════
//  Load + render
// ═══════════════════════════════════════════════════════════════

/**
 * @param {boolean} [silent=false]
 *   true  → background poll: skip skeletons, skip tasks:updated dispatch
 *   false → user-triggered or first load: show skeletons, dispatch update
 */
async function _loadTasks(silent = false) {
    // Only show skeletons on the very first load
    if (!silent && !_initialLoadDone) {
        showSkeleton(tasksList, 3, "52px");
        showSkeleton(deadlinesList, 2, "62px");
    }

    let data;
    try {
        data = await listTasks();
    } catch (err) {
        if (!silent) {
            toastError("Failed to load tasks. Please refresh.");
            showEmpty(tasksList, "⚠️", "Could not load tasks");
            showEmpty(deadlinesList, "⚠️", "Could not load deadlines");
        }
        console.error("[tasks] listTasks failed:", err);
        return;
    }

    _initialLoadDone = true;
    _lastGrouped = data.grouped;   // cache for instant tab switching

    _renderTasksPanel(data.grouped);
    _renderDeadlinesPanel(data.all);
}

// ── Tasks panel — grouped by category ────────────────────────
function _renderTasksPanel(grouped) {
    if (!tasksList) return;

    // Split into active (todo/in_progress) and completed (done)
    const activeTasks    = Object.values(grouped).flat().filter(t => t.status !== "done");
    const completedTasks = Object.values(grouped).flat().filter(t => t.status === "done");

    // Badge always shows active count
    updateBadge("tasks-badge", activeTasks.length);

    // ── Tab bar ───────────────────────────────────────────────
    const tabBar = `
        <div class="tasks-tab-bar" id="tasks-tab-bar">
            <button class="tasks-tab${!_showCompleted ? " tasks-tab--active" : ""}"
                    id="tab-active" data-tab="active"
                    aria-selected="${!_showCompleted}">
                Active
                <span class="tasks-tab-count">${activeTasks.length}</span>
            </button>
            <button class="tasks-tab${_showCompleted ? " tasks-tab--active" : ""}"
                    id="tab-completed" data-tab="completed"
                    aria-selected="${_showCompleted}">
                Completed
                <span class="tasks-tab-count">${completedTasks.length}</span>
            </button>
        </div>`;

    if (!_showCompleted) {
        // ── Active view ──────────────────────────────────────
        const nonEmptyCats = Object.entries(grouped)
            .map(([cat, tasks]) => [cat, tasks.filter(t => t.status !== "done")])
            .filter(([, tasks]) => tasks.length > 0);

        const bodyHTML = nonEmptyCats.length === 0
            ? `<div class="panel-empty">
                   <span class="panel-empty-icon" aria-hidden="true">🎉</span>
                   <span>No tasks yet — add one below!</span>
               </div>`
            : nonEmptyCats.map(([cat, tasks]) => _categorySection(cat, tasks)).join("");

        tasksList.innerHTML = tabBar + bodyHTML;
    } else {
        // ── Completed view ───────────────────────────────────
        const bodyHTML = completedTasks.length === 0
            ? `<div class="panel-empty">
                   <span class="panel-empty-icon" aria-hidden="true">📭</span>
                   <span>No completed tasks yet</span>
               </div>`
            : completedTasks.map(t => _completedItemHTML(t)).join("");

        tasksList.innerHTML = tabBar + bodyHTML;
    }

    // Wire tab clicks
    tasksList.querySelectorAll(".tasks-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            _showCompleted = btn.dataset.tab === "completed";
            if (_lastGrouped) _renderTasksPanel(_lastGrouped);
        });
    });

    // Wire action buttons after HTML is injected
    _bindTaskButtons();
}

// ── Completed task item — stripped down, delete only ─────────
function _completedItemHTML(task) {
    return `
        <div class="task-item task-item--completed"
             data-id="${task.id}"
             data-category="${task.category}">
            <div class="task-info">
                <div class="task-title" style="opacity:0.55;text-decoration:line-through">
                    ${_esc(task.title)}
                </div>
                <div class="task-meta">
                    ${categoryBadgeHTML(task.category)}
                    <span class="task-xp">+${task.xpValue} XP</span>
                    <span style="font-size:0.60rem;color:var(--dl-ok)">✓ Done</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="btn-danger task-delete-btn"
                        data-id="${task.id}"
                        aria-label="Delete '${_esc(task.title)}'"
                        title="Delete">✕</button>
            </div>
        </div>`;
}

function _categorySection(cat, tasks) {
    const meta = CAT_META[cat] ?? { label: cat, icon: "📋" };
    return `
        <div class="category-section" data-category="${cat}">
            <div class="category-section-header">
                <span class="category-dot cat-dot-${cat}" aria-hidden="true"></span>
                <span>${meta.icon} ${meta.label}</span>
                <span style="margin-left:auto;font-family:'JetBrains Mono',monospace;
                             font-size:0.58rem;color:var(--text-muted)">
                    ${tasks.length}
                </span>
            </div>
            ${tasks.map(t => _taskItemHTML(t)).join("")}
        </div>`;
}

function _taskItemHTML(task) {
    const isDone    = task.status === "done";
    const urgency   = task.urgency ?? "none";
    const pct       = task.progress_pct ?? 0;
    const timeLabel = task.dueDate ? formatTimeLeft(task.dueDate) : null;

    const doneStyle = isDone
        ? "opacity:0.42;text-decoration:line-through;"
        : "";

    const deadlineBar = task.dueDate && !isDone ? `
        <div class="task-deadline-bar" data-urgency="${urgency}"
             style="--pct:${pct}">
            <div class="task-deadline-fill"></div>
            <span class="task-deadline-label">${timeLabel}</span>
        </div>` : "";

    const doneBtn = !isDone ? `
        <button class="btn-done task-done-btn"
                data-id="${task.id}"
                aria-label="Mark '${_esc(task.title)}' as done"
                title="Mark done">✓</button>` : "";

    return `
        <div class="task-item"
             data-id="${task.id}"
             data-category="${task.category}"
             data-urgency="${urgency}"
             style="${doneStyle}">
            <div class="task-info">
                <div class="task-title">${_esc(task.title)}</div>
                <div class="task-meta">
                    ${categoryBadgeHTML(task.category)}
                    <span class="task-xp">+${task.xpValue} XP</span>
                    ${isDone ? '<span style="font-size:0.62rem;color:var(--dl-ok)">✓ Done</span>' : ""}
                </div>
                ${deadlineBar}
            </div>
            <div class="task-actions">
                ${doneBtn}
                <button class="btn-danger task-delete-btn"
                        data-id="${task.id}"
                        aria-label="Delete '${_esc(task.title)}'"
                        title="Delete">✕</button>
            </div>
        </div>`;
}

// ── Deadlines panel — all tasks with dueDate, sorted ─────────
function _renderDeadlinesPanel(allTasks) {
    if (!deadlinesList) return;

    // Only show tasks that have a deadline and aren't done
    const upcoming = allTasks
        .filter(t => t.dueDate && t.status !== "done")
        .sort((a, b) => {
            // Sort overdue first, then by dueDate ascending
            const urgencyOrder = { overdue: 0, urgent: 1, soon: 2, ok: 3, none: 4 };
            const uA = urgencyOrder[a.urgency] ?? 5;
            const uB = urgencyOrder[b.urgency] ?? 5;
            if (uA !== uB) return uA - uB;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

    updateBadge("deadlines-badge", upcoming.length);

    if (upcoming.length === 0) {
        deadlinesList.innerHTML = `
            <div class="deadlines-empty" id="deadlines-empty">
                <span class="deadlines-empty-icon" aria-hidden="true">🏖️</span>
                <span>No upcoming deadlines</span>
            </div>`;
        return;
    }

    deadlinesList.innerHTML = upcoming.map(t => _deadlineItemHTML(t)).join("");
}

function _deadlineItemHTML(task) {
    const pct       = task.progress_pct ?? 0;
    const urgency   = task.urgency ?? "none";
    const timeLabel = formatTimeLeft(task.dueDate);
    const meta      = CAT_META[task.category] ?? { label: task.category };

    return `
        <div class="deadline-item"
             data-urgency="${urgency}"
             style="--pct:${pct}">
            <div class="deadline-title">${_esc(task.title)}</div>
            <div class="deadline-meta">
                <span class="deadline-time-left">${timeLabel}</span>
                <span class="deadline-category-chip">${meta.label}</span>
            </div>
        </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  Add task
// ═══════════════════════════════════════════════════════════════

function _wireAddTask() {
    addBtn?.addEventListener("click", _handleAdd);

    // Also submit on Enter inside the title input
    titleInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            _handleAdd();
        }
    });
}

async function _handleAdd() {
    if (_busy) return;

    const title    = titleInput?.value.trim();
    const category = categorySelect?.value ?? "General";
    const dueRaw   = deadlineInput?.value;

    // ── Validation ───────────────────────────────────────────
    if (!title) {
        toast("Please enter a task title.", "warn");
        titleInput?.focus();
        return;
    }

    if (!dueRaw) {
        toast("Please pick a deadline.", "warn");
        deadlineInput?.focus();
        // Slide the deadline row in so the user sees it
        const row = document.getElementById("deadline-input-row");
        row?.classList.add("visible");
        row?.setAttribute("aria-hidden", "false");
        return;
    }

    const dueISO = localInputToISO(dueRaw);

    // Reject deadlines in the past
    if (new Date(dueISO) < new Date()) {
        toast("Deadline must be in the future.", "warn");
        deadlineInput?.focus();
        return;
    }

    // ── Submit ───────────────────────────────────────────────
    _busy = true;
    _setAddLoading(true);

    try {
        await createTask({ title, category, dueDate: dueISO });
        toastSuccess(`"${title}" added!`);
        _resetAddForm();
        await _loadTasks();
        _dispatchUpdated();
    } catch (err) {
        toastError(err.message ?? "Failed to add task.");
        console.error("[tasks] createTask failed:", err);
    } finally {
        _busy = false;
        _setAddLoading(false);
    }
}

function _setAddLoading(on) {
    if (!addBtn) return;
    addBtn.disabled = on;
    addBtn.textContent = on ? "Adding..." : "+ Add";
}

function _resetAddForm() {
    if (titleInput)    titleInput.value    = "";
    if (deadlineInput) deadlineInput.value = "";

    // Collapse deadline row
    const deadlineRow = document.getElementById("deadline-input-row");
    deadlineRow?.classList.remove("visible");
    deadlineRow?.setAttribute("aria-hidden", "true");
}


// ═══════════════════════════════════════════════════════════════
//  Task action buttons (done + delete)
// ═══════════════════════════════════════════════════════════════

function _bindTaskButtons() {
    // Done buttons
    tasksList?.querySelectorAll(".task-done-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            if (!id) return;

            btn.disabled = true;
            try {
                await completeTask(id);
                toastSuccess("Task completed! XP earned 🎉");
                // Enrol in revision schedule — fire-and-forget
                _startRevision(id);
                await _loadTasks();
                _dispatchUpdated();
            } catch (err) {
                toastError("Could not complete task.");
                console.error("[tasks] completeTask failed:", err);
                btn.disabled = false;
            }
        });
    });

    // Delete buttons
    tasksList?.querySelectorAll(".task-delete-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            if (!id) return;

            // Soft confirm — brief visual before deleting
            const item = tasksList.querySelector(`.task-item[data-id="${id}"]`);
            if (item) {
                item.style.transition = "opacity 0.18s";
                item.style.opacity    = "0.35";
            }

            btn.disabled = true;
            try {
                await deleteTask(id);
                toast("Task deleted.", "info", 2200);
                await _loadTasks();
                _dispatchUpdated();
            } catch (err) {
                toastError("Could not delete task.");
                console.error("[tasks] deleteTask failed:", err);
                if (item) item.style.opacity = "1";
                btn.disabled = false;
            }
        });
    });
}


// ═══════════════════════════════════════════════════════════════
//  Cross-module event
// ═══════════════════════════════════════════════════════════════

/**
 * Fire after any mutation so user.js and piechart.js can refresh
 * their data without polling.
 */
function _dispatchUpdated() {
    document.dispatchEvent(new CustomEvent("tasks:updated"));
}


// ═══════════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════════

/** Escape HTML to prevent XSS from user-supplied task titles. */
function _esc(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}