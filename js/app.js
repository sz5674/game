import { Stage, coerceBoardRows } from "./engine.js?v=18";

const STORAGE_KEY = "yugopuzzle-web-progress";
const SETTINGS_KEY = "yugopuzzle-web-settings";
/** 盤面保存形式の版（上げると boards を一度クリアしてずれを防ぐ） */
const PROGRESS_SCHEMA = 3;
/** レベルごとの「戻す」履歴の最大手数（localStorage 容量対策） */
const MAX_UNDO_HISTORY = 80;

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

/** @returns {{ lastLevel: number, cleared: Record<number, boolean>, boards: Record<number, string[]>, histories: Record<number, string[][][]> }} */
function normalizeProgress(raw) {
  const cleared = {};
  const boards = {};
  const histories = {};
  let lastLevel = 1;
  if (raw && typeof raw === "object") {
    if (raw.cleared && typeof raw.cleared === "object") {
      for (const [k, v] of Object.entries(raw.cleared)) {
        if (v) cleared[Number(k)] = true;
      }
      lastLevel = Number(raw.lastLevel ?? raw.last) || 1;
    } else {
      for (const [k, v] of Object.entries(raw)) {
        if (k === "last" || k === "lastLevel") lastLevel = Number(v) || 1;
        else if (k === "boards" && v && typeof v === "object") {
          /* boards handled below */
        } else if (v === true) cleared[Number(k)] = true;
      }
    }
    if (raw.boards && typeof raw.boards === "object") {
      for (const [k, rows] of Object.entries(raw.boards)) {
        if (Array.isArray(rows)) boards[Number(k)] = rows.map((r) => String(r));
      }
    }
    if (raw.histories && typeof raw.histories === "object") {
      for (const [k, stack] of Object.entries(raw.histories)) {
        if (!Array.isArray(stack)) continue;
        const snaps = stack
          .filter((snap) => Array.isArray(snap))
          .map((snap) => snap.map((r) => String(r)));
        if (snaps.length) histories[Number(k)] = snaps;
      }
    }
  }
  const schemaVersion = Number(raw?.schemaVersion) || 1;
  return { lastLevel, cleared, boards, histories, schemaVersion };
}

function loadProgress() {
  try {
    const p = normalizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    if ((p.schemaVersion ?? 1) < PROGRESS_SCHEMA) {
      return {
        lastLevel: p.lastLevel || 1,
        cleared: p.cleared,
        boards: {},
        histories: {},
        schemaVersion: PROGRESS_SCHEMA,
      };
    }
    return p;
  } catch {
    return { lastLevel: 1, cleared: {}, boards: {}, histories: {}, schemaVersion: PROGRESS_SCHEMA };
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastLevel: progress.lastLevel,
        cleared: progress.cleared,
        boards: progress.boards ?? {},
        histories: progress.histories ?? {},
        schemaVersion: PROGRESS_SCHEMA,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.warn("進行状況を保存できませんでした（ストレージ制限の可能性）", err);
  }
}

function boardDimensions(rows) {
  const lines = rows.map((r) => String(r));
  return { cols: Math.max(...lines.map((r) => r.length), 1), rows: lines.length };
}

/** 保存盤面をレベル定義の行数・列数に合わせる（行長ぶれは切り詰め／パディング） */
function normalizeSavedBoard(rawRows, templateRows) {
  const lines = coerceBoardRows(rawRows);
  if (!lines?.length) return null;
  const expected = boardDimensions(templateRows);
  if (lines.length !== expected.rows) return null;
  return lines.map((line) => line.padEnd(expected.cols, " ").slice(0, expected.cols));
}

function loadBoardState(levelId) {
  const rows = loadProgress().boards[levelId];
  if (!rows?.length) return null;
  const lv = getLevel(levelId);
  if (!lv?.rows?.length) return coerceBoardRows(rows);
  return normalizeSavedBoard(rows, lv.rows);
}

function clearBoardState(levelId) {
  const progress = loadProgress();
  let changed = false;
  if (progress.boards[levelId]) {
    delete progress.boards[levelId];
    changed = true;
  }
  if (progress.histories?.[levelId]) {
    delete progress.histories[levelId];
    changed = true;
  }
  if (changed) saveProgress(progress);
}

function loadUndoHistory(levelId, templateRows) {
  const stacks = loadProgress().histories?.[levelId];
  if (!stacks?.length || !templateRows?.length) return [];
  const expected = boardDimensions(templateRows);
  const out = [];
  for (const snap of stacks) {
    const rows = coerceBoardRows(snap);
    if (!rows?.length) continue;
    const dims = boardDimensions(rows);
    if (dims.cols !== expected.cols || dims.rows !== expected.rows) continue;
    out.push(rows.map((r) => String(r)));
  }
  return out.length > MAX_UNDO_HISTORY ? out.slice(-MAX_UNDO_HISTORY) : out;
}

function persistUndoHistory(levelId = currentLevel) {
  if (!stage || !levelId) return;
  const progress = loadProgress();
  if (!progress.histories) progress.histories = {};
  const stack = stage.history.map((rows) => rows.map((r) => String(r)));
  progress.histories[levelId] =
    stack.length > MAX_UNDO_HISTORY ? stack.slice(-MAX_UNDO_HISTORY) : stack;
  saveProgress(progress);
}

function persistLevelSession(levelId = currentLevel, { force = false } = {}) {
  persistCurrentBoard(levelId, { force });
  persistUndoHistory(levelId);
}

/**
 * いまの盤面をレベルごとに保存（別レベルへ移る前・手を指したあと）
 * @param {{ force?: boolean }} opts force=true ならアニメ中でも保存（レベル切替時）
 */
function persistCurrentBoard(levelId = currentLevel, { force = false } = {}) {
  if (!stage || !levelId) return;
  if (!force && stage.busy) return;
  const progress = loadProgress();
  progress.boards[levelId] = stage.snapshot();
  saveProgress(progress);
}

function isLevelCleared(id) {
  return !!loadProgress().cleared[id];
}

function markLevelCleared(id) {
  const progress = loadProgress();
  progress.cleared[id] = true;
  progress.lastLevel = id;
  delete progress.boards[id];
  if (progress.histories?.[id]) delete progress.histories[id];
  saveProgress(progress);
}

function setLastPlayedLevel(id) {
  const progress = loadProgress();
  progress.lastLevel = id;
  saveProgress(progress);
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
  const gridState = $("#btn-grid-state");
  if (gridState) gridState.textContent = settings.grid ? "ON" : "OFF";
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

function updateChromeVar() {
  const header = $("#app > header.toolbar");
  const footer = $("#app > footer.toolbar");
  if (header && footer) {
    const chrome = header.offsetHeight + footer.offsetHeight + 16;
    document.documentElement.style.setProperty("--chrome-v", `${chrome}px`);
  }
}

function applyBoardSize(rows) {
  const { cols, rows: rowCount } = boardDimensions(rows);
  document.documentElement.style.setProperty("--board-cols", String(cols));
  document.documentElement.style.setProperty("--board-rows", String(rowCount));
}

function resetMapLayout() {
  const map = $("#map");
  if (map) {
    map.style.width = "";
    map.style.height = "";
  }
  document.documentElement.style.removeProperty("--cell");
}

/** ツールバー高さを CSS 変数に反映し、盤面レイアウトを再計算 */
function fitStageToViewport() {
  updateChromeVar();
  const fit = $("#stage-fit");
  const scaler = $("#stage-scaler");
  if (fit) {
    fit.style.width = "";
    fit.style.height = "";
  }
  if (scaler) {
    scaler.style.width = "";
    scaler.style.height = "";
    scaler.style.transform = "";
  }
  if (stage) stage.applyLayoutSync();
}

let stageFitToken = 0;
function scheduleStageFit() {
  const token = ++stageFitToken;
  const run = () => {
    if (token !== stageFitToken) return;
    fitStageToViewport();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function mountLevel(id) {
  stopClearCelebration();
  const lv = getLevel(id);
  if (!lv) return;

  if (stage && currentLevel !== lv.id) {
    persistLevelSession(currentLevel, { force: true });
  }

  currentLevel = lv.id;
  initialRows = lv.rows.map((r) => String(r));
  const savedRows = loadBoardState(lv.id);
  const playRows = savedRows ?? initialRows;

  const settings = loadSettings();
  const map = $("#map");
  const wip = isLevelWip(lv);
  map.classList.toggle("level-wip", wip);
  const wipOverlay = $("#wip-overlay");
  if (wipOverlay) wipOverlay.hidden = !wip;
  applyGrid(settings);
  resetMapLayout();
  applyBoardSize(initialRows);
  updateChromeVar();

  stage = new Stage(map, playRows, {
    showGrid: settings.grid,
    faces: settings.faces,
    onClear: () => onLevelClear(lv.id),
    onStateChange: () => persistCurrentBoard(lv.id),
  });
  const undoStack = loadUndoHistory(lv.id, initialRows);
  if (undoStack.length) stage.history = undoStack;

  const cleared = isLevelCleared(lv.id);
  let label = `Level ${lv.id}`;
  if (wip) label += "（修正中）";
  else if (cleared) label += "（クリア済）";
  $("#level-label").textContent = label;
  setLastPlayedLevel(lv.id);
  updateMenuHighlight();
  requestAnimationFrame(() => {
    updateChromeVar();
    stage?.applyLayoutSync();
  });
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
  markLevelCleared(id);
  playClearCelebration(id);
  const label = $("#level-label");
  if (label) label.textContent = `Level ${id}（クリア済）`;
  renderLevelGrid();
}

function renderLevelGrid() {
  const progress = loadProgress();
  const grid = $("#level-grid");
  grid.innerHTML = "";
  for (const lv of LEVELS) {
    const btn = document.createElement("button");
    btn.type = "button";
    const cleared = progress.cleared[lv.id];
    btn.innerHTML = `<span class="lv-num">${lv.id}</span>${
      cleared ? '<span class="lv-badge">クリア</span>' : ""
    }`;
    if (cleared) btn.classList.add("cleared");
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
  window.addEventListener("resize", scheduleStageFit);
  window.addEventListener("orientationchange", () => {
    setTimeout(scheduleStageFit, 100);
    setTimeout(scheduleStageFit, 500);
  });
  window.visualViewport?.addEventListener("resize", scheduleStageFit);
  window.addEventListener("pagehide", () => persistLevelSession(currentLevel, { force: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistLevelSession(currentLevel, { force: true });
    }
  });

  $("#btn-undo").addEventListener("click", () => {
    stage?.undo();
    persistUndoHistory(currentLevel);
    scheduleStageFit();
  });
  $("#btn-reset").addEventListener("click", () => {
    clearBoardState(currentLevel);
    stage?.reset(initialRows);
    persistCurrentBoard(currentLevel);
    scheduleStageFit();
  });
  $("#btn-prev").addEventListener("click", () => {
    const i = LEVELS.findIndex((l) => l.id === currentLevel);
    if (i > 0) mountLevel(LEVELS[i - 1].id);
  });
  $("#btn-next").addEventListener("click", () => {
    const i = LEVELS.findIndex((l) => l.id === currentLevel);
    if (i >= 0 && i < LEVELS.length - 1) mountLevel(LEVELS[i + 1].id);
  });
  $("#btn-menu").addEventListener("click", () => {
    persistLevelSession(currentLevel, { force: true });
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
  const startLv = LEVELS.some((l) => l.id === progress.lastLevel)
    ? progress.lastLevel
    : 1;
  mountLevel(startLv);
}

main().catch((err) => {
  console.error(err);
  $("#level-label").textContent =
    "読み込み失敗（ローカルサーバーで開いてください）";
});
