"""Print each GLB's world-space bounding box in game tiles (models are scaled 1/30 in assetManager.js)."""
import json, math, struct, sys, pathlib

def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def node_matrix(n):
    if "matrix" in n:
        m = n["matrix"]  # column-major
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get("translation", [0, 0, 0])
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [
        [r[0][0] * s[0], r[0][1] * s[1], r[0][2] * s[2], t[0]],
        [r[1][0] * s[0], r[1][1] * s[1], r[1][2] * s[2], t[1]],
        [r[2][0] * s[0], r[2][1] * s[1], r[2][2] * s[2], t[2]],
        [0, 0, 0, 1],
    ]

def bounds(path):
    data = pathlib.Path(path).read_bytes()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        return None
    length, kind = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + length])
    nodes, meshes, accessors = gltf.get("nodes", []), gltf.get("meshes", []), gltf.get("accessors", [])
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    ident = [[1 if i == j else 0 for j in range(4)] for i in range(4)]

    def walk(i, parent):
        m = mat_mul(parent, node_matrix(nodes[i]))
        if "mesh" in nodes[i]:
            for prim in meshes[nodes[i]["mesh"]]["primitives"]:
                acc = accessors[prim["attributes"]["POSITION"]]
                mn, mx = acc["min"], acc["max"]
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            p = [sum(m[r][c] * v for c, v in enumerate((cx, cy, cz, 1))) for r in range(3)]
                            for k in range(3):
                                lo[k], hi[k] = min(lo[k], p[k]), max(hi[k], p[k])
        for c in nodes[i].get("children", []):
            walk(c, m)

    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    for root in scene.get("nodes", []):
        walk(root, ident)
    if lo[0] == math.inf:
        return None
    w, h, d = ((hi[k] - lo[k]) / 30 for k in range(3))
    return w, d, h, len(gltf.get("materials", [])), len(gltf.get("images", []))

if __name__ == "__main__":
    rows = []
    for p in sorted(pathlib.Path(sys.argv[1]).glob("*.glb")):
        b = bounds(p)
        if b:
            rows.append((p.stem, *b))
    print(f"{'model':40} {'w':>5} {'d':>5} {'h':>5}  mats imgs")
    for name, w, d, h, mats, imgs in rows:
        print(f"{name:40} {w:5.2f} {d:5.2f} {h:5.2f}  {mats:4} {imgs:4}")
