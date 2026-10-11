# -*- coding: utf-8 -*-
"""把 tracks/ 下的 GPX 画成一张 SVG 总览图（纯标准库，无第三方依赖）。

    python3 overview.py        # 生成 overview.svg
"""
import glob
import math
import os
import sys
import xml.etree.ElementTree as ET

# 可选参数：要画的目录（默认脚本所在目录，例如传 parks 画公园跑道）
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
W, H = 900, 760
PAD = 46
COLORS = ["#e4572e", "#2a9d8f", "#3d5a80", "#9b5de5", "#f4a261", "#1b998b",
          "#c1121f", "#0077b6", "#6a994e", "#bc6c25", "#8338ec", "#ff006e"]


def load(path):
    root = ET.parse(path).getroot()
    pts = []
    for p in root.iter():
        if p.tag.endswith("trkpt"):
            pts.append((float(p.get("lat")), float(p.get("lon"))))
    return pts


def main():
    tracks = []
    for path in sorted(glob.glob(os.path.join(OUT, "*.gpx"))):
        pts = load(path)
        if len(pts) < 2:
            continue
        tracks.append((os.path.splitext(os.path.basename(path))[0], pts))

    lats = [la for _, pts in tracks for la, _ in pts]
    lons = [lo for _, pts in tracks for _, lo in pts]
    la0, la1 = min(lats), max(lats)
    lo0, lo1 = min(lons), max(lons)
    kx = math.cos(math.radians((la0 + la1) / 2))          # 纬度方向压缩
    span_x = (lo1 - lo0) * kx
    span_y = la1 - la0
    scale = min((W - 2 * PAD) / span_x, (H - 2 * PAD) / span_y)
    off_x = (W - span_x * scale) / 2
    off_y = (H - span_y * scale) / 2

    def xy(la, lo):
        return (off_x + (lo - lo0) * kx * scale,
                H - off_y - (la - la0) * scale)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#0f1417"/>',
        '<text x="24" y="30" fill="#e9f1f1" font-family="PingFang SC,Helvetica,sans-serif" '
        f'font-size="16">北京热门徒步 / 越野线路 · {len(tracks)} 条（六只脚轨迹）</text>',
    ]
    for lo in range(int(lo1), int(lo1) - 5, -1):          # 经度网格
        x, _ = xy(la0, lo)
        if 0 < x < W:
            parts.append(f'<line x1="{x:.1f}" y1="40" x2="{x:.1f}" y2="{H-20}" '
                         'stroke="#1d262b" stroke-width="1"/>')
            parts.append(f'<text x="{x:.1f}" y="{H-8}" fill="#4d5a61" font-size="10" '
                         f'text-anchor="middle" font-family="Helvetica">{lo}°E</text>')
    for la in range(int(la0) + 1, int(la1) + 1):          # 纬度网格
        _, y = xy(la, lo0)
        if 40 < y < H - 20:
            parts.append(f'<line x1="20" y1="{y:.1f}" x2="{W-20}" y2="{y:.1f}" '
                         'stroke="#1d262b" stroke-width="1"/>')
            parts.append(f'<text x="22" y="{y+3:.1f}" fill="#4d5a61" font-size="10" '
                         f'font-family="Helvetica">{la}°N</text>')

    legend = []
    for i, (name, pts) in enumerate(tracks):
        color = COLORS[i % len(COLORS)]
        d = " ".join(("M" if j == 0 else "L") + "%.1f %.1f" % xy(la, lo)
                     for j, (la, lo) in enumerate(pts))
        parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.4" '
                     'stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>')
        sx, sy = xy(*pts[0])
        parts.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="3" fill="{color}"/>')
        legend.append((name, color, len(pts)))

    for i, (name, color, n) in enumerate(legend):
        y = 58 + i * 20
        parts.append(f'<rect x="{W-250}" y="{y-9}" width="18" height="4" rx="2" fill="{color}"/>')
        parts.append(f'<text x="{W-226}" y="{y-3}" fill="#c9d6d6" font-size="12" '
                     f'font-family="PingFang SC,Helvetica,sans-serif">{name}  ({n} pts)</text>')
    parts.append('</svg>')

    with open(os.path.join(OUT, "overview.svg"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))
    print("wrote overview.svg with", len(tracks), "tracks")


if __name__ == "__main__":
    main()
