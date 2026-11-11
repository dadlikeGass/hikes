"""从全量等高线导出卡片缩略图用的精简版（不重新碰 DEM，纯后处理）。

路书卡片里的迷你轨迹只有 98×74 / 100%×124 两种尺寸，全量等高线（平均 121 KB）
在那上面既看不出细节也太占流量。这里按"只留主层级 + 折线再简化"生成一份
<slug>.contours.slim.json，体积约为全量的 1/10。

层级挑选：主层级按海拔等距取样，最多 MAX_LEVELS 条（保留最高与最低）。
折线简化：Douglas-Peucker，容差在 0.5px 网格里按 SCALE 换算。
"""
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app" / "web" / "terrain"
MAX_LEVELS = 14
TOL_PX = 1.4               # 简化容差（输出图像素）


def simplify(pts, tol):
    """Douglas-Peucker，pts 是 [x0,y0,x1,y1,...]（整数）。"""
    n = len(pts) // 2
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[2 * a], pts[2 * a + 1]
        bx, by = pts[2 * b], pts[2 * b + 1]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy) or 1e-9
        far, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[2 * i], pts[2 * i + 1]
            dist = abs(dy * (px - ax) - dx * (py - ay)) / seg
            if dist > far:
                far, idx = dist, i
        if far > tol and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    out = []
    for i in range(n):
        if keep[i]:
            out.append(pts[2 * i])
            out.append(pts[2 * i + 1])
    return out


def pick_levels(levels):
    """按海拔等距挑层级，保留首尾。"""
    if len(levels) <= MAX_LEVELS:
        return levels
    step = (len(levels) - 1) / (MAX_LEVELS - 1)
    idx = sorted({round(i * step) for i in range(MAX_LEVELS)})
    return [levels[i] for i in idx]


def slim(src: Path) -> Path:
    data = json.loads(src.read_text(encoding="utf-8"))
    scale = data.get("scale", 2)
    tol = TOL_PX * scale
    levels = pick_levels(data.get("major") or [])
    out_levels = []
    for elev, lines in levels:
        kept = []
        for pts in lines:
            simple = simplify(pts, tol)
            if len(simple) >= 6:
                kept.append(simple)
        if kept:
            out_levels.append([elev, kept])
    slim_data = {"v": 1, "w": data.get("w", 760), "h": data.get("h", 420),
                 "scale": scale, "slim": 1, "major": out_levels}
    dst = src.with_name(src.name.replace(".contours.json", ".contours.slim.json"))
    dst.write_text(json.dumps(slim_data, separators=(",", ":")), encoding="utf-8")
    return dst


def main():
    files = sorted(OUT.glob("*.contours.json"))
    if not files:
        raise SystemExit("还没有全量等高线，先跑 export_contours.py")
    before = after = 0
    for f in files:
        before += f.stat().st_size
        after += slim(f).stat().st_size
    print(f"✓ {len(files)} 份精简版：{before // 1024} KB → {after // 1024} KB"
          f"（平均 {after // len(files) // 1024} KB）")


if __name__ == "__main__":
    main()
