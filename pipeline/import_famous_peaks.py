"""把世界名山导成**未认领山头**：世界前 10 高峰 / 七大洲最高峰 / 中国名山大川。

数据来源：中文维基（拿 Wikidata QID）→ Wikidata 实体接口（P625 坐标 + P2044 海拔）。
不走 SPARQL——那个端点现在限到 1 次/分钟。

这些山头**不属于任何线路**，所以进 `points` 时 route_id 为空、maintainer_id 为空
（= 未认领）。它们会出现在山头榜里，谁认领谁拿二维码。

    docker compose exec api python /srv/pipeline/import_famous_peaks.py
    docker compose exec api python /srv/pipeline/import_famous_peaks.py --dry
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

UA = {"User-Agent": "hikes-famous-peaks/0.1 (local research; dev@localhost)"}

# 分类 → [(维基条目名, 别名/显示名, 国家或地区)]
GROUPS = {
    "W10": ("世界前 10 高峰", [
        ("珠穆朗玛峰", "珠穆朗玛峰", "中国 / 尼泊尔"), ("乔戈里峰", "乔戈里峰", "中国 / 巴基斯坦"),
        ("干城章嘉峰", "干城章嘉峰", "尼泊尔 / 印度"), ("洛子峰", "洛子峰", "中国 / 尼泊尔"),
        ("马卡鲁峰", "马卡鲁峰", "中国 / 尼泊尔"), ("卓奥友峰", "卓奥友峰", "中国 / 尼泊尔"),
        ("道拉吉里峰", "道拉吉里峰", "尼泊尔"), ("马纳斯卢峰", "马纳斯卢峰", "尼泊尔"),
        ("南迦帕尔巴特峰", "南迦帕尔巴特峰", "巴基斯坦"),
        ("安纳布尔纳峰", "安纳布尔纳峰", "尼泊尔"),
    ]),
    "7S": ("七大洲最高峰", [
        ("珠穆朗玛峰", "珠穆朗玛峰", "亚洲"), ("阿空加瓜山", "阿空加瓜山", "南美洲"),
        ("迪纳利山", "迪纳利山", "北美洲"), ("乞力马扎罗山", "乞力马扎罗山", "非洲"),
        ("厄尔布鲁士山", "厄尔布鲁士山", "欧洲"), ("文森山", "文森山", "南极洲"),
        ("查亚峰", "查亚峰", "大洋洲"),
    ]),
    "CN": ("中国名山大川", [
        ("泰山", "泰山", "山东 泰安"), ("华山", "华山", "陕西 渭南"),
        ("衡山", "衡山", "湖南 衡阳"), ("恒山", "恒山", "山西 大同"),
        ("嵩山", "嵩山", "河南 登封"), ("黄山", "黄山", "安徽 黄山"),
        ("庐山", "庐山", "江西 九江"), ("峨眉山", "峨眉山", "四川 乐山"),
        ("武当山", "武当山", "湖北 十堰"), ("武夷山", "武夷山", "福建 南平"),
        ("长白山", "长白山", "吉林 延边"), ("玉龙雪山", "玉龙雪山", "云南 丽江"),
        ("四姑娘山", "四姑娘山", "四川 阿坝"), ("贡嘎山", "贡嘎山", "四川 甘孜"),
        ("梅里雪山", "梅里雪山", "云南 迪庆"), ("冈仁波齐峰", "冈仁波齐峰", "西藏 阿里"),
        ("五台山", "五台山", "山西 忻州"), ("九华山", "九华山", "安徽 池州"),
        ("普陀山", "普陀山", "浙江 舟山"), ("雁荡山", "雁荡山", "浙江 温州"),
        ("三清山", "三清山", "江西 上饶"), ("青城山", "青城山", "四川 都江堰"),
        ("天柱山", "天柱山", "安徽 安庆"), ("崂山", "崂山", "山东 青岛"),
    ]),
    # 各国名山大川（中国除外）。挑的是"这个国家的人一提就知道"的那座山，
    # 不是按海拔榜排——富士山才 3776 m，但它的知名度比很多 6000 m 的高。
    "WM": ("各国名山大川（中国除外）", [
        ("富士山", "富士山", "日本"),
        ("汉拿山", "汉拿山", "韩国"),
        ("京那巴鲁山", "京那巴鲁山", "马来西亚"),
        ("阿波火山", "阿波山", "菲律宾"),
        ("番西邦峰", "番西邦峰", "越南"),
        ("因他暖山", "因他暖山", "泰国"),
        ("林贾尼火山", "林贾尼火山", "印度尼西亚"),
        ("达马万德山", "达马万德山", "伊朗"),
        ("阿勒山", "阿勒山", "土耳其"),
        ("勃朗峰", "勃朗峰", "法国 / 意大利"),
        ("马特洪峰", "马特洪峰", "瑞士 / 意大利"),
        ("少女峰", "少女峰", "瑞士"),
        ("楚格峰", "楚格峰", "德国"),
        ("大格洛克纳山", "大格洛克纳山", "奥地利"),
        ("本尼维斯山", "本尼维斯山", "英国"),
        ("奥林匹斯山", "奥林匹斯山", "希腊"),
        ("埃特纳火山", "埃特纳火山", "意大利"),
        ("泰德峰", "泰德峰", "西班牙"),
        ("加尔赫峰", "加尔赫峰", "挪威"),
        ("肯尼亚山", "肯尼亚山", "肯尼亚"),
        ("图卜卡勒山", "图卜卡勒山", "摩洛哥"),
        ("拉斯达申山", "拉斯达申山", "埃塞俄比亚"),
        ("西奈山", "西奈山", "埃及"),
        ("雷尼尔山", "雷尼尔山", "美国"),
        ("惠特尼山", "惠特尼山", "美国"),
        ("罗布森山", "罗布森山", "加拿大"),
        ("奥里萨巴山", "奥里萨巴山", "墨西哥"),
        ("钦博拉索山", "钦博拉索山", "厄瓜多尔"),
        ("瓦斯卡兰山", "瓦斯卡兰山", "秘鲁"),
        ("伊宜马尼峰", "伊宜马尼峰", "玻利维亚"),
        ("库克山", "库克山", "新西兰"),
        ("科修斯科山", "科修斯科山", "澳大利亚"),
    ]),
}


def get(url, tries=4):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=45))
        except urllib.error.HTTPError as ex:
            # 429 是"被限流"，不是"没这条数据"。按普通错误退避的话，
            # 4 次重试十几秒就烧完了，回来还是空——整批山头会一起丢掉。
            # 限流就等得久一点，让重试花在真正值得重试的地方。
            time.sleep(25 + i * 25 if ex.code == 429 else 2 + i * 2)
        except Exception:
            time.sleep(2 + i * 2)
    return {}


def resolve(titles):
    """条目名 → Wikidata QID（走 redirects，别漏重定向）"""
    q = urllib.parse.urlencode({"action": "query", "format": "json",
                                "titles": "|".join(titles), "prop": "pageprops",
                                "ppprop": "wikibase_item", "redirects": 1})
    d = get("https://zh.wikipedia.org/w/api.php?" + q)
    norm = {}
    for r in (d.get("query") or {}).get("redirects", []):
        norm[r["to"]] = r["from"]
    out = {}
    for _pid, pg in ((d.get("query") or {}).get("pages") or {}).items():
        qid = (pg.get("pageprops") or {}).get("wikibase_item")
        title = pg.get("title")
        if qid:
            out[norm.get(title, title)] = qid
    return out


def facts(qids):
    """P625 坐标 + P2044 海拔。

    分批要小（8 条）：一次要 20 多条，有些条目 claims 巨大，读回来会断，
    整批就全丢了——表现是"所有条目都没数据"，很容易误判成数据源不行。"""
    out = {}
    ids = list(qids)
    for i in range(0, len(ids), 8):
        batch = ids[i:i + 8]
        got = {}
        for chunk in (batch, [[q] for q in batch]):   # 整批失败就一条一条来
            left = [q for q in batch if q not in out]
            if not left:
                break
            chunks = [left] if isinstance(chunk, list) and len(chunk) == len(left) else chunk
            for sub in chunks:
                q = urllib.parse.urlencode({"action": "wbgetentities", "format": "json",
                                            "ids": "|".join(sub), "props": "claims"})
                for qid, ent in ((get("https://www.wikidata.org/w/api.php?" + q)) or {}).get(
                        "entities", {}).items():
                    cl = ent.get("claims", {})

                    def first(p):
                        try:
                            return cl[p][0]["mainsnak"]["datavalue"]["value"]
                        except Exception:
                            return None
                    coord, ele = first("P625"), first("P2044")
                    if isinstance(ele, dict):
                        amt = ele.get("amount")
                        ele = round(float(amt)) if amt else None
                    if coord:
                        out[qid] = (coord["latitude"], coord["longitude"], ele)
                time.sleep(0.6)
        time.sleep(0.8)
    return out


def resolve_loose(title):
    """直接查不到条目名就搜一次——中文维基的命名和我们的叫法常差一个字
    （汉拿山 / 汉拏山、库克山 / 奥拉基库克山）。"""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "list": "search",
                                "srsearch": title, "srlimit": 3, "srnamespace": 0})
    d = get("https://zh.wikipedia.org/w/api.php?" + q)
    hits = [x["title"] for x in ((d.get("query") or {}).get("search") or [])]
    return hits


# ---------- 兜底链：一个源拿不到就换下一个，别死磕 ----------
def wiki_coords(lang, title):
    """维基条目的坐标。中文维基没有就换英文维基——两个库的覆盖不一样。"""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": title,
                                "prop": "coordinates", "redirects": 1})
    d = get(f"https://{lang}.wikipedia.org/w/api.php?" + q)
    for _p, pg in ((d.get("query") or {}).get("pages") or {}).items():
        c = pg.get("coordinates") or []
        if c:
            return (c[0]["lat"], c[0]["lon"])
    return None


def wiki_ele(lang, title):
    """条目正文里抓"海拔 xxxx 米"。infobox 抓不到，正文第一段通常写着。"""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": title,
                                "prop": "extracts", "exintro": 1, "explaintext": 1,
                                "redirects": 1})
    d = get(f"https://{lang}.wikipedia.org/w/api.php?" + q)
    for _p, pg in ((d.get("query") or {}).get("pages") or {}).items():
        t = pg.get("extract") or ""
        m = (re.search(r"海拔[^\d]{0,8}([\d,]{3,6})\s*米", t)
             or re.search(r"([\d,]{3,6})\s*米(?:高|的海拔)", t))
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return None


def osm_locate(name, region=None):
    """OSM 兜底：它是地图库，山、火山、观景点都带坐标，很多还带 ele 标签。

    **必须校验地区**：中文译名在 OSM 里会撞到别的地方——搜「拉斯达申山」
    返回的是西藏一座山。对不上国家就丢掉，宁可不录，不能录错。
    """
    q = urllib.parse.urlencode({"q": name, "format": "jsonv2", "limit": 5,
                                "accept-language": "zh", "extratags": 1,
                                "addressdetails": 1})
    for h in (get("https://nominatim.openstreetmap.org/search?" + q) or []):
        if h.get("type") not in ("peak", "volcano", "hill", "viewpoint", "attraction",
                                 "mountain_range", "yes", "ridge", "saddle"):
            continue
        if region:
            addr = h.get("address") or {}
            land = " ".join(str(addr.get(k, "")) for k in
                            ("country", "state", "county", "city", "town", "village"))
            # 地区串里任一段（按 / 拆开）出现在地址里才算对得上
            parts = [x.strip() for x in re.split(r"[/／]", region) if x.strip()]
            if parts and not any(p in land or p in (h.get("display_name") or "")
                                 for p in parts):
                continue
        ele = None
        raw = (h.get("extratags") or {}).get("ele")
        if raw:
            try:
                ele = round(float(str(raw).replace("m", "").strip()))
            except ValueError:
                pass
        return (float(h["lat"]), float(h["lon"]), ele)
    return None


def locate(title, name, region=None):
    """一个山头：先把三个源依次问一遍，谁给坐标听谁的。"""
    zh = title
    tid = None
    hit = resolve([zh])
    if hit:
        tid = list(hit.values())[0]
        got = facts([tid]).get(tid)
        if got:
            return got + ("wikidata",)
    c = wiki_coords("zh", zh)
    if c:
        return (c[0], c[1], wiki_ele("zh", zh)) + ("zh.wikipedia",)
    # 中文维基没有就搜英文维基：查亚峰 = Puncak Jaya、奥里萨巴山 = Pico de Orizaba，
    # 这些条目中文维基要么没有、要么没填坐标，英文维基一定有
    for t in ([name] + resolve_loose(name)):
        c = wiki_coords("en", t)
        if c:
            return (c[0], c[1], wiki_ele("en", t)) + ("en.wikipedia",)
        c = wiki_coords("zh", t)
        if c:
            return (c[0], c[1], wiki_ele("zh", t)) + ("zh.wikipedia",)
    o = osm_locate(name, region)
    if o:
        return o + ("openstreetmap",)
    return None


def main():
    dry = "--dry" in sys.argv
    with engine.begin() as c:
        for prefix, (label, items) in GROUPS.items():
            titles = list({t for t, _n, _r in items})
            qids = resolve(titles)
            if len(qids) < len(titles) / 2:       # 整批失败就再来一次
                time.sleep(3)
                qids = resolve(titles)
            # 还没对上的：搜一次再解析，别因为差一个字就整座山头丢了
            for t in [x for x in titles if x not in qids]:
                for cand in resolve_loose(t):
                    hit = resolve([cand])
                    if hit:
                        qids[t] = list(hit.values())[0]
                        break
                time.sleep(0.4)
            f = facts(qids.values())
            print(f"  [{label}] 条目 {len(titles)} → QID {len(qids)} → 坐标/海拔 {len(f)}")
            ok = 0
            # 编号按**声明顺序**，不按拼音——W10-01 就该是珠峰，不该是南迦帕尔巴特
            for i, (title, name, region) in enumerate(items, 1):
                qid = qids.get(title)
                got = f.get(qid) if qid else None
                src = "wikidata"
                if not got:
                    # 换源：中文维基 → 英文维基 → OSM。别因为一个库没有就把这座山丢了
                    alt = locate(title, name, region)
                    if not alt:
                        print(f"  · {name:12s} 三个源都没有，跳过")
                        continue
                    lat, lng, ele, src = alt
                    if ele is None:
                        print(f"  · {name:12s} 有坐标没海拔（{src}），先按 0 存")
                        ele = 0
                    print(f"  ↻ {name:12s} 换源命中：{src}")
                else:
                    lat, lng, ele = got
                code = f"{prefix}-{i:02d}"
                print(f"  ✓ {code} {name:12s} {region:14s} {ele} m  {lat:.4f},{lng:.4f}")
                if dry:
                    ok += 1
                    continue
                # 不属于任何线路 → route_id 为空；没有维护人 → 未认领
                c.execute(text("""INSERT INTO points
                    (code, type, name, level, altitude, geom, status)
                    VALUES (:code, 'peak', :name, 'hard', :alt,
                            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 'published')
                    ON CONFLICT (code) DO UPDATE SET
                        name = EXCLUDED.name, altitude = EXCLUDED.altitude,
                        geom = EXCLUDED.geom"""),
                    {"code": code, "name": f"{name}（{region}）" if prefix != "CN" else name,
                     "alt": ele, "lat": lat, "lng": lng})
                pid = c.execute(text("SELECT id FROM points WHERE code = :c"),
                                {"c": code}).scalar()
                c.execute(text("""INSERT INTO short_links (code, point_id) VALUES (:c, :p)
                                  ON CONFLICT (code) DO NOTHING"""), {"c": code, "p": pid})
                ok += 1
            print(f"—— {label}：导入 {ok} 座\n")


if __name__ == "__main__":
    main()
