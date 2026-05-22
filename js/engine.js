/** @typedef {[number, number, JellyCell]} CellCoord */

/** @deprecated 互換用。実サイズは CSS の --cell を参照 */
export const CELL_SIZE = 42;

/** 盤面の実マス幅（描画済み td を測る。CSS 変数だけだとゼリーがずれる） */
export function cellSize() {
  if (typeof document === "undefined") return CELL_SIZE;
  const map = document.getElementById("map");
  if (map) {
    const td = map.querySelector("table td");
    if (td) {
      const w = td.getBoundingClientRect().width;
      if (w > 0) return w;
    }
  }
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell"));
  return Number.isFinite(n) && n > 0 ? n : CELL_SIZE;
}

function syncCellCssVar() {
  const s = cellSize();
  document.documentElement.style.setProperty("--cell", `${s}px`);
}

export const COLORS = {
  black: "hsl(0, 0%, 35%)",
  blackk: "hsl(0, 0%, 35%)",
  red: "hsl(0, 85%, 68%)",
  green: "hsl(120, 55%, 48%)",
  blue: "hsl(216, 75%, 62%)",
  yellow: "hsl(48, 90%, 55%)",
};

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

function moveToCell(dom, x, y) {
  const s = cellSize();
  dom.style.left = `${x * s}px`;
  dom.style.top = `${y * s}px`;
}

export class Wall {
  constructor(td) {
    this.dom = td;
  }
}

export class JellyCell {
  constructor(color) {
    this.color = color;
    this.colorMaster = this;
    this.color_mates = [this];
    this.jelly = null;
    this.x = 0;
    this.y = 0;
    this.dom = document.createElement("div");
    this.dom.className = "jelly-cell";
    this.dom.style.background = COLORS[color] || COLORS.black;
  }

  mergeWith(other, dir) {
    if (other instanceof Wall) {
      this.jelly.immovable = true;
    }
    if (
      other instanceof JellyCell &&
      this.color === other.color &&
      this.colorMaster !== other.colorMaster
    ) {
      const otherMaster = other.colorMaster;
      for (const cell of otherMaster.color_mates) {
        cell.colorMaster = this.colorMaster;
      }
      this.colorMaster.color_mates =
        this.colorMaster.color_mates.concat(otherMaster.color_mates);
    }
    if (other instanceof JellyCell && this.jelly !== other.jelly) {
      this.jelly.merge(other.jelly);
    }
  }
}

export class Jelly {
  /**
   * @param {Stage} stage
   * @param {JellyCell} cell
   * @param {number} x
   * @param {number} y
   */
  constructor(stage, cell, x, y) {
    this.stage = stage;
    this.x = x;
    this.y = y;
    this.immovable = false;
    this.dom = document.createElement("div");
    this.dom.className = "jellybox";
    this.updatePosition(x, y);
    cell.jelly = this;
    this.cells = [cell];
    this.dom.appendChild(cell.dom);
    this._bindPointer();
  }

  cellCoords() {
    return this.cells.map((cell) => [this.x + cell.x, this.y + cell.y, cell]);
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
    moveToCell(this.dom, x, y);
  }

  merge(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    for (const cell of other.cells) {
      this.cells.push(cell);
      cell.x += dx;
      cell.y += dy;
      cell.jelly = this;
      moveToCell(cell.dom, cell.x, cell.y);
      this.dom.appendChild(cell.dom);
    }
    if (other.immovable) this.immovable = true;
    other.cells = null;
    other.dom.remove();
  }

  _bindPointer() {
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    let acted = false;

    const onDown = (e) => {
      if (this.stage.busy) return;
      const p = pointer(e);
      startX = p.x;
      startY = p.y;
      pointerId = e.pointerId;
      acted = false;
      this.dom.setPointerCapture(e.pointerId);
      this.dom.classList.add("dragging");
      e.preventDefault();
    };

    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      this.dom.releasePointerCapture(e.pointerId);
      this.dom.classList.remove("dragging");
      pointerId = null;
      if (acted || this.stage.busy) return;

      const p = pointer(e);
      const dx = p.x - startX;
      const dy = p.y - startY;
      // 方向だけ判定。距離・ホールド時間は無視し、常に1マスだけ
      const minSwipe = 8;
      if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return;
      if (Math.abs(dx) < Math.abs(dy)) return;

      acted = true;
      this.stage.trySlide(this, dx > 0 ? 1 : -1);
      e.preventDefault();
    };

    this.dom.addEventListener("pointerdown", onDown);
    this.dom.addEventListener("pointerup", onUp);
    this.dom.addEventListener("pointercancel", onUp);
  }
}

function pointer(e) {
  if (e.changedTouches?.[0]) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

export class Stage {
  /**
   * @param {HTMLElement} dom
   * @param {string[]} rows
   * @param {{ showGrid?: boolean, faces?: boolean, onClear?: () => void, onStateChange?: () => void }} opts
   */
  constructor(dom, rows, opts = {}) {
    this.dom = dom;
    this.opts = opts;
    this.jellies = [];
    this.history = [];
    this.busy = false;
    this.num_monochromatic_blocks = 0;
    this.num_colors = 0;
    this.loadMap(rows);
    this.checkForMerges();
    if (opts.showGrid) this.dom.classList.add("show-grid");
    this.dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _notifyStateChange() {
    this.opts.onStateChange?.();
  }

  setShowGrid(on) {
    this.dom.classList.toggle("show-grid", on);
  }

  playClearParty() {
    this.dom.querySelectorAll(".jellybox").forEach((el) => {
      el.classList.add("clear-party");
    });
  }

  stopClearParty() {
    this.dom.querySelectorAll(".jellybox").forEach((el) => {
      el.classList.remove("clear-party");
    });
  }

  loadMap(rows) {
    const table = document.createElement("table");
    this.dom.innerHTML = "";
    this.dom.appendChild(table);
    const colors = {};
    this.cells = rows.map((row, y) => {
      const tr = document.createElement("tr");
      table.appendChild(tr);
      return [...row].map((ch, x) => {
        const td = document.createElement("td");
        let cell = null;
        if (ch === "x") {
          td.className = "cell wall";
          cell = new Wall(td);
        } else {
          td.className = "cell transparent";
          let color = null;
          if (ch === "r") color = "red";
          else if (ch === "g") color = "green";
          else if (ch === "b") color = "blue";
          else if (ch === "y") color = "yellow";
          else if (ch === "k" || ch >= "0" && ch <= "9") color = "black";
          if (color) {
            const jellyCell = new JellyCell(color);
            const jelly = new Jelly(this, jellyCell, x, y);
            if (this.opts.faces) jellyCell.dom.classList.add("face");
            this.dom.appendChild(jelly.dom);
            this.jellies.push(jelly);
            this.num_monochromatic_blocks += 1;
            if (!(color in colors)) {
              this.num_colors += 1;
              colors[color] = 1;
            }
            cell = jellyCell;
          }
        }
        tr.appendChild(td);
        return cell;
      });
    });
    this.addBorders();
    void this.dom.offsetWidth;
    syncCellCssVar();
    for (const jelly of this.jellies) this.refreshJellyBorders(jelly);
    requestAnimationFrame(() => {
      this.remountLayout();
      requestAnimationFrame(() => this.remountLayout());
    });
  }

  /** 描画後のマス幅にゼリー位置・サイズを合わせる */
  remountLayout() {
    if (!this.cells?.[0]?.length) return;
    syncCellCssVar();
    const s = cellSize();
    const cols = this.cells[0].length;
    const rows = this.cells.length;
    this.dom.style.width = `${cols * s}px`;
    this.dom.style.height = `${rows * s}px`;
    for (const jelly of this.jellies) {
      if (!jelly.cells?.length) continue;
      jelly.updatePosition(jelly.x, jelly.y);
      for (const cell of jelly.cells) moveToCell(cell.dom, cell.x, cell.y);
      this.refreshJellyBorders(jelly);
    }
  }

  /** 合体後は内側の境目を消し、外周だけ丸めて一体の形にする */
  refreshJellyBorders(jelly) {
    const set = new Set(jelly.cells.map((c) => `${c.x},${c.y}`));
    const has = (x, y) => set.has(`${x},${y}`);
    const cs = cellSize();
    const R = `${Math.max(4, Math.round(cs * 0.26))}px`;
    const line = "rgba(0, 0, 0, 0.12)";
    const seam = Math.max(1, Math.round(cs * 0.05));
    const merged = jelly.cells.length > 1;

    jelly.dom.classList.toggle("is-merged", merged);

    for (const cell of jelly.cells) {
      const { x, y } = cell;
      const top = !has(x, y - 1);
      const bottom = !has(x, y + 1);
      const left = !has(x - 1, y);
      const right = !has(x + 1, y);
      const s = cell.dom.style;
      s.border = "none";
      s.outline = "none";
      s.marginLeft = "0";
      s.marginTop = "0";
      s.borderRadius = `${top && left ? R : "0"} ${top && right ? R : "0"} ${bottom && right ? R : "0"} ${bottom && left ? R : "0"}`;
      let w = cs;
      let h = cs;
      if (merged && has(x + 1, y)) w += seam;
      if (merged && has(x, y + 1)) h += seam;
      s.width = `${w}px`;
      s.height = `${h}px`;
      s.zIndex = "1";
      const edge = [];
      if (top) edge.push(`inset 0 2px 0 0 ${line}`);
      if (bottom) edge.push(`inset 0 -2px 0 0 ${line}`);
      if (left) edge.push(`inset 2px 0 0 0 ${line}`);
      if (right) edge.push(`inset -2px 0 0 0 ${line}`);
      s.boxShadow = edge.length ? edge.join(", ") : "none";
    }
  }

  addBorders() {
    const edges = [
      ["borderBottom", 0, 1],
      ["borderTop", 0, -1],
      ["borderLeft", -1, 0],
      ["borderRight", 1, 0],
    ];
    for (let y = 0; y < this.cells.length; y++) {
      for (let x = 0; x < this.cells[0].length; x++) {
        const cell = this.cells[y][x];
        if (!(cell instanceof Wall)) continue;
        for (const [attr, dx, dy] of edges) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= this.cells.length || nx < 0 || nx >= this.cells[0].length)
            continue;
          const other = this.cells[ny][nx];
          if (!(other instanceof Wall)) {
            cell.dom.style[attr] = "solid 1px rgba(128,128,128,0.35)";
          }
        }
      }
    }
  }

  saveForUndo() {
    this.history.push(this.snapshot());
  }

  snapshot() {
    const rows = this.cells.map((row) => row.map(() => " "));
    for (let y = 0; y < this.cells.length; y++) {
      for (let x = 0; x < this.cells[0].length; x++) {
        const cell = this.cells[y][x];
        if (cell instanceof Wall) rows[y][x] = "x";
        else if (cell instanceof JellyCell) {
          const map = { red: "r", green: "g", blue: "b", yellow: "y", black: "k" };
          rows[y][x] = map[cell.color] || "k";
        }
      }
    }
    return rows;
  }

  restore(rows, { keepHistory = false } = {}) {
    this.dom.innerHTML = "";
    this.jellies = [];
    if (!keepHistory) this.history = [];
    this.busy = false;
    this.num_monochromatic_blocks = 0;
    this.num_colors = 0;
    this.loadMap(rows);
    this.checkForMerges();
  }

  waitForAnimation(cb, ms = 125) {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      this.dom.removeEventListener("transitionend", end);
      requestAnimationFrame(cb);
    };
    this.dom.addEventListener("transitionend", end);
    setTimeout(end, ms);
  }

  /** 下に床（壁またはゼリー）があるか */
  isGrounded(jelly) {
    for (const [x, y] of jelly.cellCoords()) {
      const below = this.cells[y + 1]?.[x];
      if (below) return true;
    }
    return false;
  }

  /**
   * 横1マス。他色は押し出し、段差1マス以上は不可。移動時もジャンプ演出。
   */
  trySlide(jelly, dir) {
    if (!jelly || this.busy) return;
    const group = this.collectSlideGroup(jelly, dir);
    if (!group) {
      jelly.dom.style.setProperty("--slide-dir", String(dir));
      jelly.dom.dataset.dir = String(dir);
      this.playHop(jelly, "hop-fail");
      return;
    }

    this.busy = true;
    this.saveForUndo();
    const anyAirborne = group.some((j) => !this.isGrounded(j));
    for (const j of group) {
      j.dom.dataset.dir = String(dir);
      j.dom.style.setProperty("--slide-dir", String(dir));
      j.dom.classList.add("sliding");
      if (!this.isGrounded(j)) j.dom.classList.add("airborne");
    }

    this.move(group, dir, 0);
    this.waitForAnimation(() => {
      this.checkFall(() => {
        this.checkForMerges();
        this.dom.querySelectorAll(".jellybox").forEach((el) => {
          el.classList.remove("sliding", "falling", "airborne", "drop-impact");
          el.style.removeProperty("--slide-dir");
          delete el.dataset.dir;
        });
        this.busy = false;
        this._notifyStateChange();
      });
    }, anyAirborne ? 65 : 125);
  }

  /**
   * 移動するゼリー一式（押し出し連鎖を含む）。不可なら null
   * @param {Jelly} actor スワイプしたブロック（右上壁判定は actor のみ）
   */
  collectSlideGroup(actor, dir) {
    const stack = [actor];
    let done = false;

    while (!done) {
      done = true;
      for (const j of stack) {
        if (j.immovable) return null;
        for (const [x, y] of j.cellCoords()) {
          const tx = x + dir;
          if (tx < 0 || tx >= this.cells[0].length) return null;

          // 真上が空き＝ジャンプ移動。右上/左上が壁なら(actorのみ)不可、色ブロックなら押し込む
          if (y > 0) {
            const headroom = !this.cells[y - 1]?.[x];
            if (headroom) {
              const corner = this.cells[y - 1]?.[tx];
              if (j === actor && corner instanceof Wall) return null;
              if (corner instanceof JellyCell && corner.jelly && !stack.includes(corner.jelly)) {
                // 移動グループの上に乗っているブロックは押さない（横並びの上に載った別色など）
                const ridesOnStack = stack.some((sj) =>
                  sj.cellCoords().some(([cx, cy]) => cx === tx && cy === y)
                );
                if (!ridesOnStack) {
                  stack.push(corner.jelly);
                  done = false;
                }
              }
            }
          }

          const next = this.cells[y]?.[tx];
          if (next instanceof Wall) return null;
          if (!next) continue;
          if (!next.jelly) return null;
          if (!stack.includes(next.jelly)) {
            stack.push(next.jelly);
            done = false;
          }
        }
      }
    }
    return stack;
  }

  /** 列 tx の row から落下したときに止まる行（y が小さいほど高い） */
  landingRow(tx, fromY) {
    const h = this.cells.length;
    for (let y = fromY; y < h; y++) {
      const below = this.cells[y + 1]?.[tx];
      if (below instanceof Wall) return y;
      if (this.cells[y][tx] instanceof Wall) return null;
    }
    return null;
  }

  /** その場ジャンプ（失敗時 hop-fail / 成功時は hop-move を trySlide 側で付与） */
  playHop(jelly, className = "hop-fail") {
    if (this.busy) return;
    this.busy = true;
    jelly.dom.classList.remove("sliding");
    jelly.dom.classList.add(className);
    const done = () => {
      jelly.dom.classList.remove(className);
      jelly.dom.style.removeProperty("--slide-dir");
      delete jelly.dom.dataset.dir;
      this.busy = false;
    };
    jelly.dom.addEventListener("animationend", done, { once: true });
    setTimeout(done, 170);
  }

  move(jellies, dx, dy) {
    for (const jelly of jellies) {
      for (const [x, y] of jelly.cellCoords()) {
        this.cells[y][x] = null;
      }
    }
    for (const jelly of jellies) {
      jelly.updatePosition(jelly.x + dx, jelly.y + dy);
    }
    for (const jelly of jellies) {
      for (const [x, y, cell] of jelly.cellCoords()) {
        this.cells[y][x] = cell;
      }
    }
  }

  checkFilled(jellies, dx, dy) {
    let done = false;
    while (!done) {
      done = true;
      for (const jelly of [...jellies]) {
        if (jelly.immovable) return true;
        for (const [x, y] of jelly.cellCoords()) {
          const next = this.cells[y + dy]?.[x + dx];
          if (!next) continue;
          if (!next.jelly) return true;
          if (!jellies.includes(next.jelly)) {
            jellies.push(next.jelly);
            done = false;
            break;
          }
        }
      }
    }
    return false;
  }

  checkFall(cb) {
    let moved = false;
    let again = true;
    while (again) {
      again = false;
      for (const jelly of this.jellies) {
        const set = [jelly];
        if (!this.checkFilled(set, 0, 1)) {
          for (const j of set) {
            j.dom.classList.add("sliding", "falling");
          }
          this.move(set, 0, 1);
          again = true;
          moved = true;
        }
      }
    }
    if (!moved) {
      cb();
      return;
    }
    this.waitForAnimation(() => {
      const landed = this.dom.querySelectorAll(".jellybox.falling");
      landed.forEach((el) => {
        el.classList.remove("falling");
        el.classList.add("drop-impact");
      });
      setTimeout(() => {
        landed.forEach((el) => el.classList.remove("drop-impact"));
        cb();
      }, 75);
    }, 70);
  }

  checkForMerges() {
    let merged = false;
    while (this.doOneMerge()) merged = true;
    if (merged) this.checkForCompletion();
    this.remountLayout();
  }

  doOneMerge() {
    const dirs = ["left", "right", "up", "down"];
    for (let y = 0; y < this.cells.length; y++) {
      for (let x = 0; x < this.cells[0].length; x++) {
        const cell = this.cells[y][x];
        if (!(cell instanceof JellyCell) || !cell.jelly) continue;
        for (const d of dirs) {
          const { x: dx, y: dy } = DIRS[d];
          const other = this.cells[y + dy]?.[x + dx];
          if (
            other instanceof JellyCell &&
            cell.color === other.color &&
            cell.jelly !== other.jelly
          ) {
            cell.mergeWith(other, d);
            this.jellies = this.jellies.filter((j) => j.cells);
            return true;
          }
        }
      }
    }
    return false;
  }

  checkForCompletion() {
    const countByColor = {};
    for (const jelly of this.jellies) {
      if (!jelly.cells?.length) continue;
      const c = jelly.cells[0].color;
      if (c === "black") continue;
      countByColor[c] = (countByColor[c] || 0) + 1;
    }
    const colors = Object.keys(countByColor);
    if (colors.length && colors.every((c) => countByColor[c] === 1) && this.opts.onClear) {
      this.opts.onClear();
    }
  }

  undo() {
    if (this.busy || !this.history.length) return;
    const prev = this.history.pop();
    this.restore(prev, { keepHistory: true });
    this._notifyStateChange();
  }

  reset(rows) {
    this.restore(rows);
    this._notifyStateChange();
  }
}
