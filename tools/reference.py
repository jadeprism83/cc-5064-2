#!/usr/bin/env python3
"""
reference.py — 独立高精度参考实现 + 测试场景生成器。

与 js/coverage-core.js 完全独立：
  * 全部坐标使用 fractions.Fraction 精确十进制有理数；
  * 同样的反对称顶/左归属规则（这是规格本身，不是实现巧合）；
  * Sutherland-Hodgman 精确裁剪 + 鞋带公式给出解析覆盖面积；
  * 生成 test/reference-data.json 与 js/reference-data.js 供 Node 测试和界面比对。

运行：python3 tools/reference.py
"""
import json
import math
import os
from fractions import Fraction as Fr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- 规则参考实现

def fr(v):
    return v if isinstance(v, Fr) else Fr(str(v))


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def area2(tri):
    a, b, c = [(fr(p["x"]), fr(p["y"])) for p in tri]
    return cross(sub(b, a), sub(c, a))


def canon(tri):
    pts = [(fr(p["x"]), fr(p["y"])) for p in tri]
    if cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])) < 0:
        return [pts[0], pts[2], pts[1]]
    return pts


def owns_tie(a, b):
    # 与 JS 相同的反对称谓词：交换 a/b 结果取反。
    return b[1] < a[1] or (b[1] == a[1] and b[0] < a[0])


def inside(tri, px, py, rule="top-left"):
    t = canon(tri)
    p = (fr(px), fr(py))
    if cross(sub(t[1], t[0]), sub(t[2], t[0])) == 0:
        return False
    for i in range(3):
        a = t[i]
        b = t[(i + 1) % 3]
        w = cross(sub(b, a), sub(p, a))
        if w > 0:
            continue
        if w == 0:
            if rule == "strict":
                return False
            if rule == "inclusive":
                continue
            if owns_tie(a, b):
                continue
            return False
        return False
    return True


def pick(objects, x, y, rule="top-left"):
    hits = []
    for o in objects:
        if o.get("visible", True) is False:
            continue
        if any(inside(t, x, y, rule) for t in o["triangles"]):
            hits.append(o["oid"])
    return {"x": str(x), "y": str(y), "hits": hits, "oid": hits[-1] if hits else 0}


# ---------------------------------------------------------------- 解析面积

def clip(poly, axis, bound, keep):
    def inside_fn(pt):
        c = pt[0 if axis == "x" else 1]
        return c >= bound if keep == "ge" else c <= bound

    def intersect(s, e):
        ci = 0 if axis == "x" else 1
        t = (bound - s[ci]) / (e[ci] - s[ci])
        return (s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1]))

    out = []
    if not poly:
        return out
    s = poly[-1]
    sin = inside_fn(s)
    for e in poly:
        ein = inside_fn(e)
        if ein:
            if not sin:
                out.append(intersect(s, e))
            out.append(e)
        elif sin:
            out.append(intersect(s, e))
        s, sin = e, ein
    return out


def tri_pixel_area(tri, px, py):
    poly = [(fr(p["x"]), fr(p["y"])) for p in tri]
    poly = clip(poly, "x", Fr(px), "ge")
    poly = clip(poly, "x", Fr(px + 1), "le")
    poly = clip(poly, "y", Fr(py), "ge")
    poly = clip(poly, "y", Fr(py + 1), "le")
    if len(poly) < 3:
        return Fr(0)
    s = Fr(0)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) / 2


def fr_decimal_string(f):
    """把分母只含 2/5 因子的 Fraction 转成精确小数字符串。"""
    n, d = f.numerator, f.denominator
    if d == 1:
        return str(n)
    dd = d
    a = b = 0
    while dd % 2 == 0:
        dd //= 2
        a += 1
    while dd % 5 == 0:
        dd //= 5
        b += 1
    assert dd == 1, "scenario coords must be finite decimal"
    k = max(a, b)
    scaled = n * (10 ** k) // d
    sign = "-" if scaled < 0 else ""
    scaled = abs(scaled)
    s = str(scaled).zfill(k + 1)
    return f"{sign}{s[:-k]}.{s[-k:]}" if k else sign + s


def pt(x, y):
    return {"x": fr_decimal_string(fr(x)), "y": fr_decimal_string(fr(y))}


# ---------------------------------------------------------------- 采样图案（与 JS 对齐，并把坐标直接发给测试）

def grid(n):
    return [{"x": Fr(2 * i + 1, 2 * n), "y": Fr(2 * j + 1, 2 * n)}
            for j in range(n) for i in range(n)]


PATTERNS = {
    "1-center": [{"x": Fr(1, 2), "y": Fr(1, 2)}],
    "2-diag": [{"x": Fr(1, 4), "y": Fr(1, 4)}, {"x": Fr(3, 4), "y": Fr(3, 4)}],
    "4-grid": grid(2),
    "4-rotated": [
        {"x": Fr(3, 8), "y": Fr(1, 8)}, {"x": Fr(7, 8), "y": Fr(3, 8)},
        {"x": Fr(1, 8), "y": Fr(5, 8)}, {"x": Fr(5, 8), "y": Fr(7, 8)},
    ],
    "8-grid": [{"x": Fr(2 * i + 1, 8), "y": Fr(1, 4) if j == 0 else Fr(3, 4)}
               for j in range(2) for i in range(4)],
    "8-rotted": [
        (Fr(9, 16), Fr(1, 16)), (Fr(13, 16), Fr(5, 16)),
        (Fr(5, 16), Fr(3, 16)), (Fr(1, 16), Fr(7, 16)),
        (Fr(15, 16), Fr(9, 16)), (Fr(11, 16), Fr(13, 16)),
        (Fr(7, 16), Fr(11, 16)), (Fr(3, 16), Fr(15, 16)),
    ],
    "16-grid": grid(4),
}
PATTERNS = {
    k: [p if "x" in p else {"x": a, "y": b} for p in v] if k != "8-rotted"
    else [{"x": a, "y": b} for a, b in v]
    for k, v in PATTERNS.items()
}

EMIT_PATTERNS = {
    pid: [{"x": fr_decimal_string(s["x"]), "y": fr_decimal_string(s["y"])} for s in ss]
    for pid, ss in PATTERNS.items()
}

# ---------------------------------------------------------------- 场景构造

def tiled_mesh(cols, rows, ox, oy, tile=1, oid0=1, alternate=True):
    """每格一个对象、两个三角形，对角线按棋盘交替，压迫对角线归属一致性。"""
    ox, oy, tile = fr(ox), fr(oy), fr(tile)
    objs = []
    for j in range(rows):
        for i in range(cols):
            x0 = ox + i * tile
            y0 = oy + j * tile
            x1 = x0 + tile
            y1 = y0 + tile
            p00, p10 = pt(x0, y0), pt(x1, y0)
            p01, p11 = pt(x0, y1), pt(x1, y1)
            oid = oid0 + j * cols + i
            if (i + j) % 2 == 0 or not alternate:
                tris = [[p00, p10, p11], [p00, p11, p01]]
            else:
                tris = [[p10, p11, p01], [p10, p01, p00]]
            objs.append({"oid": oid, "name": f"tile-{i}-{j}", "triangles": tris})
    return objs


def flip_all_winding(objs):
    out = []
    for o in objs:
        oo = dict(o)
        oo["triangles"] = [[t[2], t[1], t[0]] for t in o["triangles"]]
        out.append(oo)
    return out


def fan_mesh(cx, cy, radius, rings=10):
    c = pt(cx, cy)
    ring = []
    for k in range(rings):
        a = 2 * math.pi * k / rings
        x = fr(cx) + Fr(f"{math.cos(a) * float(radius):.6f}")
        y = fr(cy) + Fr(f"{math.sin(a) * float(radius):.6f}")
        ring.append(pt(x, y))
    objs = []
    for k in range(rings):
        objs.append({
            "oid": k + 1,
            "name": f"fan-{k}",
            "triangles": [[c, ring[k], ring[(k + 1) % rings]]],
        })
    return objs, c, ring


def thin_mesh():
    objs = []
    oid = 1
    # 三条共享水平长边的极薄条带，每条带拆两个三角形
    x0, x1 = Fr(1), Fr(11)
    base = Fr(2)
    h = Fr(4, 1000)  # 0.004 px
    for k in range(3):
        y0 = base + k * h
        y1 = y0 + h
        p00, p10 = pt(x0, y0), pt(x1, y0)
        p01, p11 = pt(x0, y1), pt(x1, y1)
        objs.append({"oid": oid, "name": f"thin-strip-{k}",
                     "triangles": [[p00, p10, p11], [p00, p11, p01]]})
        oid += 1
    # 中等薄度斜条，供面积收敛检查
    objs.append({"oid": oid, "name": "mild-sliver", "triangles": [
        [pt(1.5, 7.0), pt(10.5, 6.6), pt(1.5, 7.12)]]})
    oid += 1
    # 极端细的斜针
    objs.append({"oid": oid, "name": "needle", "triangles": [
        [pt(2.0, 9.0), pt(11.0, 4.5), pt(2.0, 9.002)]]})
    return objs


def degenerate_scene():
    return [
        {"oid": 1, "name": "healthy", "triangles": [
            [pt(1, 1), pt(5, 1.5), pt(1.5, 4)]]},
        {"oid": 2, "name": "collinear", "triangles": [
            [pt(2, 2), pt(6, 2), pt(4, 2)]]},
        {"oid": 3, "name": "duplicate", "triangles": [
            [pt(3, 3), pt(3, 3), pt(5, 4)]]},
    ]


def shared_edge_scene():
    ea = pt(20.0, 19.5)
    eb = pt(21.5, 21.0)
    vb = pt(22.5, 20.5)
    vf = pt(19.0, 21.5)
    bg = {"oid": 1, "name": "background-owner", "triangles": [[ea, eb, vb]]}
    fg = {"oid": 2, "name": "foreground-majority", "triangles": [[ea, eb, vf]]}
    return [bg, fg]


# ---------------------------------------------------------------- 光栅化参考

def raster_reference(objects, vp, pattern_id):
    ss = PATTERNS[pattern_id]
    w, h = vp["width"], vp["height"]
    counts = []
    owners = []
    for ly in range(h):
        py = vp["y0"] + ly
        for lx in range(w):
            px = vp["x0"] + lx
            for s in ss:
                X = Fr(px) + s["x"]
                Y = Fr(py) + s["y"]
                c = 0
                owner = 0
                for o in objects:
                    obj_hits = 0
                    for t in o["triangles"]:
                        if inside(t, X, Y):
                            c += 1
                            obj_hits += 1
                    if obj_hits:
                        owner = o["oid"]
                counts.append(c)
                owners.append(owner)
    return {"N": len(ss), "counts": counts, "owners": owners}


def area_reference(objects, vp):
    entries = []
    for o in objects:
        for ti, t in enumerate(o["triangles"]):
            for ly in range(vp["height"]):
                y = vp["y0"] + ly
                for lx in range(vp["width"]):
                    x = vp["x0"] + lx
                    a = tri_pixel_area(t, x, y)
                    if a != 0:
                        entries.append({
                            "oid": o["oid"], "tri": ti, "x": x, "y": y,
                            "areaFrac": [str(a.numerator), str(a.denominator)],
                            "areaFloat": float(a),
                        })
    return entries


def lattice_probes(xs, ys, objects):
    out = []
    for x in xs:
        for y in ys:
            r = pick(objects, Fr(x), Fr(y))
            out.append({"x": fr_decimal_string(fr(x)), "y": fr_decimal_string(fr(y)),
                        "hits": r["hits"], "oid": r["oid"]})
    return out


def build():
    scenarios = []

    # 1) 拼接矩形（单位格 + 分数偏移 + 交替对角线）
    tiled = tiled_mesh(6, 4, "0.23", "0.31")
    vp_t = {"x0": 0, "y0": 0, "width": 7, "height": 5}
    scenarios.append({
        "id": "tiled-rects",
        "title": "拼接矩形（6×4，交替对角线）",
        "viewport": vp_t,
        "objects": tiled,
        "lattice": lattice_probes(range(0, 8), range(0, 6), tiled),
        "probes": [pick(tiled, "3.23", "2.31"), pick(tiled, "2.73", "1.81")],
    })

    # 2) 同样几何但全部反向绕序
    scenarios.append({
        "id": "tiled-rects-flipped",
        "title": "拼接矩形 · 全部反向绕序",
        "viewport": vp_t,
        "objects": flip_all_winding(tiled),
        "lattice": lattice_probes(range(0, 8), range(0, 6), flip_all_winding(tiled)),
        "probes": [],
    })

    # 3) 扇形网格
    fan, center, ring = fan_mesh("5.17", "4.83", "3.35", 10)
    vp_f = {"x0": 0, "y0": 0, "width": 11, "height": 10}
    fan_probes = [pick(fan, center["x"], center["y"])]
    fan_probes += [pick(fan, p["x"], p["y"]) for p in ring]
    scenarios.append({
        "id": "fan-grid",
        "title": "扇形网格（10 片，共享中心与径向边）",
        "viewport": vp_f,
        "objects": fan,
        "probes": fan_probes,
    })

    # 4) 极薄三角形
    thin = thin_mesh()
    vp_h = {"x0": 0, "y0": 0, "width": 12, "height": 10}
    scenarios.append({
        "id": "thin-tris",
        "title": "极薄三角形与共边长条",
        "viewport": vp_h,
        "objects": thin,
        "probes": [],
    })

    # 5) 大坐标
    large = tiled_mesh(4, 3, Fr(100000) + Fr(3, 8), Fr(200000) + Fr(5, 8))
    vp_l = {"x0": 100000, "y0": 200000, "width": 6, "height": 5}
    scenarios.append({
        "id": "large-coords",
        "title": "大屏幕坐标（10 万 / 20 万级偏移）",
        "viewport": vp_l,
        "objects": large,
        "probes": lattice_probes(range(100000, 100006), range(200000, 200005), large),
    })

    # 6) 退化三角形
    deg = degenerate_scene()
    vp_d = {"x0": 0, "y0": 0, "width": 8, "height": 6}
    scenarios.append({
        "id": "degenerate",
        "title": "退化三角形（共线 / 重复顶点）",
        "viewport": vp_d,
        "objects": deg,
        "probes": [],
    })

    # 7) 共边拾取分歧
    se = shared_edge_scene()
    vp_s = {"x0": 19, "y0": 19, "width": 4, "height": 3}
    scenarios.append({
        "id": "shared-edge-pick",
        "title": "共边拾取分歧（子样本=背景，面积=前景）",
        "viewport": vp_s,
        "objects": se,
        "focusPixel": {"x": 20, "y": 20, "probe": {"x": "20.75", "y": "20.25"}},
        "probes": [pick(se, "20.75", "20.25"), pick(se, "20.62", "20.62")],
    })

    pattern_ids = ["1-center", "2-diag", "4-grid", "4-rotated", "8-grid", "8-rotted", "16-grid"]
    for sc in scenarios:
        sc["rasters"] = {pid: raster_reference(sc["objects"], sc["viewport"], pid)
                         for pid in pattern_ids}
        sc["areas"] = area_reference(sc["objects"], sc["viewport"])

    data = {
        "version": 1,
        "rule": "canonicalize area2>0; tie owned iff directed canonical edge goes up "
                "(dy<0) or horizontal right-to-left (dy==0,dx<0)",
        "patterns": EMIT_PATTERNS,
        "scenarios": scenarios,
    }

    os.makedirs(os.path.join(ROOT, "test"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "js"), exist_ok=True)
    with open(os.path.join(ROOT, "test", "reference-data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    with open(os.path.join(ROOT, "js", "reference-data.js"), "w", encoding="utf-8") as f:
        f.write("/* 由 tools/reference.py 生成，请勿手改。 */\n")
        f.write("(function(root,factory){\n")
        f.write("  const DATA = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")
        f.write("  if (typeof module==='object'&&module.exports) module.exports=DATA;\n")
        f.write("  if (root) root.ReferenceData=DATA;\n")
        f.write("})(typeof globalThis!=='undefined'?globalThis:this);\n")

    # 控制台摘要：检查内部整数格点的唯一归属情况
    for sc in scenarios:
        ras = sc["rasters"]["4-grid"]
        multi = sum(1 for c in ras["counts"] if c > 1)
        print(f"  {sc['id']:22s} areas={len(sc['areas']):4d} multiHitSamples(4grid)={multi}")
    print("reference data written.")


if __name__ == "__main__":
    build()
