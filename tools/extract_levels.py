"""
Extract Yugo Puzzle levels from a local Steam install into js/levels.json.
Requires: pip install UnityPy
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import UnityPy

STEAM_AA = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Yugo Puzzle\YUGO PUZZLE_Data\StreamingAssets\aa"
)
BUNDLES = STEAM_AA / "StandaloneWindows64"
INIT_BUNDLE = BUNDLES / "ebebc0b3ac40d867a0ff0390713f7973.bundle"
BLOCKS_BUNDLE = BUNDLES / "5b8b992f66b6aa3ab3ff4e513d36c41b.bundle"
OUT = Path(__file__).resolve().parent.parent / "js" / "levels.json"

# Observed tile index -> char (IntroA calibration)
IDX_CHAR = {
    0: " ",
    1: "x",
    2: "r",
    3: "b",
    4: "g",
    5: "y",
    6: "k",  # black / anchor
    7: "x",  # edge / special tile — solid for gameplay
    8: "x",  # stake / thin platform
    9: "x",  # stake segment
}


def load_level_list() -> list[dict]:
    env = UnityPy.load(str(INIT_BUNDLE))
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        d = obj.read()
        if getattr(d, "m_Name", "") == "Basic" and hasattr(d, "sceneData"):
            rows = []
            for i, sd in enumerate(d.sceneData):
                if getattr(sd, "isSubLv", 0):
                    continue
                rows.append(
                    {
                        "id": i + 1,
                        "scene": sd.sceneName.name,
                        "grid": bool(sd.gridAvailable),
                    }
                )
                if len(rows) >= 40:
                    return rows
    raise RuntimeError("Could not read Basic level list from InitializerTable")


def find_scene_bundle(scene: str) -> Path | None:
    needle = scene.encode()
    for bundle in BUNDLES.glob("*.bundle"):
        data = bundle.read_bytes()
        if needle in data[: min(len(data), 500_000)]:
            return bundle
    return None


def extract_tilemap(env: UnityPy.Environment) -> list[str] | None:
    best = None
    best_n = 0
    for obj in env.objects:
        if obj.type.name != "Tilemap":
            continue
        d = obj.read()
        try:
            go_name = d.m_GameObject.deref().read().m_Name
        except Exception:
            go_name = ""
        if go_name == "HintTilemap":
            continue
        n = len(d.m_Tiles)
        if n > best_n:
            best_n = n
            best = d
    if not best or best_n < 4:
        return None

    minx = min(p.x for p, _ in best.m_Tiles)
    maxx = max(p.x for p, _ in best.m_Tiles)
    miny = min(p.y for p, _ in best.m_Tiles)
    maxy = max(p.y for p, _ in best.m_Tiles)
    w, h = maxx - minx + 1, maxy - miny + 1
    grid = [[" "] * w for _ in range(h)]
    for pos, tile in best.m_Tiles:
        ch = IDX_CHAR.get(tile.m_TileIndex, "?")
        grid[maxy - pos.y][pos.x - minx] = ch
    # trim empty rows/cols
    while grid and all(c == " " for c in grid[0]):
        grid.pop(0)
    while grid and all(c == " " for c in grid[-1]):
        grid.pop()
    if not grid:
        return None
    w = len(grid[0])
    while w > 0 and all(row[-1] == " " for row in grid):
        for row in grid:
            row.pop()
        w -= 1
    while w > 0 and all(row[0] == " " for row in grid):
        for row in grid:
            row.pop(0)
        w -= 1
    return ["".join(row) for row in grid]


def main() -> None:
    if not BLOCKS_BUNDLE.is_file():
        raise SystemExit(f"Game not found at {BLOCKS_BUNDLE}")

    meta = load_level_list()
    blocks_env = UnityPy.load(str(BLOCKS_BUNDLE))
    levels: list[dict] = []
    missing: list[str] = []

    for m in meta:
        scene = m["scene"]
        bundle = find_scene_bundle(scene)
        if not bundle:
            missing.append(scene)
            continue
        env = UnityPy.Environment()
        env.load_file(str(BLOCKS_BUNDLE))
        env.load_file(str(bundle))
        rows = extract_tilemap(env)
        if not rows:
            missing.append(scene)
            continue
        levels.append(
            {
                "id": m["id"],
                "name": scene,
                "grid": m["grid"],
                "rows": rows,
            }
        )
        print(f"OK level {m['id']:2d} {scene} ({len(rows)}x{len(rows[0])})")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(levels, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {len(levels)} levels to {OUT}")
    if missing:
        print("Missing:", ", ".join(missing))


if __name__ == "__main__":
    main()
