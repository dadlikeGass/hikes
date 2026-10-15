"""补山头数据：用搜索引擎，不走 Wikidata。

之前的 import_famous_peaks.py 主要靠 Wikidata，被限流时整批山头会一起丢掉
（HTTP 429 + 重试退避太短）。这个脚本换成：

  海拔  ← Bing / 360 搜索结果里的"海拔 xxxx 米"，取不到再退回 DEM 高程
  坐标  ← OpenStreetMap 地名检索（校验是不是山峰），取不到再退回维基条目坐标

每个山头都会打印**每一项数据的来源**，方便人工复核；没有来源的数字不写库。

    docker compose exec api python /srv/pipeline/import_peaks_search.py --dry
    docker compose exec api python /srv/pipeline/import_peaks_search.py
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
for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}

# 还没进库的山头：(编号, 显示名, 地区, 中文检索词, 英文检索词 / OSM 检索词)
WANT = [
    ("7S-07", "查亚峰", "大洋洲", "查亚峰", "Puncak Jaya"),
    ("WM-07", "林贾尼火山", "印度尼西亚", "林贾尼火山", "Mount Rinjani"),
    ("WM-22", "拉斯达申山", "埃塞俄比亚", "拉斯达申山", "Ras Dashen"),
    ("WM-30", "伊宜马尼峰", "玻利维亚", "伊宜马尼峰", "Illimani"),
]


def fetch(url, tries=3, timeout=25):
    for i in range(tries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read().decode(
                    "utf-8", "ignore")
        except urllib.error.HTTPError as ex:
            if ex.code in (429, 503):        # 限流：等久一点，别把重试耗在限流上
                time.sleep(15 + i * 15)
            else:
                time.sleep(2 + i * 2)
        except Exception:
            time.sleep(2 + i * 2)
    return ""


def plain(html):
    t = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("&nbsp;", " ").replace("&#160;", " ")
    return re.sub(r"\s+", " ", t)


ELE_PAT = re.compile(r"(?:海拔|海拔高度|标高|elevation|高度)[^\d]{0,12}"
                     r"([\d][\d,\.]{2,9})\s*(?:米|m\b|metres|meters|meter)")


def ele_from_search(query, engine_name):
    """从搜索结果页的可见文字里找海拔。"""
    if engine_name == "bing":
        url = "https://www.bing.com/search?q=" + urllib.parse.quote(query)
    else:
        url = "https://www.so.com/s?q=" + urllib.parse.quote(query)
    txt = plain(fetch(url))
    for m in ELE_PAT.finditer(txt):
        v = float(m.group(1).replace(",", "").rstrip("."))
        if 0 < v < 9000:
            return v, f"{engine_name}: {txt[max(0, m.start()-24):m.end()+6].strip()[:70]}"
    return None, None


def coords_osm(name):
    """OSM 地名检索：要 natural/peak 或名字对得上，避免落到同名村镇。"""
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": name, "format": "json", "limit": 3, "extratags": 1})
    try:
        rows = json.loads(fetch(u))
    except Exception:
        rows = []
    for r in rows:
        cls, typ = r.get("class"), r.get("type")
        if cls == "natural" and typ in ("peak", "volcano", "ridge", "mountain_range"):
            ele = (r.get("extratags") or {}).get("ele")
            return (float(r["lat"]), float(r["lon"]),
                    float(str(ele).split()[0]) if ele else None,
                    f"osm:{r['display_name'][:46]}")
    return None


def coords_wiki(title):
    u = ("https://zh.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
         "&prop=coordinates&titles=" + urllib.parse.quote(title))
    try:
        d = json.loads(fetch(u))
    except Exception:
        return None
    for _p, pg in ((d.get("query") or {}).get("pages") or {}).items():
        c = pg.get("coordinates") or []
        if c:
            return (c[0]["lat"], c[0]["lon"], None, f"zh.wikipedia:{pg.get('title')}")
    return None


def dem_ele(lat, lng):
    u = f"https://api.opentopodata.org/v1/srtm90m?locations={lat:.5f},{lng:.5f}"
    try:
        d = json.loads(fetch(u))
        return d["results"][0]["elevation"], "dem:srtm90m"
    except Exception:
        return None, None


def main():
    dry = "--dry" in sys.argv
    for code, name, region, q_cn, q_en in WANT:
        print(f"\n=== {code} {name}（{region}）", flush=True)
        ele = src_e = None
        for q, eng in ((f"{q_cn} 海拔", "360"), (f"{q_en} elevation", "bing"),
                       (f"{q_cn} 海拔 米", "bing")):
            ele, src_e = ele_from_search(q, eng)
            time.sleep(1.2)
            if ele:
                break
        if ele:
            print(f"  ✓ 海拔 {ele:.0f} m  ← {src_e}", flush=True)
        else:
            print("  · 搜索没给出海拔", flush=True)

        loc = coords_osm(q_en) or coords_osm(q_cn) or coords_wiki(q_cn)
        if not loc:
            print("  ✗ 坐标没找到，跳过（宁可不写，也不写个假坐标）", flush=True)
            continue
        lat, lng, ele_osm, src_c = loc
        print(f"  ✓ 坐标 {lat:.4f},{lng:.4f}  ← {src_c}"
              + (f"（当地高程 {ele_osm:.0f} m）" if ele_osm else ""), flush=True)

        if not ele and ele_osm:
            ele, src_e = ele_osm, f"{src_c} 的 ele 标签"
            print(f"  ↻ 海拔改用 {ele:.0f} m  ← {src_e}", flush=True)
        if not ele:
            # DEM 只能当参考，不能写库：SRTM 90m 在高山上普遍偏低
            # （伊宜马尼峰实际 6438 m，SRTM 给 5844 m，差 600 米）。
            dem, _ = dem_ele(lat, lng)
            if dem:
                print(f"  · DEM 参考值 {dem:.0f} m（不写库，偏高偏低都不一定）", flush=True)
            print(f"  ✗ 海拔没有可信来源，跳过（坐标 {lat:.4f},{lng:.4f} 留给人工补）", flush=True)
            continue

        alt = round(ele)
        print(f"  → 入库 {code} {name}（{region}）{alt} m", flush=True)
        if dry:
            continue
        # 每个山头单独一个事务：外网一抖就重试好几轮，前面已经拿到的数据
        # 不该跟着最后一条一起回滚（上一版一次性提交，跑了十分钟一条都没落库）。
        with engine.begin() as c:
            c.execute(text("""INSERT INTO points
                (code, type, name, level, altitude, geom, status)
                VALUES (:code, 'peak', :name, 'hard', :alt,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 'published')
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name, altitude = EXCLUDED.altitude,
                    geom = EXCLUDED.geom"""),
                {"code": code, "name": f"{name}（{region}）", "alt": alt,
                 "lat": lat, "lng": lng})
            pid = c.execute(text("SELECT id FROM points WHERE code = :c"),
                            {"c": code}).scalar()
            c.execute(text("""INSERT INTO short_links (code, point_id) VALUES (:c, :p)
                              ON CONFLICT (code) DO NOTHING"""), {"c": code, "p": pid})
        time.sleep(1.0)


if __name__ == "__main__":
    main()
