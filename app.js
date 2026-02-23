"use strict";

/**
 * State
 */
let gameData = null;
let selectedFactionName = "";
let pointsLimit = 300;

// rosterEntries: [{ id, name, points, type }]
let rosterEntries = [];
let nextId = 1;

/**
 * Type ordering (requested)
 */
const TYPE_ORDER = ["Leader", "Core", "Special", "Champion"];
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

  // Load JSON data (requires local server or GitHub Pages)
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
    gameData = await res.json();
  } catch (err) {
    elUnitHelp.textContent =
      "Could not load data.json. This version requires running a local server or hosting it (e.g., GitHub Pages).";
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

  // Default to 300
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
    renderUnits(); // champion buttons may enable/disable based on cap
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
    renderUnits();
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

  const comp = computeForceComp();
  const maxChampions = getChampionCap(pointsLimit);
  const championsAtCap = comp.champions >= maxChampions;

  elUnitHelp.textContent =
    `Rules: exactly 1 Leader · Core ≥ Special · Champions ≤ ⌊${pointsLimit}/250⌋ = ${maxChampions}.`;

  const units = [...(faction.units ?? [])].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  elUnitList.innerHTML = units
    .map((u) => {
      const isChampion = u.type === "Champion";
      const disabled = isChampion && maxChampions === 0 ? true : (isChampion && championsAtCap);
      const disabledAttr = disabled ? "disabled" : "";

      let reason = "";
      if (disabled && isChampion) {
        reason =
          maxChampions === 0
            ? ` (0 allowed at ${pointsLimit})`
            : ` (cap ${maxChampions})`;
      }

      return `
        <div class="row">
          <div class="row__left">
            <p class="row__title">${escapeHtml(u.name)}</p>
            <div class="row__meta">${escapeHtml(u.type)} · ${u.points} pts${escapeHtml(reason)}</div>
          </div>
          <div class="row__right">
            <button class="btn" data-add="${escapeAttr(u.name)}" ${disabledAttr}>Add</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Wire "Add" buttons
  elUnitList.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const unitName = btn.getAttribute("data-add");
      addUnit(unitName);
    });
  });
}

function renderRoster() {
  // Order roster entries by type (Leader -> Core -> Special -> Champion), then by add order within type.
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
  const maxChampions = getChampionCap(pointsLimit);
  const over = Math.max(0, total - pointsLimit);
  const remaining = Math.max(0, pointsLimit - total);

  const compProblems = [];

  // Exactly one leader
  if (comp.leaders !== 1) {
    compProblems.push(`Leaders: need exactly 1 (you have ${comp.leaders}).`);
  }

  // Core >= Special
  if (comp.core < comp.requiredCore) {
    compProblems.push(`Core: need at least ${comp.requiredCore} (you have ${comp.core}).`);
  }

  // Champions cap
  if (comp.champions > maxChampions) {
    compProblems.push(`Champions: max ${maxChampions} at ${pointsLimit} pts (you have ${comp.champions}).`);
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
    setStatus(`${remaining} pts remaining. ${compProblems.join(" ")}`, "warn");
  } else if (total === pointsLimit) {
    setStatus("Legal: exact points and legal force composition.", "ok");
  } else {
    setStatus(`${remaining} pts remaining. Legal so far.`, "ok");
  }
}

function renderError(err) {
  return `
    <div class="row">
      <div class="row__left">
        <p class="row__title">Data load error</p>
        <div class="row__meta">${escapeHtml(String(err.message || err))}</div>
        <div class="row__meta">This app must be served by a local web server or hosted (GitHub Pages works).</div>
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

  // Enforce champion cap at add-time (UX help). Status also enforces it.
  if (unit.type === "Champion") {
    const maxChampions = getChampionCap(pointsLimit);
    const comp = computeForceComp();
    if (comp.champions >= maxChampions) {
      // no-op; renderUnits already disables the button, but this is extra safety
      setStatus(`Champion cap reached (${maxChampions} max at ${pointsLimit} pts).`, "warn");
      return;
    }
  }

  rosterEntries.push({
    id: nextId++,
    name: unit.name,
    points: unit.points,
    type: unit.type || "Core"
  });

  renderRoster();
  renderUnits(); // update champion Add button disable state
}

function deleteEntry(id) {
  rosterEntries = rosterEntries.filter((e) => e.id !== id);
  renderRoster();
  renderUnits();
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
 * - Core >= Special. (Champions do NOT require Core.)
 * - Champions limited to floor(pointsLimit / 250).
 */
function computeForceComp() {
  let leaders = 0;
  let core = 0;
  let special = 0;
  let champions = 0;

  for (const it of rosterEntries) {
    const t = it.type;
    if (t === "Leader") leaders++;
    else if (t === "Core") core++;
    else if (t === "Special") special++;
    else if (t === "Champion") champions++;
  }

  const requiredCore = special; // champions do not contribute
  return { leaders, core, special, champions, requiredCore };
}

function getChampionCap(limit) {
  return Math.floor(Number(limit) / 250);
}

async function copyRosterToClipboard() {
  const faction = selectedFactionName || "Unknown faction";
  const total = getRosterTotal();
  const comp = computeForceComp();
  const maxChampions = getChampionCap(pointsLimit);

  const lines = [];
  lines.push(`Fall: A Game of Endings — Roster`);
  lines.push(`Faction: ${faction}`);
  lines.push(`Limit: ${pointsLimit}`);
  lines.push(`Total: ${total}`);
  lines.push(``);
  lines.push(
    `Force Comp: Leaders ${comp.leaders}/1 · Core ${comp.core} (need ≥ ${comp.requiredCore}) · Special ${comp.special} · Champions ${comp.champions}/${maxChampions}`
  );
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
