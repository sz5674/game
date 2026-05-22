"""Scan Yugo Puzzle addressable bundles for level layout MonoBehaviours."""
from pathlib import Path
import UnityPy

BASE = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Yugo Puzzle\YUGO PUZZLE_Data\StreamingAssets\aa\StandaloneWindows64"
)

INTERESTING = (
    "data",
    "block",
    "board",
    "mesh",
    "wall",
    "moveable",
    "tile",
    "grid",
    "record",
    "vp",
)


def main():
    for bundle in sorted(BASE.glob("*.bundle")):
        try:
            env = UnityPy.load(str(bundle))
        except Exception:
            continue
        for obj in env.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            d = obj.read()
            custom = [
                k
                for k in d.__dict__
                if not k.startswith("_")
                and k not in ("object_reader", "m_Enabled", "m_GameObject", "m_Name", "m_Script")
                and any(x in k.lower() for x in INTERESTING)
                and not k.startswith("m_Material")
                and not k.startswith("m_Color")
                and not k.startswith("m_Raycast")
                and not k.startswith("m_text")
                and not k.startswith("m_font")
            ]
            if not custom:
                continue
            nonempty = []
            for k in custom:
                v = getattr(d, k)
                if v is None:
                    continue
                if isinstance(v, (list, tuple)) and len(v) == 0:
                    continue
                if hasattr(v, "width") and getattr(v, "width", 0) == 0:
                    continue
                nonempty.append((k, repr(v)[:120]))
            if nonempty:
                print(f"\n=== {bundle.name} ===")
                for k, s in nonempty[:8]:
                    print(f"  {k}: {s}")


if __name__ == "__main__":
    main()
