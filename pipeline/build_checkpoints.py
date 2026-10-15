"""从赛事 GPX 里提取官方打卡点（<wpt>），并算出它在赛道上的位置。

组委会给的 GPX 里那批 <wpt> 就是检查点 / 补给点，点名是官方的
（云丘山的「U1-轻野」、大境门的「D2啕北营村21.3」、宁海的「CP1 峰山」）。
它们只有经纬度，没有里程和海拔，所以这里做一件事：
把每个打卡点贴回轨迹上，算出**它在本条线路的第几公里**、**海拔多少**、
以及**离轨迹多远**（后者用来判数据质量——贴不到轨迹上的点是录错的）。

顺便给沿途山顶标出最近的打卡点：赛道上的顶大多就在某个补给点旁边，
有了这个关系，界面上就能写「离 CP3 东坪 400 m」，而不是一句干巴巴的「名称待定」。

用法：python3 pipeline/build_checkpoints.py
输出：pipeline/out/race_checkpoints.json
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RACES = ROOT / "tracks" / "races"
OUT = ROOT / "pipeline" / "out"


def hav(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def ele_at(pts, i):
    """打卡点所在那个轨迹点的海拔。

    有些 GPX 个别点没写 <ele>（解析成 0），直接取会得到"海拔 0 m"。
    那就往两边找最近一个真有海拔的点——几百米内的高差，比 0 靠谱得多。
    """
    if pts[i][2] > 0:
        return pts[i][2]
    for d in range(1, 200):
        for j in (i - d, i + d):
            if 0 <= j < len(pts) and pts[j][2] > 0:
                return pts[j][2]
    return 0.0


def parse(path):
    """→ (打卡点列表, 轨迹点列表)。属性顺序两种都认。"""
    s = path.read_text(encoding="utf-8", errors="ignore")
    wpts = []
    for m in re.finditer(r"<wpt\b([^>]*)>([\s\S]{0,400}?)</wpt>", s):
        attrs, body = m.group(1), m.group(2)
        la = re.search(r'lat="([-\d.]+)"', attrs)
        lo = re.search(r'lon="([-\d.]+)"', attrs)
        nm = re.search(r"<name>([^<]+)</name>", body)
        if la and lo and nm:
            wpts.append((float(la.group(1)), float(lo.group(1)), nm.group(1).strip()))
    pts = []
    for m in re.finditer(r"<trkpt\b([^>]*)>([\s\S]{0,200}?)</trkpt>", s):
        attrs, body = m.group(1), m.group(2)
        la = re.search(r'lat="([-\d.]+)"', attrs)
        lo = re.search(r'lon="([-\d.]+)"', attrs)
        el = re.search(r"<ele>\s*([-\d.]+)", body)
        if la and lo:
            pts.append((float(la.group(1)), float(lo.group(1)),
                        float(el.group(1)) if el else 0.0))
    return wpts, pts


def main():
    manifest = json.loads((RACES / "manifest.json").read_text(encoding="utf-8"))
    races = json.loads((OUT / "race_routes.json").read_text(encoding="utf-8"))
    out, n_wpt = {}, 0
    for m in manifest:
        slug = f'{m["slug"]}-{m["year"]}'
        wpts, pts = parse(RACES / m["file"])
        if not wpts or len(pts) < 2:
            continue
        cum = [0.0]
        for i in range(1, len(pts)):
            cum.append(cum[-1] + hav((pts[i - 1][0], pts[i - 1][1]), (pts[i][0], pts[i][1])))
        total = cum[-1] or 1.0
        # 我们入库的距离可能是官方标称值（GPX 自算值略有出入），按比例换算到标称里程
        scale = (races.get(slug, {}).get("km") or total / 1000) * 1000 / total
        rows = []
        for la, lo, name in wpts:
            best_i, best_d = 0, float("inf")
            for i, p in enumerate(pts):                 # 打卡点就几十个，暴力找最近点够了
                d = hav((la, lo), (p[0], p[1]))
                if d < best_d:
                    best_i, best_d = i, d
            rows.append({"name": name,
                         "km": round(cum[best_i] * scale / 1000, 2),
                         "altitude": round(ele_at(pts, best_i)),
                         "lat": round(la, 6), "lng": round(lo, 6),
                         "off_track_m": round(best_d)})
        rows.sort(key=lambda r: r["km"])
        for i, r in enumerate(rows, 1):
            r["no"] = i
        out[slug] = rows
        n_wpt += len(rows)
        print(f'{slug:<26} 打卡点 {len(rows):>3}  '
              f'{rows[0]["name"][:14]} … {rows[-1]["name"][:14]}')

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "race_checkpoints.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    far = [(slug, r["name"], r["off_track_m"]) for slug, rs in out.items()
           for r in rs if r["off_track_m"] > 300]
    print(f'\n✓ {len(out)} 条线路 · {n_wpt} 个打卡点写入 {OUT / "race_checkpoints.json"}')
    if far:
        print(f'  离轨迹超过 300 m 的（可能是录错的点）：{len(far)} 个')
        for x in far[:6]:
            print(f'    {x[0]:<24}{x[1][:18]:<20}{x[2]} m')


if __name__ == "__main__":
    main()
