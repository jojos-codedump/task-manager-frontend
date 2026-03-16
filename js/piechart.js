// js/piechart.js
// Owns the XP Breakdown panel (#piechart-panel).
//
// Renders on:
//   - "auth:ready"    (initial page load)
//   - "tasks:updated" (after any task mutation)
//
// Data source: getXPSummary() from api.js
// Charting:    Chart.js 3.9.1 (loaded via CDN in dashboard.html)

import { getXPSummary } from "./api.js";
import { toastError }   from "./ui.js";

// ── DOM ref ───────────────────────────────────────────────────
const layout = document.getElementById("piechart-layout");

// ── Category display order + colours (matches backend CATEGORY_ORDER) ─
const CAT_CONFIG = [
    { key: "DSA",           label: "DSA",           color: "#a855f7", glow: "rgba(168,85,247,0.55)"  },
    { key: "WebDev",        label: "WebDev",         color: "#38bdf8", glow: "rgba(56,189,248,0.55)"  },
    { key: "Cybersecurity", label: "Cybersecurity",  color: "#f87171", glow: "rgba(248,113,113,0.55)" },
    { key: "GATE",          label: "GATE",           color: "#fbbf24", glow: "rgba(251,191,36,0.55)"  },
    { key: "General",       label: "General",        color: "#7c3aed", glow: "rgba(124,58,237,0.45)"  },
];

// Slightly transparent fills for the donut segments
const SEGMENT_COLORS  = CAT_CONFIG.map(c => c.color + "cc");   // cc = 80% opacity
const SEGMENT_BORDERS = CAT_CONFIG.map(c => c.color);
const SEGMENT_HOVER   = CAT_CONFIG.map(c => c.color);

// ── Chart instance (kept so we can destroy on re-render) ──────
let _chart = null;


// ═══════════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════════

document.addEventListener("auth:ready",    () => _loadChart());
document.addEventListener("tasks:updated", () => _loadChart());


// ═══════════════════════════════════════════════════════════════
//  Load + render
// ═══════════════════════════════════════════════════════════════

async function _loadChart() {
    if (!layout) return;

    // Show a subtle spinner while fetching
    _showLoading();

    let summary;
    try {
        summary = await getXPSummary();
    } catch (err) {
        toastError("Could not load XP data.");
        console.error("[piechart] getXPSummary failed:", err);
        _showError();
        return;
    }

    const { by_category, total_xp, level } = summary;

    // If the user has no XP yet, show the empty state
    if (total_xp === 0) {
        _showEmpty();
        return;
    }

    _renderChart(by_category, total_xp, level);
}


// ═══════════════════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════════════════

function _renderChart(by_category, total_xp, level) {
    // Destroy any previous Chart.js instance to avoid canvas reuse errors
    if (_chart) {
        _chart.destroy();
        _chart = null;
    }

    // Build the layout: donut on the left, legend on the right
    layout.innerHTML = `
        <div class="pie-wrap">
            <canvas id="xp-pie-canvas"
                    aria-label="XP breakdown donut chart"
                    role="img"></canvas>
            <div class="pie-centre" aria-hidden="true">
                <span class="pie-centre-value" id="pie-centre-value">
                    ${_fmtXP(total_xp)}
                </span>
                <span class="pie-centre-label">TOTAL XP</span>
            </div>
        </div>
        <div class="pie-legend" id="pie-legend" aria-label="XP legend">
            ${_legendHTML(by_category, total_xp)}
        </div>`;

    const canvas = document.getElementById("xp-pie-canvas");
    if (!canvas) return;

    // ── Chart.js donut ───────────────────────────────────────
    const values = CAT_CONFIG.map(c => by_category[c.key] ?? 0);

    _chart = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
            labels:   CAT_CONFIG.map(c => c.label),
            datasets: [{
                data:            values,
                backgroundColor: SEGMENT_COLORS,
                borderColor:     SEGMENT_BORDERS,
                hoverBackgroundColor: SEGMENT_HOVER,
                borderWidth:     1.5,
                hoverOffset:     6,
                borderRadius:    4,
                spacing:         2,
            }],
        },
        options: {
            responsive:  false,   // we control size via CSS
            cutout:      "68%",   // donut hole size
            animation: {
                animateRotate: true,
                animateScale:  false,
                duration:      900,
                easing:        "easeInOutQuart",
            },
            plugins: {
                legend: { display: false },   // we draw our own legend
                tooltip: {
                    enabled: true,
                    backgroundColor: "rgba(8,10,28,0.95)",
                    titleColor:      "#d8b4fe",
                    bodyColor:       "rgba(226,218,255,0.80)",
                    borderColor:     "rgba(139,92,246,0.35)",
                    borderWidth:     1,
                    padding:         10,
                    cornerRadius:    8,
                    titleFont: { family: "'Rajdhani', sans-serif", size: 13, weight: "700" },
                    bodyFont:  { family: "'JetBrains Mono', monospace", size: 11 },
                    callbacks: {
                        label(ctx) {
                            const xp  = ctx.parsed;
                            const pct = total_xp > 0
                                ? ((xp / total_xp) * 100).toFixed(1)
                                : "0.0";
                            return `  ${_fmtXP(xp)} XP  (${pct}%)`;
                        },
                    },
                },
            },
            // Update centre label on hover
            onHover(_, elements) {
                const centreVal = document.getElementById("pie-centre-value");
                if (!centreVal) return;
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    centreVal.textContent = _fmtXP(values[idx]);
                } else {
                    centreVal.textContent = _fmtXP(total_xp);
                }
            },
        },
    });
}

// ── Legend HTML ───────────────────────────────────────────────
function _legendHTML(by_category, total_xp) {
    return CAT_CONFIG
        .filter(c => (by_category[c.key] ?? 0) > 0)   // hide zero-XP categories
        .map(c => {
            const xp  = by_category[c.key] ?? 0;
            const pct = total_xp > 0
                ? ((xp / total_xp) * 100).toFixed(1)
                : "0.0";

            return `
                <div class="pie-legend-item">
                    <span class="pie-legend-swatch"
                          style="background:${c.color};
                                 box-shadow:0 0 5px ${c.glow}"></span>
                    <span class="pie-legend-name">${c.label}</span>
                    <span class="pie-legend-xp">${_fmtXP(xp)} XP</span>
                    <span class="pie-legend-pct">${pct}%</span>
                </div>`;
        })
        .join("");
}


// ═══════════════════════════════════════════════════════════════
//  State placeholders
// ═══════════════════════════════════════════════════════════════

function _showLoading() {
    if (_chart) { _chart.destroy(); _chart = null; }
    layout.innerHTML = `
        <div class="pie-empty">
            <div style="width:28px;height:28px;border:2px solid rgba(139,92,246,0.20);
                        border-top-color:var(--p2);border-radius:50%;
                        animation:spin 0.7s linear infinite;margin-bottom:0.5rem;"
                 aria-hidden="true"></div>
            <span>Loading XP data…</span>
        </div>`;
}

function _showEmpty() {
    if (_chart) { _chart.destroy(); _chart = null; }
    layout.innerHTML = `
        <div class="pie-empty" id="pie-empty">
            <span class="pie-empty-icon" aria-hidden="true">📊</span>
            <span>Complete tasks to earn XP</span>
        </div>`;
}

function _showError() {
    if (_chart) { _chart.destroy(); _chart = null; }
    layout.innerHTML = `
        <div class="pie-empty">
            <span class="pie-empty-icon" aria-hidden="true">⚠️</span>
            <span>Could not load XP data</span>
        </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function _fmtXP(xp) {
    if (xp >= 1000) return `${(xp / 1000).toFixed(1)}k`;
    return String(xp);
}