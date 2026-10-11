# -*- coding: utf-8 -*-
"""从六只脚（foooooot.com）公开接口抓取轨迹，转成 GPX 1.1。

用法：
    python3 make_gpx.py            # 抓取全部线路，山野写到本目录，公园写到 parks/
    python3 make_gpx.py --only hiking
    python3 make_gpx.py --only parks

换线路：把 ROUTES 里的轨迹号（六只脚 trip id，见 https://www.foooooot.com/trip/<id>/）
替换掉即可。轨迹点接口无需登录：
    GET https://www.foooooot.com/v4/api/trip/<id>/trackjson
    返回 [[时间, 纬度, 经度, 海拔, 速度, 累计km], ...]，按 segment 分组。
"""
import html
import json
import math
import os
import sys
import time
import datetime
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")
HERE = os.path.dirname(os.path.abspath(__file__))

# (文件名, 中文名, 六只脚轨迹号, 类型, 说明)
HIKING = [
    ("sanfeng",       "三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）", "100107125", "hiking",
     "北京海淀/门头沟：京西三峰经典大环，越野跑与徒步拉练的标杆线路。"),
    ("xiangbala",     "香八拉（香山→八大处）",                 "10236323",  "hiking",
     "北京海淀：香山到八大处穿越，西山最经典的入门长线。"),
    ("xiaotaoren",    "香山小桃人（追击小桃人）",               "10125202",  "hiking",
     "北京海淀香山：网红“小桃人/小桃仁”线，香山腹地多坡道组合。"),
    ("taoxin",        "西山桃心（桃心线）",                     "4363143",   "hiking",
     "北京海淀/门头沟：沿西山画出一颗“心”，轨迹控最爱。"),
    ("jiankou",       "箭扣长城（西段）",                       "9985585",   "hiking",
     "北京怀柔：箭扣长城经典段，野长城险峻，需注意安全。"),
    ("jingxigudao",   "京西古道小环线",                         "9983986",   "hiking",
     "北京门头沟：京西古道玉河段，石板路与马蹄窝。"),
    ("fenghuangling", "凤凰岭环穿",                             "10153715",  "hiking",
     "北京海淀：凤凰岭景区大环，花岗岩地貌。"),
    ("baiwala",       "白八拉（毕业线）",                       "1313256",   "trailrunning",
     "北京海淀/门头沟：白家疃—八大处约40km超长拉练，“毕业线”。"),
    ("yudushan",      "玉渡山·后河·应梦寺大环",                 "10119198",  "hiking",
     "北京延庆：应梦寺-后河-玉渡山-野山峡环线，六只脚高人气线路。"),
    ("donglingshan",  "东灵山主峰",                             "100071885", "hiking",
     "北京门头沟：登顶北京最高峰东灵山（2303m）。"),
    ("baipusi",       "白瀑寺环穿",                             "9565481",   "hiking",
     "北京门头沟：了思台-白瀑寺-东坨环穿，古寺与山脊。"),
    ("xiangzhixian",  "香植线（香山→植物园）",                   "99979765",  "hiking",
     "北京海淀：香山邮局到植物园，西山最热门的短途穿越。"),
]

PARKS = [
    ("aoseng-10k",    "奥森公园 · 南北园大圈",       "10191033",  "running",
     "北京朝阳：奥林匹克森林公园南北园一圈，10km 塑胶跑道，北京跑者第一主场。"),
    ("aoseng-5k",     "奥森公园 · 南园 5 公里",       "8221904",   "running",
     "北京朝阳：奥森南园一圈，5km，夜跑与配速课首选。"),
    ("chaoyang-5k",   "朝阳公园 · 5 公里健步道",       "10030193",  "running",
     "北京朝阳：朝阳公园环园步道，平路、无车、遮阴多。"),
    ("chengshi-lvxin","城市绿心森林公园",              "6931324",   "running",
     "北京通州：城市绿心森林公园健步走环线，通州跑友主场。"),
    ("lianshihu",     "莲石湖 · 冬奥公园环线",         "4945599",   "running",
     "北京石景山/门头沟：永定河莲石湖—冬奥公园环线，河景平路。"),
    ("yuyuantan",     "玉渊潭公园 · 大环线",            "9901190",   "running",
     "北京海淀：玉渊潭大环线一圈约 4 km，樱花季最热门的城市跑道。"),
    ("zizhuyuan",     "紫竹院公园 · 环线",              "8510910",   "running",
     "北京海淀：紫竹院公园环线一圈约 2.5 km，竹荫湖景，适合晨跑。"),
    ("yiheyuan",      "颐和园环昆明湖",                "99908178",  "running",
     "北京海淀：颐和园环湖一圈，皇家园林里的长距离慢跑。"),
    ("tiantan",       "天坛 · 外坛墙环线",              "9921413",   "running",
     "北京东城：天坛外坛墙一整圈约 7 km，古柏林里的城市跑道。"),
    ("shichahai",     "什刹海环湖",                    "9704729",   "running",
     "北京西城：什刹海—后海环湖，老城夜跑经典。"),
    ("beihai",        "北海公园环湖",                  "9163709",   "running",
     "北京西城：北海公园环湖一圈，白塔倒影。"),
    ("nanhaizi",      "南海子公园",                    "10071451",  "running",
     "北京大兴：南海子郊野公园环线，麋鹿苑旁的大片绿地。"),
    ("shougang",      "首钢园 10 公里",                "10108559",  "running",
     "北京石景山：首钢园工业风跑道 10km，冬奥园区地标线。"),
    ("wenhe",         "温榆河公园（朝阳段）",          "9669824",   "running",
     "北京朝阳：温榆河公园示范区环线，生态绿道。"),
    ("longtanhu",     "龙潭湖公园环湖",                "8463463",   "running",
     "北京东城：龙潭湖三湖环线，短距离轻松跑。"),
    ("taoranting",    "陶然亭公园",                    "9033357",   "running",
     "北京西城：陶然亭公园环线，城南跑友日常。"),
]

GROUPS = {
    "hiking": (HERE, HIKING),
    "parks": (os.path.join(HERE, "parks"), PARKS),
}

# 公园跑道的常见路面类型。这是经验判断（按公园普遍路况），不是逐段核实——
# GPX 里没有路面信息，不要在页面上当作精确数据用。
SURFACE = {
    "aoseng-10k":     "塑胶跑道为主",
    "aoseng-5k":      "塑胶跑道为主",
    "chaoyang-5k":    "沥青步道",
    "chengshi-lvxin": "沥青绿道",
    "lianshihu":      "沥青绿道",
    "yuyuantan":      "沥青环湖路",
    "zizhuyuan":      "沥青园路",
    "yiheyuan":       "石板 + 沥青",
    "tiantan":        "沥青外环道",
    "shichahai":      "石板 + 沥青",
    "beihai":         "石板园路",
    "nanhaizi":       "沥青绿道",
    "shougang":       "沥青",
    "wenhe":          "沥青绿道",
    "longtanhu":      "沥青园路",
    "taoranting":     "沥青园路",
}
PACES = (5, 6, 7)          # 分/公里

# 只保留北京范围内的点，防止个别漂移点污染文件
BBOX = (39.0, 41.5, 115.0, 118.0)


def fetch_track(track_id):
    url = f"https://www.foooooot.com/v4/api/trip/{track_id}/trackjson"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": f"https://www.foooooot.com/trip/{track_id}/",
    })
    return json.loads(urllib.request.urlopen(req, timeout=45).read())


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def iso(ts):
    return datetime.datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_gain(eles, window=7, threshold=2.0):
    """对 GPS 海拔做滑动平均去噪后累加爬升。

    原始气压海拔抖动很大，逐点累加会把噪声算成爬升（常偏高 30%–50%）。
    这里先做窗口平滑，再只累计超过 threshold 的上升变化。
    """
    n = len(eles)
    half = window // 2
    smooth = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        smooth.append(sum(eles[lo:hi]) / (hi - lo))
    gain = 0.0
    ref = smooth[0]
    for v in smooth[1:]:
        d = v - ref
        if d > threshold:
            gain += d
            ref = v
        elif d < -threshold:
            ref = v
    return gain


def pace_times(km):
    """按给定配速（分/公里）换算完成时间，用于公园跑道。"""
    out = {}
    for p in PACES:
        sec = int(round(km * p * 60))
        h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
        out[str(p)] = (f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}")
    return out


def build(spec, out_dir):
    slug, name, track_id, activity, desc = spec
    data = fetch_track(track_id)
    pts = [p for seg in data for p in seg if isinstance(p, (list, tuple)) and len(p) >= 4]
    lo_lat, hi_lat, lo_lon, hi_lon = BBOX
    pts = [p for p in pts if lo_lat < float(p[1]) < hi_lat and lo_lon < float(p[2]) < hi_lon]
    if len(pts) < 2:
        raise RuntimeError(f"{name}: 北京范围内没有轨迹点")

    ts = [int(p[0]) for p in pts]
    usable_time = (len(set(ts)) > 1
                   and all(ts[i] <= ts[i + 1] for i in range(len(ts) - 1))
                   and min(ts) > 1_000_000_000)

    dist = sum(haversine((pts[i][1], pts[i][2]), (pts[i + 1][1], pts[i + 1][2]))
               for i in range(len(pts) - 1))
    eles = [float(p[3]) for p in pts]
    raw_gain = sum(max(0.0, eles[i + 1] - eles[i]) for i in range(len(eles) - 1))
    gain = clean_gain(eles)
    loss = sum(max(0.0, eles[i] - eles[i + 1]) for i in range(len(eles) - 1))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="六只脚 foooooot.com" '
             'xmlns="http://www.topografix.com/GPX/1/1" '
             'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
             'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 '
             'http://www.topografix.com/GPX/1/1/gpx.xsd">',
             '  <metadata>',
             f'    <name>{html.escape(name)}</name>',
             f'    <desc>{html.escape(desc)} 来源：六只脚轨迹 {track_id}'
             f'（https://www.foooooot.com/trip/{track_id}/）</desc>']
    if usable_time:
        lines.append(f'    <time>{iso(ts[0])}</time>')
    lines += ['  </metadata>',
              f'  <wpt lat="{pts[0][1]:.6f}" lon="{pts[0][2]:.6f}">'
              f'<name>起点</name><ele>{pts[0][3]:.1f}</ele></wpt>',
              f'  <wpt lat="{pts[-1][1]:.6f}" lon="{pts[-1][2]:.6f}">'
              f'<name>终点</name><ele>{pts[-1][3]:.1f}</ele></wpt>',
              '  <trk>',
              f'    <name>{html.escape(name)}</name>',
              f'    <desc>{html.escape(desc)}</desc>',
              '    <trkseg>']
    for p in pts:
        lines.append(f'      <trkpt lat="{float(p[1]):.6f}" lon="{float(p[2]):.6f}">')
        lines.append(f'        <ele>{float(p[3]):.1f}</ele>')
        if usable_time:
            lines.append(f'        <time>{iso(p[0])}</time>')
        lines.append('      </trkpt>')
    lines += ['    </trkseg>', '  </trk>', '</gpx>', '']

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, slug + ".gpx"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    km_round = round(dist / 1000, 2)
    return {"slug": slug, "file": slug + ".gpx", "name": name, "trip_id": track_id,
            "activity": activity, "desc": desc, "points": len(pts),
            "distance_km": km_round, "gain_m": round(gain),
            "gain_raw_m": round(raw_gain), "loss_m": round(loss),
            "min_ele": round(min(eles)), "max_ele": round(max(eles)),
            "closed_m": round(haversine((pts[0][1], pts[0][2]), (pts[-1][1], pts[-1][2]))),
            "elevation": "no" if max(eles) <= 5 else "yes",
            "time": "yes" if usable_time else "no",
            "surface": SURFACE.get(slug),
            "pace": pace_times(km_round) if activity == "running" else None,
            "date": iso(ts[0])[:10] if usable_time else None,
            "source": f"https://www.foooooot.com/trip/{track_id}/"}


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    for group, (out_dir, routes) in GROUPS.items():
        if only and only != group:
            continue
        print(f"\n=== {group} → {os.path.relpath(out_dir, HERE)}")
        manifest = []
        for spec in routes:
            try:
                m = build(spec, out_dir)
            except Exception as exc:                       # noqa: BLE001
                print("FAIL", spec[1], exc)
                continue
            manifest.append(m)
            print(f'OK  {m["slug"]:<15} {m["points"]:>5}pts {m["distance_km"]:>6}km '
                  f'+{m["gain_m"]:>4}m(原始{m["gain_raw_m"]:>5}) 闭合{m["closed_m"]:>5}m '
                  f'{m["name"]}')
            time.sleep(0.5)
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
