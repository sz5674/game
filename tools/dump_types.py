import dnfile
from dnfile.mdtable import TypeDefRow

path = r"C:\Program Files (x86)\Steam\steamapps\common\Yugo Puzzle\YUGO PUZZLE_Data\Managed\Assembly-CSharp.dll"
pe = dnfile.dnPE(path)

targets = {"BlockMeshM", "BlockM", "Block", "BlockMeshSet", "BlockMesh", "GridM", "ReplaceTile"}
for row in pe.net.mdtables.TypeDef:
    name = str(row.TypeName) if row.TypeName else ""
    if name not in targets:
        continue
    print(f"\n=== {name} ===")
    if not row.FieldList:
        continue
    parent_rid = row.rid
    for f in pe.net.mdtables.Field:
        if f.Parent and f.Parent.rid == parent_rid:
            print(" ", str(f.Name) if f.Name else "")
