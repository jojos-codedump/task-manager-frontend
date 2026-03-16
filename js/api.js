// js/api.js
// All communication with the FastAPI backend lives here.
// Nothing else should ever call fetch() directly.
//
// Endpoints covered (prefix: /tasks)
//   POST   /tasks                → createTask(payload)
//   GET    /tasks                → listTasks()
//   GET    /tasks/xp-summary     → getXPSummary()
//   PATCH  /tasks/:id            → updateTask(id, patch)
//   DELETE /tasks/:id            → deleteTask(id)

import { getIdToken } from "./auth.js";

// ── Backend base URL ──────────────────────────────────────────
// On localhost the backend runs on :8000.
// In production set VITE_API_BASE (or just hard-code your Render URL here).
const API_BASE = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? "http://localhost:8000"
    : "https://task-manager-backend-unld.onrender.com";   // <-- replace before deploying


// ═══════════════════════════════════════════════════════════════
//  Core fetch wrapper
// ═══════════════════════════════════════════════════════════════

/**
 * Authenticated fetch.
 * - Attaches a fresh Firebase ID token as Bearer
 * - Sets Content-Type: application/json for non-GET requests
 * - Parses JSON on 2xx, throws ApiError on everything else
 * - Returns undefined for 204 No Content (e.g. DELETE)
 *
 * @param {string} path    - e.g. "/tasks" or "/tasks/xp-summary"
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function fetchWithAuth(path, options = {}) {
    let token;
    try {
        token = await getIdToken();
    } catch {
        // Auth isn't ready yet (shouldn't normally happen on dashboard)
        throw new ApiError("Not authenticated", 401);
    }

    const headers = {
        "Authorization": `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
    };

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    // 204 No Content — nothing to parse
    if (res.status === 204) return undefined;

    let data;
    try {
        data = await res.json();
    } catch {
        // Non-JSON body on an error response
        throw new ApiError(`HTTP ${res.status}`, res.status);
    }

    if (!res.ok) {
        // FastAPI error bodies look like: { detail: "..." }
        const msg = data?.detail ?? `HTTP ${res.status}`;
        throw new ApiError(
            typeof msg === "string" ? msg : JSON.stringify(msg),
            res.status,
            data
        );
    }

    return data;
}


// ═══════════════════════════════════════════════════════════════
//  Custom error class — lets callers branch on status code
// ═══════════════════════════════════════════════════════════════

export class ApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status   HTTP status code
     * @param {any}    [body]   parsed response body (if available)
     */
    constructor(message, status, body = null) {
        super(message);
        this.name   = "ApiError";
        this.status = status;
        this.body   = body;
    }
}


// ═══════════════════════════════════════════════════════════════
//  POST /tasks
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new task.
 *
 * @param {{
 *   title:    string,
 *   category: "DSA"|"WebDev"|"Cybersecurity"|"GATE"|"General",
 *   dueDate:  string,   // ISO-8601  e.g. "2025-06-01T18:00:00"
 *   xpValue?: number    // omit to let backend default from category
 * }} payload
 * @returns {Promise<TaskResponse>}
 */
export async function createTask(payload) {
    return fetchWithAuth("/tasks", {
        method: "POST",
        body:   JSON.stringify(payload),
    });
}


// ═══════════════════════════════════════════════════════════════
//  GET /tasks
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch all tasks for the signed-in user.
 *
 * Returns:
 * {
 *   grouped: { DSA: [...], WebDev: [...], Cybersecurity: [...], GATE: [...], General: [...] },
 *   all:     TaskResponse[]   (flat, sorted by dueDate asc)
 * }
 *
 * Each task already has urgency + progress_pct computed server-side.
 *
 * @returns {Promise<TaskListResponse>}
 */
export async function listTasks() {
    return fetchWithAuth("/tasks");
}


// ═══════════════════════════════════════════════════════════════
//  GET /tasks/xp-summary
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch XP totals by category and the user's current level info.
 *
 * Returns:
 * {
 *   by_category: { DSA: 0, WebDev: 0, ... },
 *   total_xp:    number,
 *   level: {
 *     level:         number,
 *     xp_into_level: number,
 *     xp_to_next:    number,
 *     progress_pct:  number   // 0–100, drives the XP bar
 *   }
 * }
 *
 * @returns {Promise<XPSummaryResponse>}
 */
export async function getXPSummary() {
    return fetchWithAuth("/tasks/xp-summary");
}


// ═══════════════════════════════════════════════════════════════
//  PATCH /tasks/:id
// ═══════════════════════════════════════════════════════════════

/**
 * Partially update a task. At least one field must be provided.
 *
 * Accepted fields (all optional but at least one required):
 *   title    : string
 *   status   : "todo" | "in_progress" | "done"
 *   dueDate  : string  (ISO-8601)
 *   xpValue  : number
 *
 * Backend auto-stamps completedAt when status → "done",
 * and clears it when status → "todo" or "in_progress".
 *
 * @param {string} taskId
 * @param {{
 *   title?:   string,
 *   status?:  "todo"|"in_progress"|"done",
 *   dueDate?: string,
 *   xpValue?: number
 * }} patch
 * @returns {Promise<TaskResponse>}
 */
export async function updateTask(taskId, patch) {
    return fetchWithAuth(`/tasks/${taskId}`, {
        method: "PATCH",
        body:   JSON.stringify(patch),
    });
}


// ═══════════════════════════════════════════════════════════════
//  DELETE /tasks/:id
// ═══════════════════════════════════════════════════════════════

/**
 * Permanently delete a task.
 * Returns undefined on success (backend sends 204 No Content).
 *
 * @param {string} taskId
 * @returns {Promise<undefined>}
 */
export async function deleteTask(taskId) {
    return fetchWithAuth(`/tasks/${taskId}`, { method: "DELETE" });
}


// ═══════════════════════════════════════════════════════════════
//  Convenience: mark a task as done in one call
// ═══════════════════════════════════════════════════════════════

/**
 * Mark a task as "done".
 * Thin wrapper around updateTask — keeps call-sites readable.
 *
 * @param {string} taskId
 * @returns {Promise<TaskResponse>}
 */
export async function completeTask(taskId) {
    return updateTask(taskId, { status: "done" });
}