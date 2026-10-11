# -*- coding: utf-8 -*-
"""把 tracks/ 下的 GPX 简化并生成 app/js/routes.data.js（供 app 内嵌使用）。

    python3 build_app_data.py

产出：
    app/js/routes.data.js   —— window.HIKES_ROUTE_DATA = { stats: {...}, gpx: {...} }

为什么简化：app 是零构建的本地 H5，直开 file:// 时 fetch 会被浏览器拦截，
所以轨迹要内嵌。完整精度留在 tracks/*.gpx，App 内嵌版按等距抽稀到 MAX_PTS 个点，
海拔保留 1 位小数——缩略图、坡度分段、海拔剖面对这个精度完全不敏感。
"""
import glob
import json
import math
import os
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
APP_JS = os.path.normpath(os.path.join(HERE, "..", "app", "js"))
MAX_PTS = 300


def load_gpx(path):
    """读回 trkpt，返回 [(lat, lon, ele)]，跳过起点/终点 wpt。"""
    root = ET.parse(path).getroot()
    pts = []
    for el in root.iter():
        if el.tag.endswith("trkpt"):
            ele = 0.0
            for child in el:
                if child.tag.endswith("ele") and child.text:
                    ele = float(child.text)
            pts.append((float(el.get("lat")), float(el.get("lon")), ele))
    return pts


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def simplify(pts, max_pts=MAX_PTS):
    if len(pts) <= max_pts:
        return pts
    step = (len(pts) - 1) / (max_pts - 1)
    out = [pts[round(i * step)] for i in range(max_pts)]
    out[0], out[-1] = pts[0], pts[-1]
    return out


def median_filter(vals, w=5):
    half = w // 2
    out = []
    for i in range(len(vals)):
        lo, hi = max(0, i - half), min(len(vals), i + half + 1)
        s = sorted(vals[lo:hi])
        out.append(s[len(s) // 2])
    return out


def moving_average(vals, w=21):
    half = w // 2
    out = []
    for i in range(len(vals)):
        lo, hi = max(0, i - half), min(len(vals), i + half + 1)
        out.append(sum(vals[lo:hi]) / (hi - lo))
    return out


def denoise_ele(pts):
    """海拔去噪：中值滤波去尖峰 + 滑动平均抹平抖动。

    六只脚上个别轨迹的海拔有明显跳变（曾见 10 m 水平距离涨 372 m），
    不做这一步会让 app 的坡度分段算出 80% 这种离谱值。
    只用于 app 内嵌版；tracks/ 下的原始 GPX 保留未处理的海拔。
    """
    eles = median_filter([p[2] for p in pts], 5)
    eles = moving_average(eles, 21)
    return [(p[0], p[1], eles[i]) for i, p in enumerate(pts)]


def gpx_text(name, pts):
    rows = ['<gpx><trk><trkseg>']
    for lat, lon, ele in pts:
        rows.append(f'<trkpt lat="{lat:.5f}" lon="{lon:.5f}"><ele>{ele:.1f}</ele></trkpt>')
    rows.append('</trkseg></trk></gpx>')
    return "".join(rows)


# ---------- 复刻 app 里 track.js 的难度算法，保证 data.js 里的 level 和页面显示一致 ----------
GRAD_STEPS = [(15, "easy"), (25, "mid"), (float("inf"), "hard")]
CLIMB_STEPS = [(300, "easy"), (900, "mid"), (float("inf"), "hard")]
ORDER = ["easy", "mid", "hard", "hidden"]


def step_of(steps, v):
    for mx, lv in steps:
        if v <= mx:
            return lv


def normalize(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    dx = (x1 - x0) or 1
    dy = (y1 - y0) or 1
    return [((p[0] - x0) / dx, 1 - (p[1] - y0) / dy) for p in pts]


def norm01(a):
    mn, mx = min(a), max(a)
    d = (mx - mn) or 1
    return [(v - mn) / d for v in a]


def sustained_gradient(pts, eles, km, ele_span):
    """复刻 track.js 的 segments() + sustainedGradient()。

    注意用 ele_span（真实海拔跨度）而不是 up（总爬升）来还原海拔：
    track.js 已改为同样的口径，否则环形线路的坡度会被放大 up/range 倍。
    """
    n = len(pts)
    if n < 2:
        return 0.0
    cd = [0.0]
    for i in range(1, n):
        cd.append(cd[-1] + math.dist(pts[i], pts[i - 1]))
    total = cd[-1] or 1.0
    raw = []
    for i in range(1, n):
        dm = (cd[i] - cd[i - 1]) / total * km * 1000
        de = (eles[i] - eles[i - 1]) * ele_span
        pct = abs(de / dm * 100) if dm > 0 else 0.0     # 下坡按反向爬坡同权，和 track.js 一致
        raw.append([step_of(GRAD_STEPS, pct), de, dm / 1000])
    merged = []
    for lv, de, kmx in raw:
        if merged and merged[-1][0] == lv:
            merged[-1][1] += de
            merged[-1][2] += kmx
        else:
            merged.append([lv, de, kmx])
    best, longest = 0.0, 0.0
    for _, de, kmx in merged:
        pct = abs(de) / (kmx * 1000) * 100 if kmx > 0 else 0.0
        longest = max(longest, pct if kmx * 1000 >= 400 else 0.0)
        if kmx * 1000 >= 400:
            best = max(best, pct)
    return best or longest


def trail_level(up, grad):
    a = ORDER.index(step_of(CLIMB_STEPS, up))
    b = ORDER.index(step_of(GRAD_STEPS, grad))
    return ORDER[max(a, b)]


def ref_hours(km, up):
    """Naismith 参考：4.5 km/h 平路 + 每 600 m 爬升 1 小时。"""
    h = km / 4.5 + up / 600.0
    return h


def fmt_hours(h):
    if h <= 1.25:
        return f"约 {max(1, round(h * 2) / 2):g} 小时"
    return f"约 {round(h * 2) / 2:g} 小时"


def main():
    stats, gpx = {}, {}
    groups = [("hiking", HERE), ("parks", os.path.join(HERE, "parks"))]
    for group, folder in groups:
        man = json.load(open(os.path.join(folder, "manifest.json"), encoding="utf-8"))
        for m in man:
            raw = load_gpx(os.path.join(folder, m["file"]))
            pts = simplify(denoise_ele(raw))
            km = m["distance_km"]
            up = m["gain_m"]
            npts = normalize([(p[1], p[0]) for p in pts])          # JS: x=lon, y=lat
            eles = norm01([p[2] for p in pts])
            ele_span = max(p[2] for p in pts) - min(p[2] for p in pts)
            grad = sustained_gradient(npts, eles, km, ele_span)
            lvl = trail_level(up, grad)
            h = ref_hours(km, up)
            stats[m["slug"]] = {
                "name": m["name"], "group": group, "km": km, "up": up,
                "upRaw": m["gain_raw_m"], "level": lvl, "grad": round(grad, 1),
                "hours": fmt_hours(h), "hoursNum": round(h, 2),
                "pts": len(pts), "ele": [m["min_ele"], m["max_ele"]],
                "eleSpan": round(ele_span, 1),
                "activity": m["activity"], "trip": m["trip_id"], "src": m["source"],
                "desc": m["desc"], "closed": m["closed_m"], "date": m["date"],
                "surface": m.get("surface"), "pace": m.get("pace"),
            }
            gpx[m["slug"]] = gpx_text(m["name"], pts)
            print(f'{m["slug"]:<15} {len(raw):>5}→{len(pts):>4}pts {km:>6}km '
                  f'+{up:>4}m {lvl:<7} 最陡连续 {grad:>5.1f}%  {fmt_hours(h)}')

    os.makedirs(APP_JS, exist_ok=True)
    out = os.path.join(APP_JS, "routes.data.js")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("/* 自动生成：tracks/build_app_data.py —— 不要手改 */\n")
        fh.write("window.HIKES_ROUTE_DATA = ")
        json.dump({"stats": stats, "gpx": gpx}, fh, ensure_ascii=False, indent=0)
        fh.write(";\n")
    print(f"\nwrote {out}  ({os.path.getsize(out)//1024} KB, {len(stats)} routes)")


if __name__ == "__main__":
    main()
