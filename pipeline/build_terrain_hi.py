"""高分辨率地形底图（配合 build_terrain.py 的 760×420 底图）。

为什么要它：底图里每个像素大约 16 m 地面距离，来源 DEM 是 z12（≈30 m/px），
所以放大到 2 倍以上时，画面上已经没有任何新信息，只剩像素被拉大——就是"放大很糊"。

这一版的做法：用**同一块地理范围**、但更高一级 DEM（z13 ≈15 m/px / z14 ≈7.5 m/px）
重新裁一份，输出 2× / 4× 尺寸的 WebP。前端按缩放档位换图（放大到 1.6× 换 2×，
3.2× 换 4×），配合本来就清晰的矢量等高线，放大才是"看得更细"。

关键约束：**取景范围必须和底图完全一致**，否则等高线和栅格会错位。
所以这里不复刻 build_terrain.dem_crop 的取整逻辑，而是直接读底图元数据
`{slug}.json` 里的 west/north/east/south，按同样的经纬度范围裁剪。

用法：
  python3 pipeline/build_terrain_hi.py --zoom 13 --size 1520x840 --suffix @2x
  python3 pipeline/build_terrain_hi.py --zoom 14 --size 3040x1680 --suffix @3x
  python3 pipeline/build_terrain_hi.py --zoom 13 --size 1520x840 --suffix @2x --slugs baipusi
"""
import argparse
import io
import json
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "web" / "terrain"
CACHE = Path(os.environ.get("HIKE_DEM_CACHE", Path.home() / ".cache" / "hikes" / "terrarium"))
TILE = 256
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

ZOOM = 13
SIZE = (1520, 840)
SUFFIX = "@2x"
BASE_SIZE = (760, 420)


def mercator(lat, lon, zoom):
    n = TILE * 2 ** zoom
    lat = max(-85.0, min(85.0, lat))
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat)))
         / math.pi) / 2.0 * n
    return x, y


def tile_path(z, x, y):
    return CACHE / str(z) / str(x) / f"{y}.png"


def get_tile(z, x, y):
    path = tile_path(z, x, y)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.part")
    try:
        urllib.request.urlretrieve(TILE_URL.format(z=z, x=x, y=y), tmp)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        return None
    tmp.rename(path)
    return path


def decode_tile(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return (a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0) - 32768.0


def crop_bounds(bounds, zoom):
    """按底图元数据里的经纬度范围裁剪，保证和 760×420 那张完全对得上。"""
    x0f, y0f = mercator(bounds["north"], bounds["west"], zoom)
    x1f, y1f = mercator(bounds["south"], bounds["east"], zoom)
    x0, y0, x1, y1 = int(round(x0f)), int(round(y0f)), int(round(x1f)), int(round(y1f))
    tx0, ty0 = x0 // TILE, y0 // TILE
    tx1, ty1 = (x1 - 1) // TILE, (y1 - 1) // TILE
    tiles = [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(lambda t: get_tile(zoom, t[0], t[1]), tiles))
    mosaic = np.zeros(((ty1 - ty0 + 1) * TILE, (tx1 - tx0 + 1) * TILE), dtype=np.float32)
    for tx, ty in tiles:
        p = tile_path(zoom, tx, ty)
        if not p.exists():
            continue
        arr = decode_tile(p)
        oy, ox = (ty - ty0) * TILE, (tx - tx0) * TILE
        mosaic[oy:oy + TILE, ox:ox + TILE] = arr
    return mosaic[y0 - ty0 * TILE:y1 - ty0 * TILE, x0 - tx0 * TILE:x1 - tx0 * TILE]


def render(slug, bounds, size):
    crop = crop_bounds(bounds, ZOOM)
    if crop.size == 0:
        raise ValueError("empty DEM crop")
    elevation = np.asarray(Image.fromarray(crop.astype(np.float32)).resize(size, Image.Resampling.BILINEAR),
                           dtype=np.float32)
    padded = np.pad(elevation, 1, mode="edge")
    smooth = sum(padded[dy:dy + size[1], dx:dx + size[0]]
                 for dy in range(3) for dx in range(3)) / 9
    gy, gx = np.gradient(smooth)
    # 分辨率提高后每像素对应的地面距离变小，梯度要按比例放大，
    # 否则晕渲对比度会比 760 那张淡很多（两张图看起来不像同一片山）。
    k = size[0] / BASE_SIZE[0]
    gy, gx = gy * k, gx * k
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, altitude = math.radians(315), math.radians(42)
    hill = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(.88 + hill * .13, .76, 1.0)
    base = np.array([239, 248, 246], dtype=np.float32)
    rgb = np.clip(base[None, None, :] * shade[:, :, None], 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb)
    dst = OUT / f"{slug}{SUFFIX}.webp"
    img.save(dst, "WEBP", quality=78, method=5)
    return dst


def main():
    global ZOOM, SIZE, SUFFIX
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zoom", type=int, default=13)
    ap.add_argument("--size", default="1520x840")
    ap.add_argument("--suffix", default="@2x")
    ap.add_argument("--slugs", nargs="*")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    ZOOM = args.zoom
    SIZE = tuple(int(v) for v in args.size.lower().split("x"))
    SUFFIX = args.suffix

    metas = sorted(OUT.glob("*.json"))
    metas = [m for m in metas if ".contours" not in m.name]
    targets = []
    for m in metas:
        slug = m.stem
        if args.slugs and slug not in args.slugs:
            continue
        if args.skip_existing and (OUT / f"{slug}{SUFFIX}.webp").exists():
            continue
        targets.append((slug, m))
    if args.limit:
        targets = targets[:args.limit]
    if not targets:
        print("没有要生成的高清底图")
        return

    print(f"要生成 {len(targets)} 张 {args.size} {SUFFIX}.webp（DEM z{ZOOM}）", flush=True)
    done, total, fails = 0, 0, []
    for slug, m in targets:
        try:
            bounds = json.loads(m.read_text(encoding="utf-8"))
            dst = render(slug, bounds, SIZE)
            total += dst.stat().st_size
            done += 1
            if done % 10 == 0 or done == len(targets):
                print(f"  … {done}/{len(targets)}，累计 {total // 1024 // 1024} MB", flush=True)
        except Exception as ex:                                # noqa: BLE001
            fails.append((slug, f"{type(ex).__name__}: {ex}"))
            print(f"  ✗ {slug}: {type(ex).__name__}: {ex}", flush=True)
    print(f"\n✓ {done}/{len(targets)} 张，共 {total // 1024 // 1024} MB"
          f"（平均 {total // max(done, 1) // 1024} KB）")
    if fails:
        print("失败：" + "；".join(f"{s}（{w}）" for s, w in fails[:8]))


if __name__ == "__main__":
    main()
