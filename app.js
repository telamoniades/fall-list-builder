"use strict";

/**
 * State
 */
let gameData = null;
let selectedFactionName = "";
let pointsLimit = 200;

// rosterEntries: [{ id, name, points, type }]
let rosterEntries = [];
let nextId = 1;

/**
 * Type ordering
 */
const TYPE_ORDER = ["Leader", "Core", "Special", "Elite"];
const TYPE_ORDER_MAP = new Map(TYPE_ORDER.map((t, i) => [t, i]));

/**
 * DOM
 */
const elPointsLimit = document.getElementById("pointsLimit");
const elFactionSelect = document.getElementById("factionSelect");
const elUnitList = document.getElementById("unitList");
const elRosterList = document.getElementById("rosterList");
const elTotalPoints = document.getElementById("totalPoints");
const elRosterSummary = document.getElementById("rosterSummary");
const elStatusDot = document.getElementById("statusDot");
const elStatusText = document.getElementById("statusText");
const elCopyBtn = document.getElementById("copyBtn");
const elClearBtn = document.getElementById("clearBtn");
const elUnitHelp = document.getElementById("unitHelp");

/**
 * Boot
 */
init();

async function init() {
  populatePointsDropdown();

  // Load JSON data (requires local server)
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
    gameData = await res.json();
  } catch (err) {
    elUnitHelp.textContent =
      "Could not load data.json. This version requires running a local server.";
    elUnitList.innerHTML = renderError(err);
    return;
  }

  populateFactionDropdown();
  bindEvents();

  // Default selections
  pointsLimit = Number(elPointsLimit.value);
  selectedFactionName = elFactionSelect.value;

  renderUnits();
  renderRoster();
}

function populatePointsDropdown() {
  const limits = [];
  for (let p = 200; p <= 500; p += 50) limits.push(p);

  elPointsLimit.innerHTML = limits
    .map((p) => `<option value="${p}">${p} points</option>`)
    .join("");

  elPointsLimit.value = "300";
}

function populateFactionDropdown() {
  const factions = gameData?.factions ?? [];
  elFactionSelect.innerHTML = factions
    .map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`)
    .join("");

  if (factions.length === 0) {
    elFactionSelect.innerHTML = `<option value="">No factions found</option>`;
  }
}

function bindEvents() {
  elPointsLimit.addEventListener("change", () => {
    pointsLimit = Number(elPointsLimit.value);
    renderRoster();
  });

  elFactionSelect.addEventListener("change", () => {
    selectedFactionName = elFactionSelect.value;
    clearRoster(); // prevent cross-faction mixing
    renderUnits();
    renderRoster();
  });

  elCopyBtn.addEventListener("click", copyRosterToClipboard);
  elClearBtn.addEventListener("click", () => {
    clearRoster();
    renderRoster();
  });
}

/**
 * Rendering
 */
function renderUnits() {
  const faction = getSelectedFaction();
  if (!faction) {
    elUnitHelp.textContent = "Select a faction to see units.";
    elUnitList.innerHTML = "";
    return;
  }

  elUnitHelp.textContent =
    "Click Add to include units in your roster. Force rules: exactly 1 Leader; Core must cover Special (1) and Elite (2).";

  const units = [...(faction.units ?? [])].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  elUnitList.innerHTML = units
    .map((u) => {
      return `
        <div class="row">
          <div class="row__left">
            <p class="row__title">${escapeHtml(u.name)}</p>
            <div class="row__meta">${escapeHtml(u.type)} · ${u.points} pts</div>
          </div>
          <div class="row__right">
            <button class="btn" data-add="${escapeAttr(u.name)}">Add</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Wire "Add" buttons
  elUnitList.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const unitName = btn.getAttribute("data-add");
      addUnit(unitName);
    });
  });
}

function renderRoster() {
  // Order roster entries by type (Leader -> Core -> Special -> Elite), then by add order within type.
  const ordered = [...rosterEntries].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.id - b.id; // preserve "added" order within type
  });

  if (ordered.length === 0) {
    elRosterList.innerHTML = `
      <div class="row">
        <div class="row__left">
          <p class="row__title">No units yet</p>
          <div class="row__meta">Add units from the left panel.</div>
        </div>
      </div>
    `;
  } else {
    elRosterList.innerHTML = ordered
      .map((it) => {
        return `
          <div class="row">
            <div class="row__left">
              <p class="row__title">${escapeHtml(it.name)}</p>
              <div class="row__meta">${escapeHtml(it.type)} · ${it.points} pts</div>
            </div>

            <div class="row__right">
              <button class="btn btn--ghost" data-del="${it.id}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire delete buttons
    elRosterList.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-del"));
        deleteEntry(id);
      });
    });
  }

  const total = getRosterTotal();
  elTotalPoints.textContent = String(total);
  elRosterSummary.textContent = `${total} / ${pointsLimit}`;

  // Status indicator: points + force composition
  const comp = computeForceComp();
  const over = Math.max(0, total - pointsLimit);
  const remaining = Math.max(0, pointsLimit - total);

  const compProblems = [];
  if (comp.leaders !== 1) {
    compProblems.push(`Leaders: need exactly 1 (you have ${comp.leaders}).`);
  }
  if (comp.core < comp.requiredCore) {
    compProblems.push(
      `Core: need at least ${comp.requiredCore} (you have ${comp.core}).`
    );
  }

  const pointsOk = total <= pointsLimit;
  const compOk = compProblems.length === 0;

  if (total === 0) {
    setStatus("Ready.", "ok");
    return;
  }

  if (!pointsOk && !compOk) {
    setStatus(`Over by ${over} pts. ${compProblems.join(" ")}`, "danger");
  } else if (!pointsOk) {
    setStatus(`Over by ${over} pts.`, "danger");
  } else if (!compOk) {
    // Within points but force comp illegal
    setStatus(`${remaining} pts remaining. ${compProblems.join(" ")}`, "warn");
  } else if (total === pointsLimit) {
    setStatus("Legal: exact points and legal force composition.", "ok");
  } else {
    setStatus(`${remaining} pts remaining. Force composition legal so far.`, "ok");
  }
}

function renderError(err) {
  return `
    <div class="row">
      <div class="row__left">
        <p class="row__title">Data load error</p>
        <div class="row__meta">${escapeHtml(String(err.message || err))}</div>
        <div class="row__meta">This app must be served by a local web server (not opened as a file).</div>
      </div>
    </div>
  `;
}

/**
 * Roster actions
 */
function addUnit(unitName) {
  const unit = findUnitInSelectedFaction(unitName);
  if (!unit) return;

  rosterEntries.push({
    id: nextId++,
    name: unit.name,
    points: unit.points,
    type: unit.type || "Core"
  });

  renderRoster();
}

function deleteEntry(id) {
  rosterEntries = rosterEntries.filter((e) => e.id !== id);
  renderRoster();
}

function clearRoster() {
  rosterEntries = [];
  nextId = 1;
}

function getRosterTotal() {
  let sum = 0;
  for (const it of rosterEntries) sum += it.points;
  return sum;
}

/**
 * Force composition
 * - Exactly 1 leader.
 * - Core must equal (Special + 2*Elite). Leaders don't count.
 */
function computeForceComp() {
  let leaders = 0;
  let core = 0;
  let special = 0;
  let elite = 0;

  for (const it of rosterEntries) {
    const t = it.type;
    if (t === "Leader") leaders++;
    else if (t === "Core") core++;
    else if (t === "Special") special++;
    else if (t === "Elite") elite++;
    // unknown types are ignored for now
  }

  const requiredCore = special + 2 * elite;

  return { leaders, core, special, elite, requiredCore };
}

async function copyRosterToClipboard() {
  const faction = selectedFactionName || "Unknown faction";
  const total = getRosterTotal();
  const comp = computeForceComp();

  const lines = [];
  lines.push(`Fall: A Game of Endings — Roster`);
  lines.push(`Faction: ${faction}`);
  lines.push(`Limit: ${pointsLimit}`);
  lines.push(`Total: ${total}`);
  lines.push(``);

  // Group header for quick legality reading
  lines.push(`Force Comp: Leaders ${comp.leaders}/1 · Core ${comp.core}/${comp.requiredCore} (Special ${comp.special}, Elite ${comp.elite})`);
  lines.push(``);

  const ordered = [...rosterEntries].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });

  if (ordered.length === 0) {
    lines.push(`(No units)`);
  } else {
    ordered.forEach((it, idx) => {
      lines.push(`${idx + 1}. [${it.type}] ${it.name} — ${it.points}`);
    });
  }

  const text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied roster to clipboard.", "ok");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setStatus("Copied roster to clipboard (fallback).", "ok");
  }
}

/**
 * Helpers
 */
function getSelectedFaction() {
  if (!gameData) return null;
  return (gameData.factions || []).find((f) => f.name === selectedFactionName) || null;
}

function findUnitInSelectedFaction(unitName) {
  const faction = getSelectedFaction();
  if (!faction) return null;
  return (faction.units || []).find((u) => u.name === unitName) || null;
}

function setStatus(message, type) {
  elStatusText.textContent = message;
  if (type === "danger") {
    elStatusDot.style.background = "var(--danger)";
  } else if (type === "warn") {
    elStatusDot.style.background = "var(--warn)";
  } else {
    elStatusDot.style.background = "var(--ok)";
  }
}

// Basic escaping
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}


