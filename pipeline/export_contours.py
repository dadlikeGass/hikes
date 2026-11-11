"""把等高线导出成矢量（配 build_terrain.py 的晕渲底图）。

为什么要有这一步：详情页的地形图是 760×420 的栅格，放大时只是把像素拉大，
看起来"没有更多细节"。等高线改由前端用 SVG 画之后：
  · 矢量线在 1×–8× 任何缩放下都是锐的；
  · 可以分两层：major（100% 就能看）与 minor（放大到 1.7× 才显示），
    放大时真的多出线条信息，而不是插值放大。

口径与底图完全一致，所以底图和矢量线能对齐：
  同一份 DEM 裁剪（dem_crop）→ 同样缩放到 SIZE → 同样的 3×3 平滑 →
  同样以路线起点海拔为基准的几何级数等高距。

产物：app/web/terrain/<slug>.contours.json
  {"v":1,"w":760,"h":420,"scale":2,
   "major":[[elev_m, [[x,y,...], ...]], ...],
   "minor":[[elev_m, [[x,y,...], ...]], ...]}
坐标是 SIZE 像素 × scale（0.5 px 精度）的整数，前端除以 scale 即为底图坐标。

用法：
  python3 pipeline/export_contours.py                      # 全部
  python3 pipeline/export_contours.py --slugs baipusi      # 指定线路
  python3 pipeline/export_contours.py --skip-existing      # 只补缺的
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.measure import approximate_polygon, find_contours

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_terrain as BT                                    # noqa: E402

SCALE = 2                     # 0.5 px 精度，整数坐标省体积
TOLERANCE = 1.0               # 折线简化容差（像素）：DEM 本来就是 1px 分辨率，再细没意义
MINOR_STEP = 25.0             # 细等高线：每 25 m 一条（放大才显示）
MINOR_MAX = 26                # 细线层数上限，超了把间距放到 50 m


def smooth_grid(pts):
    """与 build_terrain.render 完全相同的网格与平滑；顺便取沿线海拔。"""
    crop, (x0, y0) = BT.dem_crop(pts)
    full = crop.astype(np.float32)
    img = Image.fromarray(full)
    elevation = np.asarray(img.resize(BT.SIZE, Image.Resampling.BILINEAR), dtype=np.float32)
    padded = np.pad(elevation, 1, mode="edge")
    smooth = sum(padded[dy:dy + BT.SIZE[1], dx:dx + BT.SIZE[0]]
                 for dy in range(3) for dx in range(3)) / 9

    vals = []
    for lat, lon in pts:
        px, py = BT.mercator(lat, lon)
        col, row = int(round(px - x0)), int(round(py - y0))
        if 0 <= row < full.shape[0] and 0 <= col < full.shape[1]:
            vals.append(float(full[row, col]))
    return smooth, vals


def major_levels(start_elev, route_top, lo, hi):
    """底图原本用的那套几何级数等高距：起点 200 m，向最高点收缩到 10 m。"""
    levels = {start_elev}
    levels.update(start_elev - 200 * k for k in range(1, math.ceil((start_elev - lo) / 200) + 1))
    ascent = max(0.0, route_top - start_elev)
    level = start_elev
    while level < hi:
        progress = min(1.0, max(0.0, (level - start_elev) / ascent)) if ascent > 0 else 1.0
        level += 200.0 * (10.0 / 200.0) ** progress
        if level <= hi:
            levels.add(level)
    return sorted(l for l in levels if lo <= l <= hi)


def minor_levels(major, lo, hi):
    step = MINOR_STEP
    if (hi - lo) / step > MINOR_MAX:
        step = 50.0
    out = []
    level = math.floor(lo / step) * step
    while level < hi:
        if all(abs(level - m) >= 3.0 for m in major):
            out.append(float(level))
        level += step
    return out


def polylines(grid, level, w, h):
    """某一级等高线的折线集合，坐标换成 SIZE×SCALE 的整数。"""
    out = []
    for line in find_contours(grid, level):
        if len(line) < 10:
            continue
        simple = approximate_polygon(line, tolerance=TOLERANCE)
        if len(simple) < 3:
            continue
        pts = []
        for r, c in simple:
            x = int(round(min(max(float(c), 0.0), w) * SCALE))
            y = int(round(min(max(float(r), 0.0), h) * SCALE))
            pts.append(x)
            pts.append(y)
        if len(pts) >= 6:
            out.append(pts)
    return out


def export(slug, pts, origin_m):
    grid, vals = smooth_grid(pts)
    if not vals:
        raise ValueError("no DEM samples along route")
    w, h = BT.SIZE
    lo, hi = float(np.min(grid)), float(np.max(grid))
    dem_start = vals[0]
    start_elev = float(origin_m) if origin_m else dem_start
    route_top = max(vals)

    major = major_levels(start_elev, route_top, lo, hi)
    minor = minor_levels(major, lo, hi)

    data = {"v": 1, "w": w, "h": h, "scale": SCALE, "src": BT.DEM_LABEL,
            "origin_m": int(round(start_elev)), "major": [], "minor": []}
    for level in major:
        lines = polylines(grid, level, w, h)
        if lines:
            data["major"].append([int(round(level)), lines])
    for level in minor:
        lines = polylines(grid, level, w, h)
        if lines:
            data["minor"].append([int(round(level)), lines])

    BT.OUT.mkdir(parents=True, exist_ok=True)
    out = BT.OUT / f"{slug}.contours.json"
    out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    pts_n = sum(len(l) // 2 for g in ("major", "minor") for _e, ls in data[g] for l in ls)
    print(f"  ✓ {slug}: major {len(data['major'])} 级 / minor {len(data['minor'])} 级"
          f"，{pts_n} 点，{out.stat().st_size // 1024} KB", flush=True)
    return out.stat().st_size


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="all", choices=["all"] + list(BT.SOURCES))
    ap.add_argument("--slugs", nargs="*")
    ap.add_argument("--skip-existing", action="store_true")
    args = ap.parse_args()

    keys = list(BT.SOURCES) if args.source == "all" else [args.source]
    routes = BT.load_routes(keys)
    chosen = {s: r for s, r in routes.items() if not args.slugs or s in args.slugs}
    missing = set(args.slugs or []) - set(chosen)
    if missing:
        raise SystemExit("产物里找不到这些 slug: " + ", ".join(sorted(missing)))
    if args.skip_existing:
        chosen = {s: r for s, r in chosen.items()
                  if not (BT.OUT / f"{s}.contours.json").exists()}
    if not chosen:
        print("没有要导出的等高线")
        return

    total, fails = 0, []
    for slug, r in chosen.items():
        try:
            total += export(slug, r["pts"], r["origin_m"])
        except Exception as ex:                                # noqa: BLE001
            fails.append((slug, f"{type(ex).__name__}: {ex}"))
            print(f"  ✗ {slug}: {type(ex).__name__}: {ex}", flush=True)
    print(f"\n✓ 导出 {len(chosen) - len(fails)}/{len(chosen)} 条，共 {total // 1024} KB")
    if fails:
        print("失败：" + "；".join(f"{s}（{w}）" for s, w in fails[:10]))


if __name__ == "__main__":
    main()
