"""GPX → 分段定级 批量管线

对 tracks/*.gpx 逐条执行：按距离重采样 → 5 点平滑 → 找山顶（相邻山顶鞍部高差）
→ 分段（爬升/距离/坡度 取最高）→ 累计爬升用原始高程 + 3m 滞回。

用法：python3 pipeline/build.py
输出：pipeline/out/routes.json（前端与 seed 都从这里读）
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tracks"
OUT = ROOT / "pipeline" / "out"

STEP_M = 100.0        # 重采样间隔
SMOOTH = 2            # 5 点滑动平均（±2）
THR = 3.0             # 累计爬升/下降的高程滞回阈值（米）
MIN_REL = 30          # 山顶相对高度门槛
MIN_GAP_KM = 0.5      # 相邻山顶最小间距


def parse(path):
    s = path.read_text(encoding="utf-8", errors="ignore")
    pts = []
    for m in re.finditer(r'<trkpt[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?>(.*?)</trkpt>',
                         s, re.S):
        e = re.search(r"<ele>\s*([-\d.]+)", m.group(3))
        pts.append((float(m.group(1)), float(m.group(2)), float(e.group(1)) if e else 0.0))
    return pts


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


# 段难度只看两个维度：爬升高度、平均坡度。
# 距离不进难度——它带来的是"多久、多少消耗"，由线路的用时与卡路里表达。
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


def band(table, v):
    for lim, lv in table:
        if v <= lim:
            return lv


def pickup(pt):
    raw = parse(pt)
    if len(raw) < 10:
        return None
    cum = [0.0]
    for i in range(1, len(raw)):
        cum.append(cum[-1] + hav(raw[i - 1], raw[i]))
    total = cum[-1]
    if total < 500:
        return None
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

    # 山顶：取所有局部最高点，排序后按「与相邻山顶之间的鞍部高差」过滤
    cand = sorted([k for k in range(1, n - 1) if sm[k] >= sm[k - 1] and sm[k] > sm[k + 1]],
                  key=lambda p: -sm[p])
    top = []
    for p in cand:
        if not any(abs(xs[q] - xs[p]) < MIN_GAP_KM for q in top):
            top.append(p)
    top.sort()
    peaks = []
    for i, p in enumerate(top):
        lo_i = top[i - 1] if i > 0 else 0
        hi_i = top[i + 1] if i + 1 < len(top) else n - 1
        rel = sm[p] - min(sm[lo_i:hi_i + 1])
        if rel >= MIN_REL:
            peaks.append({"km": round(xs[p], 2), "ele": round(sm[p]), "rel": round(rel)})
    peak_idx = {round(xs[p], 2): p for p in top}

    # 分段：以山顶为切点，段难度 = max(爬升档, 距离档, 坡度档)
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
        # 爬升档取下坡的绝对值——"下坡就是反向的爬坡"，否则 -768 m 的下降会被算成没爬升
        lv = REV[max(ORD[band(BAND_GRAD, abs(pct))], ORD[band(BAND_GAIN, abs(de))])]
        segs.append({"no": len(segs) + 1, "from": round(xs[i0], 2), "to": round(xs[i1], 2),
                     "km": round(km, 2), "rise": round(de), "pct": round(pct), "level": lv,
                     "kind": "climb" if pct > 3 else ("desc" if pct < -3 else "flat"),
                     "a": i0, "b": i1})

    la = [p[0] for p in ll]
    lo = [p[1] for p in ll]
    mnx, mxx, mny, mxy = min(lo), max(lo), min(la), max(la)
    dx, dy = (mxx - mnx) or 1, (mxy - mny) or 1
    s = max(dx, dy)
    ox, oy = (s - dx) / 2, (s - dy) / 2
    path = [[round(((lo[i] - mnx) + ox) / s, 5), round(1 - ((la[i] - mny) + oy) / s, 5)]
            for i in range(n)]
    prof = [round((e - min(ys)) / ((max(ys) - min(ys)) or 1), 4) for e in ys]

    # 线路难度不再整体分级。只标"最难的那一段"，另给完成时间与消耗估算。
    hardest = max(segs, key=lambda s: ORD[s["level"]]) if segs else None
    eq_km = total / 1000 + up * CLIMB_FACTOR / 1000     # 等效距离
    hours = eq_km / FLAT_KMH
    kcal = MET * HIKER_WEIGHT_KG * hours
    return {"slug": pt.stem, "name": (re.search(r"<name>([^<]+)</name>", pt.read_text(
        encoding="utf-8", errors="ignore")) or [None, pt.stem])[1],
        "km": round(total / 1000, 1), "up": round(up), "down": round(dn),
        "hardest": {"level": hardest["level"], "no": hardest["no"],
                    "from": hardest["from"], "to": hardest["to"], "pct": hardest["pct"],
                    "rise": hardest["rise"]} if hardest else None,
        "hours": round(hours, 1), "kcal": round(kcal / 50) * 50,
        "est": {"flatKmh": FLAT_KMH, "climbFactor": CLIMB_FACTOR,
                "weightKg": HIKER_WEIGHT_KG, "met": MET},
        "peaks": peaks, "segments": segs, "path": path, "profile": prof,
        "points": len(raw), "resampled": n}


def main():
    files = sorted(SRC.glob("*.gpx"))
    if not files:
        sys.exit(f"tracks/ 里没有 gpx")
    out, fail = {}, []
    for f in files:
        try:
            r = pickup(f)
            if r:
                out[r["slug"]] = r
            else:
                fail.append((f.stem, "点太少或距离过短"))
        except Exception as ex:                       # noqa: BLE001
            fail.append((f.stem, f"{type(ex).__name__}: {ex}"))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "routes.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")

    print(f"{'线路':<14}{'km':>6}{'爬升':>7}{'下降':>7}{'顶':>4}{'段':>4}"
          f"{'用时':>7}{'kcal':>7}  最难段")
    print("-" * 74)
    for r in out.values():
        h = r["hardest"]
        print(f"{r['slug']:<14}{r['km']:>6}{r['up']:>7}{r['down']:>7}"
              f"{len(r['peaks']):>4}{len(r['segments']):>4}"
              f"{r['hours']:>6.1f}h{r['kcal']:>7}  {h['level']} ({h['pct']:+d}%)")
        print(f"            {r['name'][:30]}")
    if fail:
        print("\n跳过：")
        for s, why in fail:
            print(f"  {s}: {why}")
    print(f"\n✓ {len(out)} 条写入 {OUT/'routes.json'}（{sum(r['points'] for r in out.values())} 个原始轨迹点）")


if __name__ == "__main__":
    main()
