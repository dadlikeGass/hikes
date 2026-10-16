"""GPX / KML → 路线数据 · 唯一入口（算法核心 + 各来源适配）

三个来源共用同一套算法（重采样 → 平滑 → 找山顶 → 分段定级 → 累计爬升），
各自的差别只在"名称、地区、来源"这些元数据从哪来：

  beijing  tracks/*.gpx           + tracks/manifest.json            → out/routes.json
  cn       tracks/routes-cn/*.gpx + tracks/routes-cn/manifest.json  → out/routes_cn.json
  races    tracks/races/*.gpx|kml + tracks/races/manifest.json      → out/race_routes.json
                                                                    → out/race_checkpoints.json（打卡点，同一步产出）

用法：
  python3 pipeline/build.py                      # 三个来源全跑
  python3 pipeline/build.py --source races       # 只跑赛事（含打卡点）
  python3 pipeline/build.py --source cn --only fff-99984929 sanfeng
                                                # --only 只写 <来源>.partial.json，不动正式产物

产物（pipeline/out/）：
  routes.json / routes_cn.json / race_routes.json / race_checkpoints.json / _meta.json
  入库：server/seeds/seed_routes.py --file out/<name>.json
  底图：pipeline/build_terrain.py 直接读这些产物，不再自己解析 GPX。

分段难度规则（三处必须一致：本文件、migration 0008、server/app/main.py 的 SQL）：
  难易只看爬升高度与平均坡度，距离不进难度。
  · 爬升高度取**段内最大连续爬升**（climb_run），不是净高差、也不是累计爬升：
    净高差会把起伏路算没（京西古道 9 km 净升 96 m，实际累计爬升 645 m）；
    累计爬升又会把"距离"偷偷带进难度（39 km 的赛段只有 560 m 起伏也会被判 hard）。
    最大连续爬升和段长无关，也和下坡那一侧的 max_drop 对称。
  · 净下坡段（净坡度 < −3%）一律不定级：level = null、
    difficulty_applicable = false、not_applicable = "descent"。
    下坡的难度是另一码事（路面、湿滑、是否需要保护），不用登顶难度表达；
    这种段的段内累计爬升仍然写进 up_m，供人判断。
  · 其余段：最大连续爬升 ≥ 200 m 或净坡度 > 3% 才定级；
    都不到（净坡 ≤3% 且最大连续爬升 < 200 m）→ not_applicable = "gentle"。
  · 分级取两个维度里更高的那档：坡度 ≤15/15–25/>25%，爬升 ≤200/200–500/>500 m。
"""
import argparse
import bisect
import datetime
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "pipeline" / "out"

ALGORITHM_VERSION = "3"

STEP_M = 100.0        # 重采样间隔
SMOOTH = 2            # 5 点滑动平均（±2）
THR = 3.0             # 累计爬升/下降的高程滞回阈值（米）
MIN_REL = 30          # 山顶相对高度门槛
MIN_GAP_KM = 0.5      # 相邻山顶最小间距
GAIN_RATE_MIN = 200   # 长缓坡门槛：净爬升 ≥ 这个值也算爬升段
LOOP_GAP_M = 200      # 首尾距离小于这个值算环线
OFF_TRACK_VERIFY_M = 50.0   # 打卡点离轨迹超过这个距离 → 标待核验

# 段难度只看两个维度：爬升高度、平均坡度。
# 爬升阈值按北京山地实况抬高（原 100/300 对这里太低）。
BAND_GRAD = [(15, "easy"), (25, "mid"), (1e9, "hard")]
BAND_GAIN = [(200, "easy"), (500, "mid"), (1e9, "hard")]
ORD = {"easy": 0, "mid": 1, "hard": 2}
REV = ["easy", "mid", "hard"]

# 完成时间与消耗的估算参数（写进产物，前端要标注"估算"）
HIKER_WEIGHT_KG = 65      # 体面体重
MET = 6.5                 # 负重徒步的代谢当量
FLAT_KMH = 5.0            # 成熟步道平均速度
CLIMB_FACTOR = 8.0        # 爬升 1 m ≈ 水平 8 m（接近 Naismith 法则）


# --------------------------------------------------------------------------- #
# 解析（GPX 与 KML 都认）
# --------------------------------------------------------------------------- #
def parse(path: Path):
    """→ (轨迹点, 打卡点)。点都是 (lat, lon, ele)。"""
    s = path.read_text(encoding="utf-8", errors="ignore")
    pts, wpts = [], []

    if "<kml" in s[:4000]:
        # KML：赛道在 <LineString><coordinates>lon,lat,ele …</coordinates>，
        # 官方打卡点在 <Placemark><name>…</name><Point><coordinates>。
        for m in re.finditer(r"<LineString\b[\s\S]*?</LineString>", s):
            for lon, lat, ele in re.findall(
                    r"([-\d.]+),([-\d.]+)(?:,([-\d.]+))?", m.group(0)):
                pts.append((float(lat), float(lon), float(ele) if ele else 0.0))
        for m in re.finditer(r"<Placemark\b([\s\S]*?)</Placemark>", s):
            body = m.group(1)
            nm = re.search(r"<name>([^<]+)</name>", body)
            co = re.search(r"<coordinates>\s*([-\d.]+),([-\d.]+)", body)
            if nm and co:
                wpts.append((float(co.group(2)), float(co.group(1)), nm.group(1).strip()))
        return pts, wpts

    # GPX：属性顺序不定，分开取 lat / lon（老写法只认 lat 在前会整条读不到）。
    for m in re.finditer(r"<trkpt\b([^>]*)>(.*?)</trkpt>", s, re.S):
        attrs, body = m.group(1), m.group(2)
        la = re.search(r'lat="([-\d.]+)"', attrs)
        lo = re.search(r'lon="([-\d.]+)"', attrs)
        if not (la and lo):
            continue
        e = re.search(r"<ele>\s*([-\d.]+)", body)
        pts.append((float(la.group(1)), float(lo.group(1)),
                    float(e.group(1)) if e else 0.0))
    for m in re.finditer(r"<wpt\b([^>]*)>([\s\S]{0,400}?)</wpt>", s):
        attrs, body = m.group(1), m.group(2)
        la = re.search(r'lat="([-\d.]+)"', attrs)
        lo = re.search(r'lon="([-\d.]+)"', attrs)
        nm = re.search(r"<name>([^<]+)</name>", body)
        if la and lo and nm:
            wpts.append((float(la.group(1)), float(lo.group(1)), nm.group(1).strip()))
    return pts, wpts


def hav(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def gain_loss(pts):
    """累计爬升/下降：原始高程 + 滞回，不能用平滑高程（会把小起伏抹平）"""
    up = dn = 0.0
    ref = pts[0][2]
    for p in pts[1:]:
        d = p[2] - ref
        if d >= THR:
            up += d
            ref = p[2]
        elif d <= -THR:
            dn += -d
            ref = p[2]
    return up, dn


def band(table, v):
    for lim, lv in table:
        if v <= lim:
            return lv


def split_name(full: str):
    """「三峰连穿（大觉寺·鹫峰）」→ ("三峰连穿", "大觉寺·鹫峰")"""
    m = re.match(r"^([^（(]+)[（(](.+)[）)]$", full.strip())
    return (m.group(1).strip(), m.group(2).strip()) if m else (full.strip(), None)


# --------------------------------------------------------------------------- #
# 核心分析（所有来源共用）
# --------------------------------------------------------------------------- #
def segment_rating(pct: float, climb_run: float):
    """→ (是否定级, 等级, 不定级的原因)。

    爬升高度用**段内最大连续爬升**（climb_run）：净高差会把起伏路算没，
    累计爬升又会把距离带进难度。
    净下坡段走独立语义，不套登顶难度。
    """
    if pct < -3:
        return False, None, "descent"
    if climb_run < GAIN_RATE_MIN and pct <= 3:
        return False, None, "gentle"
    lv = REV[max(ORD[band(BAND_GRAD, max(pct, 0))], ORD[band(BAND_GAIN, climb_run)])]
    return True, lv, None


def raw_slice(cum, km0, km1):
    """按沿线里程取原始轨迹点的下标区间（累计爬升用原始高程算）。"""
    i0 = bisect.bisect_left(cum, km0 * 1000)
    i1 = bisect.bisect_right(cum, km1 * 1000)
    return max(0, i0), min(len(cum) - 1, i1)


def max_run(sm, i0, i1, sign):
    """段内最大连续爬升（sign=+1）或连续下降（sign=-1），单位米。

    切点只取山顶，长上坡/长下坡都可能被并进相邻段，这两个值让它们仍然能看见，
    也正好是难度的输入：爬升那一侧用最大连续爬升，与段长无关。
    """
    ref = sm[i0]
    worst = 0.0
    for i in range(i0, i1 + 1):
        d = sign * (sm[i] - ref)
        if d < 0:            # 走到反向的极值：把基准挪过去
            ref = sm[i]
        elif d > worst:      # 顺方向走出的最大幅度就是答案
            worst = d
    return round(worst)


def max_drop(sm, i0, i1):
    """段内最大的连续下降（米）。"""
    return max_run(sm, i0, i1, -1)


def analyze(path: Path):
    """GPX/KML → (路线核心数据, 内部几何)。几何给赛事打卡点复用，不写进产物。"""
    raw, wpts = parse(path)
    if len(raw) < 10:
        return None, None
    cum = [0.0]
    for i in range(1, len(raw)):
        cum.append(cum[-1] + hav(raw[i - 1], raw[i]))
    total = cum[-1]
    if total < 500:
        return None, None
    up, dn = gain_loss(raw)

    n = max(10, min(400, round(total / STEP_M)))
    xs, ys, ll = [], [], []
    j = 0
    for k in range(n):
        t = k / (n - 1) * total
        while j < len(cum) - 2 and cum[j + 1] < t:
            j += 1
        a, b = cum[j], cum[j + 1]
        f = (t - a) / (b - a) if b > a else 0.0
        xs.append(t / 1000.0)
        ys.append(raw[j][2] + (raw[j + 1][2] - raw[j][2]) * f)
        ll.append((raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f,
                   raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f))
    sm = [sum(ys[max(0, i - SMOOTH):min(n, i + SMOOTH + 1)]) /
          len(ys[max(0, i - SMOOTH):min(n, i + SMOOTH + 1)]) for i in range(n)]

    # 山顶候选按峰高排序并做最小间距抑制；相对高度用相邻较低鞍部计算。
    cand = sorted([k for k in range(1, n - 1) if sm[k] >= sm[k - 1] and sm[k] > sm[k + 1]],
                  key=lambda p: -sm[p])
    top = []
    for p in cand:
        if not any(abs(xs[q] - xs[p]) < MIN_GAP_KM for q in top):
            top.append(p)
    top.sort()
    peaks = []
    for i, p in enumerate(top):
        left_saddle = min(sm[top[i - 1]:p + 1]) if i > 0 else None
        right_saddle = min(sm[p:top[i + 1] + 1]) if i + 1 < len(top) else None
        saddles = [x for x in (left_saddle, right_saddle) if x is not None]
        rel = sm[p] - max(saddles) if saddles else 0
        if rel >= MIN_REL:
            # 经纬度：采样时就存了，之前没输出——有了坐标才能做"附近的山"和导航
            peaks.append({"km": round(xs[p], 2), "ele": round(sm[p]), "rel": round(rel),
                          "lat": round(ll[p][0], 6), "lng": round(ll[p][1], 6)})
    peak_idx = {round(xs[p], 2): p for p in top}

    # 分段：以候选山顶为切点（山顶 = 上坡结束、下坡开始的地方）。
    marks = sorted(set([0, n - 1] + [peak_idx[p["km"]] for p in peaks if p["km"] in peak_idx]))
    segs = []
    for k in range(len(marks) - 1):
        i0, i1 = marks[k], marks[k + 1]
        if i1 - i0 < 1:
            continue
        dm = (xs[i1] - xs[i0]) * 1000
        de = sm[i1] - sm[i0]
        pct = de / dm * 100 if dm > 0 else 0
        km = xs[i1] - xs[i0]
        r0, r1 = raw_slice(cum, xs[i0], xs[i1])
        seg_up, seg_dn = gain_loss(raw[r0:r1 + 1]) if r1 > r0 else (0.0, 0.0)
        climb_run = max_run(sm, i0, i1, 1)
        rated, lv, why = segment_rating(pct, climb_run)
        segs.append({"no": len(segs) + 1, "from": round(xs[i0], 2), "to": round(xs[i1], 2),
                     "km": round(km, 2), "rise": round(de), "pct": round(pct), "level": lv,
                     "up_m": round(seg_up), "down_m": round(seg_dn),
                     "difficulty_applicable": rated,
                     "not_applicable": why,
                     "max_rise_m": climb_run,
                     "max_drop_m": max_drop(sm, i0, i1),
                     "kind": "climb" if pct > 3 else ("desc" if pct < -3 else "flat"),
                     "a": i0, "b": i1})

    la = [p[0] for p in ll]
    lo = [p[1] for p in ll]
    mnx, mxx, mny, mxy = min(lo), max(lo), min(la), max(la)
    dx, dy = (mxx - mnx) or 1, (mxy - mny) or 1
    s = max(dx, dy)
    ox, oy = (s - dx) / 2, (s - dy) / 2
    path_norm = [[round(((lo[i] - mnx) + ox) / s, 5), round(1 - ((la[i] - mny) + oy) / s, 5)]
                 for i in range(n)]
    elevation_m = [round(e, 1) for e in ys]
    prof = [round((e - min(ys)) / ((max(ys) - min(ys)) or 1), 4) for e in ys]

    # 线路难度不再整体分级。只标"最难的那一段"，另给完成时间与消耗估算。
    rated_segs = [x for x in segs if x["difficulty_applicable"]]
    hardest = max(rated_segs, key=lambda x: ORD[x["level"]]) if rated_segs else None
    eq_km = total / 1000 + up * CLIMB_FACTOR / 1000     # 等效距离
    hours = eq_km / FLAT_KMH
    kcal = MET * HIKER_WEIGHT_KG * hours
    end_gap = round(hav(raw[0], raw[-1]))
    # 城市 / 区域：从 GPX 的 <desc> 里取（形如「北京海淀/门头沟：京西三峰…」）
    txt = path.read_text(encoding="utf-8", errors="ignore")
    md = re.search(r"<desc>([^<]*)</desc>", txt)
    city = "北京"
    if md:
        mc = re.search(r"北京([^：:]+)[：:]", md.group(1))
        if mc:
            city = "北京 · " + mc.group(1).strip().replace("/", " / ")
    core = {
        "algorithmVersion": ALGORITHM_VERSION,
        "city": city,
        "name": (re.search(r"<name>([^<]+)</name>", txt) or [None, path.stem])[1],
        "km": round(total / 1000, 1), "up": round(up), "down": round(dn),
        "hardest": {"level": hardest["level"], "no": hardest["no"],
                    "from": hardest["from"], "to": hardest["to"], "pct": hardest["pct"],
                    "rise": hardest["rise"]} if hardest else None,
        "hours": round(hours, 1), "kcal": round(kcal / 50) * 50,
        "est": {"flatKmh": FLAT_KMH, "climbFactor": CLIMB_FACTOR,
                "weightKg": HIKER_WEIGHT_KG, "met": MET},
        "loop": end_gap <= LOOP_GAP_M, "end_gap_m": end_gap,
        "peaks": peaks, "segments": segs, "path": path_norm, "profile": prof,
        "elevation_m": elevation_m,
        # 归一化几何之外再保留真实经纬度：DEM 底图与空间检索都要它。
        "coordinates": [[round(lat, 6), round(lng, 6)] for lat, lng in ll],
        "points": len(raw), "resampled": n,
    }
    return core, {"xs": xs, "ll": ll, "raw": raw, "wpts": wpts, "cum": cum}


# --------------------------------------------------------------------------- #
# 各来源适配：只补元数据，不动算法
# --------------------------------------------------------------------------- #
def base_route(slug, name, sub, city, kind, activity, source, core):
    r = dict(core)
    r.update({"slug": slug, "name": name, "sub": sub, "city": city,
              "kind": kind, "activity": activity, "source": source})
    return r


def adapt_beijing(item, core, geo):
    name, sub = split_name(item["name"])
    r = base_route(item["slug"], name, sub, core["city"], "hike",
                   item.get("activity", "hiking"), item.get("source"), core)
    r["est"] = {**r["est"], "basis": "hike"}
    return r, None


def adapt_cn(item, core, geo):
    city = item["place"].replace(" ", " · ") if item.get("place") else item.get("region")
    r = base_route(item["slug"], item["name"], item.get("region"), city, "hike",
                   item.get("activity", "hiking"), item.get("source"), core)
    r["est"] = {**r["est"], "basis": "hike",
                "sixfootViews": item.get("views"), "sixfootFavs": item.get("favs")}
    return r, None


def adapt_races(item, core, geo):
    """数值优先级：官方公布值 → 清单里的参考值 → 我们自己从 GPX 算的。

    为什么要夹一层清单参考值：有些轨迹点密到离谱（五台山 21K：21 公里 1.3 万个点），
    原始高程的 3m 滞回会把 GPS 抖动全累加成爬升，算出 2.5 万米这种不可能的数。
    """
    off_km = (item.get("official_distance_m") or 0) / 1000.0
    off_up = item.get("official_gain_m")
    ref_km, ref_up = item.get("distance_km"), item.get("gain_m")
    km = round(off_km, 1) if off_km else (ref_km or core["km"])
    up = int(off_up) if off_up else int(ref_up or core["up"])
    slug = f'{item["slug"]}-{item["year"]}'   # 年份进 slug：同一条赛道不同年份是不同的路线
    r = base_route(slug, item["name"], f'{item["year"]} · {item["category"]}',
                   item["place"], "race", item.get("activity", "trail"),
                   item.get("source"), core)
    r.update({"year": item["year"], "event": item["event"],
              "category": item["category"], "place": item["place"],
              "km": km, "up": up,
              "down": item.get("official_loss_m") or item.get("loss_m") or core["down"],
              # 赛事结果不套用休闲徒步时间/热量模型；官方赛事数据单独保留。
              "hours": None, "kcal": None,
              "est": {**core["est"], "basis": "race",
                      "gainOfficial": off_up, "gainManifest": ref_up, "gainGpx": core["up"],
                      "kmOfficial": round(off_km, 1) or None, "kmManifest": ref_km,
                      "kmGpx": core["km"], "note": item.get("gain_note")}})
    return r, project_checkpoints(geo)


def ele_near(pts, i):
    """打卡点所在轨迹点的海拔；个别点没写 <ele>（解析成 0）就往两边找。"""
    if pts[i][2] > 0:
        return pts[i][2]
    for d in range(1, 200):
        for j in (i - d, i + d):
            if 0 <= j < len(pts) and pts[j][2] > 0:
                return pts[j][2]
    return 0.0


def project_km(cum, pts, lat, lng):
    """把点投到轨迹折线上 → (沿线里程 km, 离轨距离 m, 最近原始点序号)。

    离轨距离必须对着**原始**轨迹点算：重采样点是 100 m 一个，
    对着它算，一个正好在轨迹上的点也会"离轨"五十米。
    """
    j, best_d = 0, float("inf")
    for i, p in enumerate(pts):
        d = hav((lat, lng, 0.0), (p[0], p[1], 0.0))
        if d < best_d:
            j, best_d = i, d
    # 再往相邻两段上做投影，取更近的那一段，顺便把里程精确到段内。
    best = (best_d, cum[j])
    for a, b in ((j - 1, j), (j, j + 1)):
        if a < 0 or b >= len(pts):
            continue
        ax, ay = pts[a][0], pts[a][1]
        bx, by = pts[b][0], pts[b][1]
        # 等距圆柱近似：这一级距离（几十米）下足够。
        kx = math.cos(math.radians((ax + bx) / 2))
        vx, vy = (bx - ax) * kx, by - ay
        wx, wy = (lat - ax) * kx, lng - ay
        L2 = vx * vx + vy * vy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
        px, py = ax + (bx - ax) * t, ay + (by - ay) * t
        d = hav((lat, lng, 0.0), (px, py, 0.0))
        if d < best[0]:
            best = (d, cum[a] + (cum[b] - cum[a]) * t)
    return best[1] / 1000.0, best[0], j


def project_checkpoints(geo):
    """官方 waypoint → 沿线里程 / 海拔 / 离轨距离。

    里程在**和路线同一套重采样点**上取最近点，所以打卡点的"第几公里"
    与分段、山顶用的是同一把尺子（旧脚本自己解析 GPX，两套尺子）。
    """
    cum, raw = geo["cum"], geo["raw"]
    out = []
    for lat, lng, name in geo["wpts"]:
        km, d, j = project_km(cum, raw, lat, lng)
        out.append({"name": name, "km": round(km, 2),
                    "altitude": round(ele_near(raw, j)),
                    "lat": round(lat, 6), "lng": round(lng, 6),
                    "off_track_m": round(d),
                    "status": "verify" if d > OFF_TRACK_VERIFY_M else "ok",
                    "no": len(out) + 1})
    return out


# --------------------------------------------------------------------------- #
# 来源表与主流程
# --------------------------------------------------------------------------- #
SOURCES = {
    "beijing": {"dir": ROOT / "tracks", "out": "routes.json",
                "label": "北京山野徒步/越野", "adapter": adapt_beijing},
    "cn": {"dir": ROOT / "tracks" / "routes-cn", "out": "routes_cn.json",
           "label": "全国区域热门路线", "adapter": adapt_cn},
    "races": {"dir": ROOT / "tracks" / "races", "out": "race_routes.json",
              "label": "越野赛事赛道", "adapter": adapt_races, "checkpoints": True},
}


def run_source(key: str, only=None):
    cfg = SOURCES[key]
    src_dir = cfg["dir"]
    manifest = json.loads((src_dir / "manifest.json").read_text(encoding="utf-8"))
    routes, fail, checks = {}, [], {}
    for item in manifest:
        path = src_dir / item["file"]
        if not path.exists():
            fail.append((item["slug"], f'缺文件 {item["file"]}'))
            continue
        try:
            core, geo = analyze(path)
        except Exception as ex:                       # noqa: BLE001
            fail.append((item["slug"], f"{type(ex).__name__}: {ex}"))
            continue
        if not core:
            fail.append((item["slug"], "点太少或距离过短"))
            continue
        rec, cps = cfg["adapter"](item, core, geo)
        if only and rec["slug"] not in only and item["slug"] not in only:
            continue
        routes[rec["slug"]] = rec
        if cps is not None and cps:      # 没有官方 waypoint 的赛道不写空数组
            checks[rec["slug"]] = cps

    OUT.mkdir(parents=True, exist_ok=True)
    # --only 是筛选运行时用的：只落一份 .partial 文件，别把整份产物覆盖成一小撮。
    out_name = cfg["out"] if not only else cfg["out"].replace(".json", ".partial.json")
    (OUT / out_name).write_text(json.dumps(routes, ensure_ascii=False), encoding="utf-8")
    written = [out_name]
    if only:
        print(f"（--only 只写了 {out_name}，正式产物 {cfg['out']} 未被覆盖）")
    if cfg.get("checkpoints"):
        cp_name = "race_checkpoints.json" if not only else "race_checkpoints.partial.json"
        (OUT / cp_name).write_text(json.dumps(checks, ensure_ascii=False), encoding="utf-8")
        written.append(cp_name)

    print(f"\n== {cfg['label']}（{key}）→ {', '.join(written)}")
    if key == "races":
        print(f"{'slug':<28}{'年份':>6}{'km':>8}{'爬升':>8}{'顶':>4}{'段':>4}{'不评级':>7}{'CP':>4}  赛事")
    else:
        print(f"{'slug':<16}{'km':>8}{'爬升':>8}{'顶':>4}{'段':>4}{'不评级':>7}  {'区域':<12}线路")
    print("-" * 96)
    for r in routes.values():
        na = sum(1 for s in r["segments"] if not s["difficulty_applicable"])
        if key == "races":
            print(f'{r["slug"]:<28}{r["year"]:>6}{r["km"]:>8}{r["up"]:>8}'
                  f'{len(r["peaks"]):>4}{len(r["segments"]):>4}{na:>7}'
                  f'{len(checks.get(r["slug"], [])):>4}  {r["event"]}')
        else:
            print(f'{r["slug"]:<16}{r["km"]:>8}{r["up"]:>8}'
                  f'{len(r["peaks"]):>4}{len(r["segments"]):>4}{na:>7}  '
                  f'{str(r.get("sub")):<12}{r["name"][:24]}')
    if fail:
        print("\n跳过：")
        for s, why in fail:
            print(f"  {s}: {why}")
    print(f'✓ {len(routes)} 条写入 {OUT / out_name}'
          f'（{sum(r["points"] for r in routes.values())} 个原始轨迹点）')
    if cfg.get("checkpoints"):
        n_cp = sum(len(v) for v in checks.values())
        n_verify = sum(1 for v in checks.values() for c in v if c["status"] == "verify")
        print(f"✓ {len(checks)} 条赛道 · {n_cp} 个打卡点（待核验 {n_verify} 个）"
              f" → {OUT / 'race_checkpoints.json'}")
    return routes, checks, fail


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="all",
                    choices=["all", "beijing", "cn", "races"],
                    help="跑哪个来源（默认全部）")
    ap.add_argument("--only", nargs="*", default=None,
                    help="只跑指定 slug；赛事可以写不带年份的清单 slug")
    args = ap.parse_args(argv)

    keys = list(SOURCES) if args.source == "all" else [args.source]
    meta = {"algorithmVersion": ALGORITHM_VERSION,
            "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "sources": {}}
    for key in keys:
        routes, checks, fail = run_source(key, set(args.only) if args.only else None)
        if args.only:
            continue          # 筛选运行不写台账，避免把 _meta 记成"只有一条"
        meta["sources"][key] = {
            "file": SOURCES[key]["out"], "label": SOURCES[key]["label"],
            "routes": len(routes), "skipped": len(fail),
            "checkpoints": sum(len(v) for v in checks.values()) if checks else None,
            "segments": sum(len(r["segments"]) for r in routes.values()),
            "unrated_segments": sum(1 for r in routes.values()
                                    for s in r["segments"] if not s["difficulty_applicable"]),
        }
    if not args.only:
        (OUT / "_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
    print(f"\n唯一入口：pipeline/build.py（算法版本 {ALGORITHM_VERSION}，"
          f"{meta['generatedAt']}）"
          + ("（--only 运行：不写台账）" if args.only else f"→ 元信息写进 {OUT / '_meta.json'}"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
