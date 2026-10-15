"""给 GPX 识别出来的山顶找真名 —— 用坐标去公开数据源里对。

为什么不用 Wikidata：北京这些山头在上面几乎没有条目，`match_peaks.py` 跑了 0 个匹配。
换成中文维基的 geosearch（按坐标找附近条目），批量跑下来只对了 4 个。
**百度百科没有坐标接口、服务器直连也返回 403**（反爬），没法拿来做坐标匹配——
它只能在已经知道名字之后，人工去核对那个名字对不对。

结论：公开数据源里，**能确认名字的只有少数有名的山头**。剩下的是"野山头"，
北京驴友口口相传的名字（萝卜地北尖、打鹰洼、望京石…）在任何公开库里都查不到。
所以「名称待定」不是没做完，而是必经状态——真名只能靠维护人实地命名。

判定规则（宁可留空，不许猜）：
  ① 距离 ≤ NAME_RADIUS_M，且条目名像山名  → 采用
  ② 距离 ≤ NEAR_RADIUS_M，且**线路名里含这个山名**，且它是**这条线路最高的那个顶**
     → 采用（"东灵山主峰"的那个顶就叫东灵山）
  ③ **同一个名字只能给一个顶**（最近的那个）
     —— 凤凰岭环穿的四个顶都会被"凤凰岭"命中，但四个顶不可能都叫凤凰岭
  ④ 其余一律不写，留空显示「名称待定」

    python3 pipeline/match_peaks_web.py            # 只看报告，不写库
    python3 pipeline/match_peaks_web.py --apply    # 写入待审候选，不覆盖正式名称
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, "/srv")
from sqlalchemy import text  # noqa: E402

for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402

NAME_RADIUS_M = 500     # 这么近，基本就是它
NEAR_RADIUS_M = 2000    # 线路名里含这个名字时放宽到这个距离
SEARCH_RADIUS_M = 3000
SLEEP = 1.3             # 维基要求别打太快，否则 429
UA = {"User-Agent": "hikes-peak-naming/0.1 (local research; contact: dev@localhost)"}

MOUNTAINISH = re.compile(r"(山|峰|岭|顶|坨|尖|结|楼|崖|关|坡|梁|台|沟|峪|寺|村)$")
SKIP = ("车站", "站", "公园", "别墅", "广场", "大学", "陈列馆", "墓", "档案")


def wiki_near(lat, lng, tries=4):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "list": "geosearch",
                                "gscoord": f"{lat}|{lng}", "gsradius": SEARCH_RADIUS_M,
                                "gslimit": 8, "gsnamespace": 0})
    url = "https://zh.wikipedia.org/w/api.php?" + q
    for i in range(tries):
        try:
            d = json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30))
            return d.get("query", {}).get("geosearch", [])
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(3 * (i + 1))
                continue
            return []
        except Exception:
            time.sleep(2 * (i + 1))
    return []


def looks_like_peak(title):
    return bool(MOUNTAINISH.search(title)) and not any(s in title for s in SKIP)


def main():
    apply = "--apply" in sys.argv
    with engine.begin() as c:
        rows = c.execute(text("""SELECT rp.id, r.slug, r.name AS route_name, rp.idx,
                                        rp.altitude, rp.lat, rp.lng, rp.name
                                 FROM route_peaks rp JOIN routes r ON r.id = rp.route_id
                                 WHERE rp.lat IS NOT NULL
                                 ORDER BY r.slug, rp.idx""")).mappings().all()
        top_of_route = {}
        for r in rows:
            k = r["slug"]
            if k not in top_of_route or r["altitude"] > top_of_route[k]["altitude"]:
                top_of_route[k] = r
        hits, misses = [], []
        for r in rows:
            near = wiki_near(float(r["lat"]), float(r["lng"]))
            best = None
            for h in near:
                d, t = round(h["dist"]), h["title"]
                if not looks_like_peak(t):
                    continue
                is_top = top_of_route[r["slug"]]["id"] == r["id"]
                if d <= NAME_RADIUS_M or (d <= NEAR_RADIUS_M and t in r["route_name"] and is_top):
                    best = (d, t)
                    break
            tag = f"{r['slug']}#{r['idx']} ({r['altitude']} m)"
            if best:
                hits.append((r, best))
                print(f"  ✓ {tag:34s} → {best[1]}  （{best[0]} m）")
            else:
                near_txt = ", ".join(f"{h['title']} {round(h['dist'])}m" for h in near[:2]) or "附近无条目"
                misses.append((r, near_txt))
                print(f"  · {tag:34s} → 留空（{near_txt}）")
            time.sleep(SLEEP)

        # 一个名字只留最近的那个顶，其余退回待定
        by_name = {}
        for r, (d, t) in hits:
            if t not in by_name or d < by_name[t][1]:
                by_name[t] = (r, d)
        keep = {id(v[0]) for v in by_name.values()}
        dropped = [(r, t) for r, (d, t) in hits if id(r) not in keep]
        hits = [(r, d) for r, d in hits if id(r) in keep]
        for r, t in dropped:
            print(f"  ✗ {r['slug']}#{r['idx']} 也命中「{t}」，但同一个名字只能给一个顶 → 退回待定")

        print(f"\n最终：{len(hits)} 个顶拿到名字，{len(misses) + len(dropped)} 个保持「名称待定」。")
        if not apply:
            print("（只看了报告。要写库加 --apply）")
            return
        for r, (d, name) in hits:
            c.execute(text("""INSERT INTO route_peak_candidates
                (route_peak_id, source, source_url, candidate_name, candidate_lat,
                 candidate_lng, distance_m, evidence)
                VALUES (:pid, 'wikipedia-geosearch', :url, :name, :lat, :lng, :dist,
                        CAST(:evidence AS jsonb))
                ON CONFLICT (route_peak_id, source, candidate_name) DO UPDATE SET
                  distance_m = EXCLUDED.distance_m, evidence = EXCLUDED.evidence,
                  status = CASE WHEN route_peak_candidates.status = 'pending'
                                THEN 'pending' ELSE route_peak_candidates.status END"""),
                {"pid": r["id"], "url": "https://zh.wikipedia.org/",
                 "name": name, "lat": r["lat"], "lng": r["lng"], "dist": d,
                 "evidence": json.dumps({"matchedTitle": name, "distanceM": d},
                                         ensure_ascii=False)})
        print(f"✓ 已写入 {len(hits)} 条待审候选；正式山名保持不变")


if __name__ == "__main__":
    main()
