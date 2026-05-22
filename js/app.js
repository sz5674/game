import { Stage } from "./engine.js";

const STORAGE_KEY = "yugopuzzle-web-progress";
const SETTINGS_KEY = "yugopuzzle-web-settings";

/** @type {{ id: number, name: string, grid: boolean, rows: string[] }[]} */
let LEVELS = [];

const $ = (sel) => document.querySelector(sel);

let currentLevel = 1;
/** @type {Stage | null} */
let stage = null;
/** @type {string[][]} */
let initialRows = [];

async function loadLevels() {
  const res = await fetch("./js/levels.json");
  LEVELS = await res.json();
  const has38 = LEVELS.some((l) => l.id === 38);
  if (!has38) {
    const lv37 = LEVELS.find((l) => l.id === 37);
    if (lv37) {
      LEVELS.push({ ...lv37, id: 38, name: "Pencil2 (未取得)" });
      LEVELS.sort((a, b) => a.id - b.id);
    }
  }
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function loadSettings() {
  try {
    return {
      dark: true,
      faces: false,
      grid: false,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { dark: true, faces: false, grid: false };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function applyTheme(settings) {
  document.documentElement.dataset.theme = settings.dark ? "dark" : "light";
  $("#opt-dark").checked = settings.dark;
  $("#opt-faces").checked = settings.faces;
  $("#opt-grid").checked = settings.grid;
  const btnGrid = $("#btn-grid");
  if (btnGrid) {
    btnGrid.setAttribute("aria-pressed", settings.grid ? "true" : "false");
    btnGrid.classList.toggle("active", settings.grid);
  }
}

function applyGrid(settings) {
  const map = $("#map");
  if (map) map.classList.toggle("show-grid", settings.grid);
  if (stage) stage.setShowGrid(settings.grid);
}

function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}

/** レベル6 または 15以降は盤面を薄くして修正中表示 */
function isLevelWip(lv) {
  return !!lv.wip || lv.id >= 15;
}

function mountLevel(id) {
  stopClearCelebration();
  const lv = getLevel(id);
  if (!lv) return;
  currentLevel = lv.id;
  initialRows = lv.rows;
  const settings = loadSettings();
  const map = $("#map");
  const wip = isLevelWip(lv);
  map.classList.toggle("level-wip", wip);
  const wipOverlay = $("#wip-overlay");
  if (wipOverlay) wipOverlay.hidden = !wip;
  applyGrid(settings);

  stage = new Stage(map, lv.rows, {
    showGrid: settings.grid,
    faces: settings.faces,
    onClear: () => onLevelClear(lv.id),
  });

  $("#level-label").textContent = wip ? `Level ${lv.id}（修正中）` : `Level ${lv.id}`;
  updateMenuHighlight();
}

function stopClearCelebration() {
  document.body.classList.remove("clear-celebrate");
  const fx = $("#clear-fx");
  if (fx) fx.innerHTML = "";
  stage?.stopClearParty?.();
}

function playClearCelebration(levelId) {
  stopClearCelebration();
  document.body.classList.add("clear-celebrate");
  stage?.playClearParty?.();

  const fx = $("#clear-fx");
  if (fx) {
    const burst = document.createElement("div");
    burst.className = "clear-burst";
    fx.appendChild(burst);
    const colors = ["var(--accent)", "var(--muted)", "var(--surface)"];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDelay = `${Math.random() * 0.25}s`;
      p.style.animationDuration = `${1.4 + Math.random() * 0.6}s`;
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
      p.style.setProperty("--rot", `${Math.random() * 360}deg`);
      fx.appendChild(p);
    }
  }

  const num = $("#clear-level-num");
  if (num) num.textContent = String(levelId);

  window.setTimeout(() => {
    const dialog = $("#clear-dialog");
    if (dialog && !dialog.open) dialog.showModal();
  }, 380);
}

function onLevelClear(id) {
  const progress = loadProgress();
  progress[id] = true;
  progress.last = id;
  saveProgress(progress);
  playClearCelebration(id);
  renderLevelGrid();
}

function renderLevelGrid() {
  const progress = loadProgress();
  const grid = $("#level-grid");
  grid.innerHTML = "";
  for (const lv of LEVELS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(lv.id);
    if (progress[lv.id]) btn.classList.add("cleared");
    if (isLevelWip(lv)) btn.classList.add("wip");
    if (lv.id === currentLevel) btn.classList.add("current");
    btn.addEventListener("click", () => {
      mountLevel(lv.id);
      $("#menu-dialog").close();
    });
    grid.appendChild(btn);
  }
}

function updateMenuHighlight() {
  renderLevelGrid();
}

function bindUI() {
  $("#btn-undo").addEventListener("click", () => stage?.undo());
  $("#btn-reset").addEventListener("click", () => stage?.reset(initialRows));
  $("#btn-prev").addEventListener("click", () => {
    const i = LEVELS.findIndex((l) => l.id === currentLevel);
    if (i > 0) mountLevel(LEVELS[i - 1].id);
  });
  $("#btn-next").addEventListener("click", () => {
    const i = LEVELS.findIndex((l) => l.id === currentLevel);
    if (i >= 0 && i < LEVELS.length - 1) mountLevel(LEVELS[i + 1].id);
  });
  $("#btn-menu").addEventListener("click", () => {
    renderLevelGrid();
    $("#menu-dialog").showModal();
  });
  $("#btn-settings").addEventListener("click", () => $("#settings-dialog").showModal());

  $("#btn-grid").addEventListener("click", () => {
    const settings = loadSettings();
    settings.grid = !settings.grid;
    saveSettings(settings);
    applyTheme(settings);
    applyGrid(settings);
  });

  $("#clear-dialog").addEventListener("close", (e) => {
    stopClearCelebration();
    if (e.target.returnValue === "next") {
      const i = LEVELS.findIndex((l) => l.id === currentLevel);
      if (i >= 0 && i < LEVELS.length - 1) mountLevel(LEVELS[i + 1].id);
    }
  });

  for (const id of ["opt-dark", "opt-faces", "opt-grid"]) {
    $(`#${id}`).addEventListener("change", () => {
      const settings = {
        dark: $("#opt-dark").checked,
        faces: $("#opt-faces").checked,
        grid: $("#opt-grid").checked,
      };
      saveSettings(settings);
      applyTheme(settings);
      applyGrid(settings);
      if (id === "opt-dark" || id === "opt-faces") mountLevel(currentLevel);
    });
  }
}

async function main() {
  await loadLevels();
  const settings = loadSettings();
  applyTheme(settings);
  bindUI();

  const progress = loadProgress();
  const start = progress.last ? Math.min(progress.last + 1, LEVELS[LEVELS.length - 1].id) : 1;
  const startLv = LEVELS.find((l) => l.id === start) ? start : 1;
  mountLevel(startLv);
}

main().catch((err) => {
  console.error(err);
  $("#level-label").textContent =
    "読み込み失敗（ローカルサーバーで開いてください）";
});
