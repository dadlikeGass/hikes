"""用真实 DEM 生成路线底图：晕渲 + 稀疏等高线。

输入不是 GPX，而是 pipeline/build.py 的产物（pipeline/out/*.json）：
几何与起点海拔都取自同一份产物，所以底图和路书用的是同一条轨迹。
三个来源（北京 / 全国区域 / 赛事）一次跑完。

DEM 来源：AWS Open Data「Terrain Tiles」的 terrarium 瓦片（z12 ≈ 30 m/px，
和 SRTM GL1 30 m 同级；公开、带 CDN 缓存，单张几十 KB）。为什么换掉
OpenTopography SRTM GeoTIFF：同样精度下它每 1°×1° 要 15–25 MB，按线路取
全量要几百 MB；terrarium 只要几十 MB，在慢链路上差别是几十分钟和几小时。

用法：
  python3 pipeline/build_terrain.py                  # 三个来源全跑
  python3 pipeline/build_terrain.py --source races    # 只跑赛事
  python3 pipeline/build_terrain.py --slugs sanfeng xiangzhixian
  python3 pipeline/build_terrain.py --skip-existing   # 只补缺的

依赖只有 numpy 与 Pillow（不需要 GDAL / rasterio）：
  python3 -m pip install --target /private/tmp/hikes-terrain-deps -r pipeline/requirements-terrain.txt
  PYTHONPATH=/private/tmp/hikes-terrain-deps python3 pipeline/build_terrain.py

产物：app/web/terrain/<slug>.png + <slug>.json（边界、等高线基准与间距、投影、
DEM 来源、生成时间）。

等高线口径：**起点基准**取路线自己的起点海拔（产物里的 elevation_m[0]），
向下每 200 m 一条；向上按几何级数递进，到本条线路最高点收缩到 10 m。
每一级同时用两条线索记录：`contour_steps_m`（API 读这个）与
`contour_interval_m`（旧名，保留兼容）。
"""
import argparse
import datetime
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "web" / "terrain"
# 瓦片缓存放在仓库外（可用 HIKE_DEM_CACHE 覆盖，CI / 沙箱里指向可写目录）。
CACHE = Path(__import__("os").environ.get(
    "HIKE_DEM_CACHE", Path.home() / ".cache" / "hikes" / "terrarium"))

ZOOM = 12                    # 12 级 ≈ 30 m/px，和 SRTM GL1 30 m 同级
TILE = 256
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DEM_LABEL = f"Terrain Tiles terrarium z{ZOOM} (~30 m/px, AWS Open Data)"

SIZE = (760, 420)            # 底图输出尺寸；前端按这个比例叠轨迹

# 底图覆盖哪些产物（顺序也是跑的顺序）
SOURCES = {
    "beijing": ("routes.json", "北京山野徒步/越野"),
    "cn": ("routes_cn.json", "全国区域热门路线"),
    "races": ("race_routes.json", "越野赛事赛道"),
}


# --------------------------------------------------------------------------- #
# 投影与瓦片
# --------------------------------------------------------------------------- #
def mercator(lat, lon):
    """经纬度 → 全局像素坐标（Web Mercator，zoom 级）。"""
    n = TILE * 2 ** ZOOM
    lat = max(-85.0, min(85.0, lat))
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat)))
         / math.pi) / 2.0 * n
    return x, y


def inv_mercator(x, y):
    n = TILE * 2 ** ZOOM
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def tile_path(z, x, y):
    return CACHE / str(z) / str(x) / f"{y}.png"


def get_tile(x, y):
    """下载并缓存一张 terrarium 瓦片；写临时文件再改名，中断不留半截瓦片。"""
    path = tile_path(ZOOM, x, y)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    urllib.request.urlretrieve(TILE_URL.format(z=ZOOM, x=x, y=y), tmp)
    tmp.rename(path)
    return path


def decode_tile(path):
    """terrarium：海拔 = (R*256 + G + B/256) − 32768"""
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return (a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0) - 32768.0


def dem_crop(pts):
    """→ (海拔数组, 裁剪窗口原点像素, 窗口宽高)。窗口按输出比例裁到整数像素。"""
    xs, ys = zip(*(mercator(lat, lon) for lat, lon in pts))
    w_px = max(xs) - min(xs)
    h_px = max(ys) - min(ys)
    # 先给 12% 余量，再把窗口调到输出比例（避免晕渲被拉伸）。
    pad_x = max(w_px * .12, 60.0)
    pad_y = max(h_px * .12, 60.0)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w, h = w_px + pad_x * 2, h_px + pad_y * 2
    target = SIZE[0] / SIZE[1]
    if w / h < target:
        w = h * target
    else:
        h = w / target
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    x1, y1 = x0 + int(round(w)), y0 + int(round(h))

    tx0, ty0 = x0 // TILE, y0 // TILE
    tx1, ty1 = (x1 - 1) // TILE, (y1 - 1) // TILE
    mosaic = np.zeros(((ty1 - ty0 + 1) * TILE, (tx1 - tx0 + 1) * TILE), dtype=np.float32)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            if not 0 <= ty < 2 ** ZOOM:
                continue
            arr = decode_tile(get_tile(tx, ty))
            oy, ox = (ty - ty0) * TILE, (tx - tx0) * TILE
            mosaic[oy:oy + TILE, ox:ox + TILE] = arr
    crop = mosaic[y0 - ty0 * TILE:y1 - ty0 * TILE, x0 - tx0 * TILE:x1 - tx0 * TILE]
    return crop, (x0, y0)


def render(slug, pts, origin_m):
    crop, (x0, y0) = dem_crop(pts)
    if crop.size == 0:
        raise ValueError(f"DEM crop is empty for {slug}")
    full = crop.astype(np.float32)

    # 先缩放到输出尺寸再做晕渲：窗口本身有几百万像素，直接算吃不消。
    img = Image.fromarray(full)
    elevation = np.asarray(img.resize(SIZE, Image.Resampling.BILINEAR), dtype=np.float32)
    padded = np.pad(elevation, 1, mode="edge")
    smooth = sum(padded[dy:dy + SIZE[1], dx:dx + SIZE[0]]
                 for dy in range(3) for dx in range(3)) / 9

    gy, gx = np.gradient(smooth)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, altitude = math.radians(315), math.radians(42)
    hill = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(.88 + hill * .13, .76, 1.0)
    base = np.array([239, 248, 246], dtype=np.float32)
    rgb = np.clip(base[None, None, :] * shade[:, :, None], 0, 255).astype(np.uint8)
    canvas = Image.fromarray(rgb).convert("RGBA")
    draw = ImageDraw.Draw(canvas, "RGBA")

    # 沿线 DEM 采样：用**全分辨率**裁剪，不要用缩放后的栅格（精度会掉）。
    # 注意 row/col 是裁剪图的像素坐标，不能再乘缩放系数。
    route_elevations = []
    for lat, lon in pts:
        px, py = mercator(lat, lon)
        col = int(round(px - x0))
        row = int(round(py - y0))
        if 0 <= row < full.shape[0] and 0 <= col < full.shape[1]:
            route_elevations.append(float(full[row, col]))
    if not route_elevations:
        raise ValueError(f"No valid DEM samples along route {slug}")
    dem_start = route_elevations[0]
    route_top = max(route_elevations)
    # 起点海拔优先用路线自己的值（图例写"起点基准"就得对得上）；个别 GPX
    # 起点缺 <ele>（解析成 0），这时退回 DEM 采样值，否则整幅等高线会从 0 m 起算。
    start_elev = float(origin_m) if origin_m else dem_start
    origin_source = ("route_start_elevation_m" if origin_m else "dem_sample_at_start")

    lo, hi = float(np.min(elevation)), float(np.max(elevation))
    levels = {start_elev}
    levels.update(start_elev - 200 * k for k in range(1, math.ceil((start_elev - lo) / 200) + 1))
    # 向上按几何级数递进：起点 200 m，到本条线路最高点收缩到 10 m。
    ascent = max(0.0, route_top - start_elev)
    level = start_elev
    while level < hi:
        progress = min(1.0, max(0.0, (level - start_elev) / ascent)) if ascent > 0 else 1.0
        level += 200.0 * (10.0 / 200.0) ** progress
        if level <= hi:
            levels.add(level)
    for level in sorted(l for l in levels if lo <= l <= hi):
        for line in find_contours(smooth, level):
            if len(line) < 10:
                continue
            stride = max(1, len(line) // 1200)
            coords = [(int(c), int(r)) for r, c in line[::stride]]
            if len(coords) > 1:
                major = abs((level - start_elev) / 200 - round((level - start_elev) / 200)) < .025
                draw.line(coords, fill=(87, 132, 124, 100 if major else 62),
                          width=2 if major else 1)

    # 轨迹不画进底图：底图可复用，UI 再叠真实 GPX。
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT / f"{slug}.png", optimize=True)
    north_west = inv_mercator(x0, y0)
    south_east = inv_mercator(x0 + full.shape[1], y0 + full.shape[0])
    steps = {"max": 200, "min": 10, "mode": "continuous_geometric"}
    meta = {
        "west": round(north_west[1], 7), "north": round(north_west[0], 7),
        "east": round(south_east[1], 7), "south": round(south_east[0], 7),
        "projection": "EPSG:3857",
        "contour_origin_m": round(start_elev),
        "contour_origin_source": origin_source,
        "dem_start_m": round(dem_start),
        "route_top_m": round(route_top),
        "contour_steps_m": steps,
        "contour_interval_m": steps,          # 旧字段名，保留兼容
        "dem": DEM_LABEL,
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    (OUT / f"{slug}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print(f"  ✓ {slug}: 起点基准 {start_elev:.0f} m（DEM 采样 {dem_start:.0f} m）"
          f"，沿线最高 {route_top:.0f} m，等高距连续 200→10 m", flush=True)


def load_routes(sources):
    routes = {}
    for key in sources:
        name, _label = SOURCES[key]
        path = ROOT / "pipeline" / "out" / name
        if not path.exists():
            print(f"  跳过 {name}：还没生成（先跑 python3 pipeline/build.py）")
            continue
        for slug, r in json.loads(path.read_text(encoding="utf-8")).items():
            coords = r.get("coordinates") or []
            if len(coords) < 2:
                continue
            elev = r.get("elevation_m") or []
            routes[slug] = {"pts": [(c[0], c[1]) for c in coords],
                            "origin_m": elev[0] if elev else None, "source": key}
    return routes


def write_manifest():
    """把地形边界/等高线元数据汇总进后端，供 Vercel 函数读取。

    函数包里只有 server/，静态的 app/web/terrain/*.json 不在其中；
    没有这份清单，线上就会把 terrain_url 判成 None，轨迹图只剩底纹。
    """
    manifest = {}
    for path in sorted(OUT.glob("*.json")):
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
            manifest[path.stem] = {
                "west": meta["west"], "south": meta["south"],
                "east": meta["east"], "north": meta["north"],
                "contour_origin_m": meta.get("contour_origin_m"),
                "contour_steps_m": meta.get("contour_steps_m")
                    or meta.get("contour_interval_m"),
            }
        except (KeyError, ValueError):
            continue
    target = ROOT / "server" / "app" / "terrain_manifest.json"
    target.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    print(f"✓ 地形清单：{len(manifest)} 条 → {target.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default="all", choices=["all"] + list(SOURCES))
    parser.add_argument("--slugs", nargs="*", help="只处理指定 slug")
    parser.add_argument("--skip-existing", action="store_true", help="已有底图的跳过")
    args = parser.parse_args()

    keys = list(SOURCES) if args.source == "all" else [args.source]
    routes = load_routes(keys)
    chosen = {s: r for s, r in routes.items() if not args.slugs or s in args.slugs}
    missing = set(args.slugs or []) - set(chosen)
    if missing:
        raise SystemExit("产物里找不到这些 slug: " + ", ".join(sorted(missing)))
    if args.skip_existing:
        chosen = {s: r for s, r in chosen.items() if not (OUT / f"{s}.png").exists()}
    if not chosen:
        print("没有需要生成的底图")
        write_manifest()
        return

    by_source = {}
    for slug, r in chosen.items():
        by_source.setdefault(r["source"], []).append(slug)
    print(f"要生成 {len(chosen)} 张底图：" +
          "、".join(f"{SOURCES[k][1]} {len(v)} 条" for k, v in by_source.items()), flush=True)
    done, fails = 0, []
    for slug, r in chosen.items():
        try:
            render(slug, r["pts"], r["origin_m"])
            done += 1
        except Exception as ex:                       # noqa: BLE001
            fails.append((slug, f"{type(ex).__name__}: {ex}"))
            print(f"  ✗ {slug}: {type(ex).__name__}: {ex}", flush=True)
    have = len(list(OUT.glob("*.png")))
    print(f"\n✓ 本次生成 {done}/{len(chosen)} 张；app/web/terrain 现有 {have} 张底图")
    if fails:
        print("失败清单：" + "；".join(f"{s}（{w}）" for s, w in fails[:10]))
    write_manifest()


if __name__ == "__main__":
    main()
