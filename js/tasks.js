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
let _busy = false;   // prevents double-submit


// ═══════════════════════════════════════════════════════════════
//  Bootstrap — wait for auth then load
// ═══════════════════════════════════════════════════════════════

document.addEventListener("auth:ready", () => {
    _loadTasks();
    _wireAddTask();
});


// ═══════════════════════════════════════════════════════════════
//  Load + render
// ═══════════════════════════════════════════════════════════════

async function _loadTasks() {
    // Show skeletons while fetching
    showSkeleton(tasksList, 3, "52px");
    showSkeleton(deadlinesList, 2, "62px");

    let data;
    try {
        data = await listTasks();
    } catch (err) {
        toastError("Failed to load tasks. Please refresh.");
        showEmpty(tasksList, "⚠️", "Could not load tasks");
        showEmpty(deadlinesList, "⚠️", "Could not load deadlines");
        console.error("[tasks] listTasks failed:", err);
        return;
    }

    _renderTasksPanel(data.grouped);
    _renderDeadlinesPanel(data.all);
}

// ── Tasks panel — grouped by category ────────────────────────
function _renderTasksPanel(grouped) {
    if (!tasksList) return;

    // Count only non-done tasks for the badge
    const activeTasks = Object.values(grouped)
        .flat()
        .filter(t => t.status !== "done");

    updateBadge("tasks-badge", activeTasks.length);

    // Filter to categories that have at least one task
    const nonEmptyCats = Object.entries(grouped)
        .filter(([, tasks]) => tasks.length > 0);

    if (nonEmptyCats.length === 0) {
        showEmpty(tasksList, "🎉", "No tasks yet — add one below!");
        return;
    }

    tasksList.innerHTML = nonEmptyCats.map(([cat, tasks]) =>
        _categorySection(cat, tasks)
    ).join("");

    // Wire action buttons (done + delete) after HTML is injected
    _bindTaskButtons();
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

// ── Auto-refresh every 30 seconds ─────────────────────────────
// Reloads tasks + triggers user.js and piechart.js to refresh too.
document.addEventListener("auth:ready", () => {
    setInterval(async () => {
        await _loadTasks();
        _dispatchUpdated();
    }, 5_000);
});