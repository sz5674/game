import re
from pathlib import Path

dll = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Yugo Puzzle\YUGO PUZZLE_Data\Managed\Assembly-CSharp.dll"
)
data = dll.read_bytes()
strings = set(m.group().decode("ascii", "ignore") for m in re.finditer(rb"[\x20-\x7e]{4,}", data))
for s in sorted(strings):
    if any(x in s for x in ("Block", "Level", "Board", "Jelly", "Tile", "Grid", "Scene", "Move")):
        if len(s) < 80:
            print(s)
