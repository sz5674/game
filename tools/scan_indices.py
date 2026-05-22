from pathlib import Path
import UnityPy
from collections import Counter

STEAM_AA = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Yugo Puzzle\YUGO PUZZLE_Data\StreamingAssets\aa\StandaloneWindows64"
)
BLOCKS = STEAM_AA / "5b8b992f66b6aa3ab3ff4e513d36c41b.bundle"
INIT = STEAM_AA.parent / "ebebc0b3ac40d867a0ff0390713f7973.bundle"


def level_list():
    env = UnityPy.load(str(INIT))
    for obj in env.objects:
        if obj.type.name == "MonoBehaviour":
            d = obj.read()
            if getattr(d, "m_Name", "") == "Basic":
                out = []
                for sd in d.sceneData:
                    if getattr(sd, "isSubLv", 0):
                        continue
                    out.append(sd.sceneName.name)
                    if len(out) >= 40:
                        return out
    return []


def find_bundle(scene: str) -> Path | None:
    for bundle in STEAM_AA.glob("*.bundle"):
        if scene.encode() in bundle.read_bytes()[:500_000]:
            return bundle
    return None


def main():
    all_idx = Counter()
    per_level = {}
    for scene in level_list():
        bundle = find_bundle(scene)
        if not bundle:
            continue
        env = UnityPy.Environment()
        env.load_file(str(BLOCKS))
        env.load_file(str(bundle))
        c = Counter()
        for obj in env.objects:
            if obj.type.name != "Tilemap":
                continue
            d = obj.read()
            if len(d.m_Tiles) < 20:
                continue
            for _, t in d.m_Tiles:
                c[t.m_TileIndex] += 1
        if c:
            per_level[scene] = dict(c)
            all_idx.update(c)
    print("All indices:", dict(sorted(all_idx.items())))
    for scene, c in sorted(per_level.items()):
        if set(c) - {0, 1, 2, 3, 4, 5, 6}:
            print(scene, c)


if __name__ == "__main__":
    main()
