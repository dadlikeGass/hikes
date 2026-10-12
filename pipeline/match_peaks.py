"""用坐标匹配 Wikidata，给 GPX 自动识别的山顶找真名。

思路：GPX 算出的山顶有经纬度，Wikidata 上带坐标的山峰也有经纬度——
取最近的一个，距离小于阈值就认为是同一座山。模糊匹配即可，
**匹配结果只作候选，最终由维护人确认**（写进 peaks[].name，并标记来源）。

用法：python3 pipeline/match_peaks.py
输出：pipeline/out/peak_names.json，并把 name 回填进 routes.json
"""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "pipeline" / "out"
ROUTES = OUT / "routes.json"
CACHE = OUT / "wikidata_peaks.json"

# 北京及周边
BBOX = (39.6, 115.2, 41.2, 117.2)          # s, w, n, e
MAX_KM = 1.5                                 # 超过这个距离不算匹配

# 只要像山的名；排除行政区、车站、场馆这类
GOOD_TAIL = ("山", "峰", "岭", "顶", "尖", "坨", "台", "崖", "梁", "坡")
BAD_TAIL = ("区", "县", "乡", "镇", "村", "站", "馆", "园", "路", "街", "寺",
            "库", "场", "园", "线", "湖", "河", "桥", "门", "城", "寺", "庙",
            "沟", "庄", "营", "店")

QUERY = """SELECT ?item ?itemLabel ?coord WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(%(w)s %(s)s)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(%(e)s %(n)s)"^^geo:wktLiteral .
  }
  ?item rdfs:label ?itemLabel .
  FILTER(lang(?itemLabel) = "zh")
  FILTER(CONTAINS(?itemLabel,"山") || CONTAINS(?itemLabel,"峰") ||
         CONTAINS(?itemLabel,"岭") || CONTAINS(?itemLabel,"顶"))
}""" % {"s": BBOX[0], "w": BBOX[1], "n": BBOX[2], "e": BBOX[3]}


def hav(a, b, c, d):
    R = 6371.0
    r = math.pi / 180
    dlat, dlng = (c - a) * r, (d - b) * r
    x = math.sin(dlat / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def fetch():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": QUERY})
    req = urllib.request.Request(url, headers={
        "Accept": "application/sparql-results+json",
        "User-Agent": "hikes-prototype/0.1 (peak name matching)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    cands = []
    for b in data["results"]["bindings"]:
        name = b["itemLabel"]["value"]
        if any(name.endswith(t) for t in BAD_TAIL):
            continue
        if not any(t in name for t in GOOD_TAIL):
            continue
        lon, lat = b["coord"]["value"].replace("Point(", "").replace(")", "").split()
        cands.append({"name": name, "lat": float(lat), "lng": float(lon),
                      "qid": b["item"]["value"].rsplit("/", 1)[-1]})
    CACHE.write_text(json.dumps(cands, ensure_ascii=False, indent=0), encoding="utf-8")
    return cands


def main():
    cands = fetch()
    routes = json.loads(ROUTES.read_text(encoding="utf-8"))
    hits, miss = [], []
    # 一对一的全局匹配：按距离从近到远配对，配过的两边都不再用。
    # 否则好几个山顶会同时匹配到同一个"阳台山"。
    allp = [(slug, p) for slug, r in routes.items() for p in r["peaks"]]
    for slug, p in allp:
        p["name"], p["nameSrc"], p["nameDistKm"] = None, None, None
    pairs = []
    for i, (slug, p) in enumerate(allp):
        for j, c in enumerate(cands):
            d = hav(p["lat"], p["lng"], c["lat"], c["lng"])
            if d <= MAX_KM:
                pairs.append((d, i, j))
    # 软匹配：候选被用过之后距离按 1.6 倍惩罚，仍可复用但排到后面。
    # 环线会正反两次经过同一座山（白八拉反复过阳台山），硬性一对一反而错。
    usedC = set()
    scored = sorted(((d * (1.0 if j not in usedC else 1.6), d, i, j) for d, i, j in pairs))
    assigned = set()
    for _, d, i, j in scored:
        if i in assigned:
            continue
        assigned.add(i); usedC.add(j)
        slug, p = allp[i]
        p["name"] = cands[j]["name"]              # 候选，待维护人确认
        p["nameSrc"] = "wikidata:" + cands[j]["qid"]
        p["nameDistKm"] = round(d, 2)
        hits.append((routes[slug]["name"], p["ele"], cands[j]["name"], round(d, 2)))
    for i, (slug, p) in enumerate(allp):
        if i not in assigned:
            near = min((hav(p["lat"], p["lng"], c["lat"], c["lng"]) for c in cands), default=None)
            miss.append((routes[slug]["name"], p["ele"], round(near, 1) if near else None))
    ROUTES.write_text(json.dumps(routes, ensure_ascii=False), encoding="utf-8")

    print(f"候选山名 {len(cands)} 条 → 匹配上 {len(hits)} / {len(hits)+len(miss)} 个山顶\n")
    print(f"{'线路':<14}{'海拔':>6}  {'匹配到的山名':<14}{'距离'}")
    print("-" * 48)
    for a, e, n, d in sorted(hits, key=lambda x: -x[1])[:25]:
        print(f"{a[:12]:<14}{e:>6}  {n:<14}{d} km")
    if miss:
        print(f"\n没匹配上 {len(miss)} 个（最近的在 {min(m[2] for m in miss if m[2])} km 外）")


if __name__ == "__main__":
    main()
