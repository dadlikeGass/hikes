"""给山顶找名字 · 第二版：按名字去 OSM 查坐标，再和我们的顶对距离。

第一版（维基坐标检索，见 match_peaks_web.py）只对了 2 个——维基里北京这些野山头
几乎没有条目。OSM 好得多：它是个地图库，山、垭口、古建都带坐标，中文名也全。

为什么不用百度百科：服务器直连返回 403（反爬），而且**它没有坐标接口**。
百度百科只能在"已经知道一个名字"之后，人工去核对这个名字对不对，做不了坐标匹配。
网页搜索（Bing / DuckDuckGo 能通）用来补名字，坐标还是得回到 OSM / 维基。

判定：候选点离某个顶 ≤ MATCH_M 就采用。**同一个名字只允许给相距 100 m 以内的顶**
——两条线路翻过同一个顶，两边都该叫这个名字；但一个景区名不能套在四个不同的顶上。

    python3 pipeline/match_peaks_osm.py            # 只出报告
    python3 pipeline/match_peaks_osm.py --apply    # 写入待审候选，不覆盖正式名称
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, "/srv")
for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

MATCH_M = 400          # 候选点到顶的距离上限
SAME_POINT_M = 100     # 两个顶离这么近，算是同一个山顶，可以同名
UA = {"User-Agent": "hikes-peak-naming/0.1 (local research; contact: dev@localhost)"}
VIEW = "115.40,40.75,116.75,39.75"      # 北京及周边

# 北京驴友口口相传的峰名 / 垭口 / 地标。名字先列全，坐标让 OSM 给。
NAMES = ["鹫峰", "阳台山", "妙峰山", "萝卜地", "北尖", "香山", "香炉峰", "鬼见愁",
         "虎头山", "翠微顶", "八大处", "宝珠洞", "慈善寺", "打鹰洼", "望京石",
         "北京结", "鹰飞倒仰", "九眼楼", "箭扣长城", "凤凰岭", "玉渡山", "后河",
         "应梦寺", "白瀑寺", "峰口庵", "马蹄窝", "东灵山", "百花山", "上方山",
         "天泰山", "大觉寺", "妙儿洼", "大风口", "白虎涧", "樱桃沟", "玉皇顶",
         "三炷香", "龙泉寺", "飞来石", "上方寺"]


def m(a, b, c, d):
    """两点距离（米），够用"""
    import math
    R, r = 6371000.0, math.pi / 180
    dlat, dlng = (c - a) * r, (d - b) * r
    x = (math.sin(dlat / 2) ** 2 +
         math.cos(a * r) * math.cos(c * r) * math.sin(dlng / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(x))


def osm_search(name, tries=5):
    q = urllib.parse.urlencode({"q": name, "format": "jsonv2", "limit": 5,
                                "accept-language": "zh", "viewbox": VIEW, "bounded": 1})
    url = "https://nominatim.openstreetmap.org/search?" + q
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=25))
        except Exception:
            time.sleep(2 + i)
    return []


def main():
    apply = "--apply" in sys.argv
    with engine.begin() as c:
        peaks = [dict(r) for r in c.execute(text("""
            SELECT rp.id, r.slug, rp.idx, rp.altitude, rp.lat, rp.lng
            FROM route_peaks rp JOIN routes r ON r.id = rp.route_id
            WHERE rp.lat IS NOT NULL ORDER BY r.slug, rp.idx""")).mappings().all()]

        cands = []
        for n in NAMES:
            for h in osm_search(n):
                # OSM 的名字常带附属词：「阳台山/妙高峰」「妙儿洼茶棚」。
                # 卡片上要的是驴友叫的那个名字，切掉斜杠后半段和建筑后缀。
                raw = (h.get("name") or n).split("/")[0].strip()
                for suf in ("茶棚", "小卖部", "停车场", "商店", "驿站", "休息平台"):
                    if raw.endswith(suf) and len(raw) > len(suf):
                        raw = raw[:-len(suf)]
                cands.append({"name": raw, "query": n,
                              "type": h.get("type"), "lat": float(h["lat"]), "lon": float(h["lon"])})
            time.sleep(1.1)
        print(f"OSM 给了 {len(cands)} 个带坐标的候选\n")

        # 每个候选找最近的顶
        hits = []
        for cd in cands:
            best, bd = None, 1e9
            for p in peaks:
                d = m(float(p["lat"]), float(p["lng"]), cd["lat"], cd["lon"])
                if d < bd:
                    best, bd = p, d
            if bd <= MATCH_M:
                hits.append((best, bd, cd))
        # 近的优先占名字
        hits.sort(key=lambda x: x[1])
        taken = []
        named_peak = set()      # 一个顶只要最近的那个名字，别一个顶挂两个名
        used = {}
        for p, d, cd in hits:
            if p["id"] in named_peak:
                print(f"  ✗ {p['slug']}#{p['idx']} 已经用更近的「{p['_name']}」，"
                      f"忽略「{cd['name']}」({int(d)} m)")
                continue
            if cd["name"] in used:
                q = used[cd["name"]]
                if m(float(p["lat"]), float(p["lng"]), q[0], q[1]) > SAME_POINT_M:
                    print(f"  ✗ {p['slug']}#{p['idx']} 离「{cd['name']}」{int(d)} m，"
                          f"但那个名字已经给了别处的顶 → 留空")
                    continue
            used[cd["name"]] = (cd["lat"], cd["lon"])
            named_peak.add(p["id"])
            p["_name"] = cd["name"]
            taken.append((p, cd, d))

        for p, cd, d in sorted(taken, key=lambda x: (x[0]["slug"], x[0]["idx"])):
            print(f"  ✓ {p['slug']}#{p['idx']:>2} ({p['altitude']} m) → {cd['name']}"
                  f"   [{cd['query']} · {cd['type']} · {int(d)} m]")
        print(f"\n{len(taken)} / {len(peaks)} 个顶拿到名字")

        if not apply:
            print("（只出报告，加 --apply 写库）")
            return
        for p, cd, d in taken:
            c.execute(text("""INSERT INTO route_peak_candidates
                (route_peak_id, source, source_url, candidate_name, candidate_lat,
                 candidate_lng, distance_m, evidence)
                VALUES (:pid, 'openstreetmap-nominatim', :url, :name, :lat, :lng, :dist,
                        CAST(:evidence AS jsonb))
                ON CONFLICT (route_peak_id, source, candidate_name) DO UPDATE SET
                  distance_m = EXCLUDED.distance_m, evidence = EXCLUDED.evidence,
                  status = CASE WHEN route_peak_candidates.status = 'pending'
                                THEN 'pending' ELSE route_peak_candidates.status END"""),
                {"pid": p["id"], "url": "https://www.openstreetmap.org/",
                 "name": cd["name"], "lat": cd["lat"], "lng": cd["lon"], "dist": round(d),
                 "evidence": json.dumps({"query": cd["query"], "type": cd["type"],
                                         "distanceM": round(d)}, ensure_ascii=False)})
        print(f"✓ 写入 {len(taken)} 条待审候选；正式山名保持不变")


if __name__ == "__main__":
    main()
