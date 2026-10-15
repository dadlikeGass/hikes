"""给点位补 country / province / city（山头页「距离」筛选的数据源）。

两个来源，分别按各自的实际情况填：
  线路点位  ← routes.city / routes.race_place（"浙江 · 杭州 · 西湖区"、"河北·张家口"）
  名山点位  ← pipeline/import_famous_peaks.py 里 GROUPS 的地区字段
              （"山东 泰安" / "中国 / 尼泊尔" / "日本" / 七大洲用洲名）

取不到就留空，不猜。可重复执行（只更新这三列）。

    docker compose exec api python /srv/seeds/backfill_peak_regions.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, "/srv")
for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

# 省级行政区（含港澳台），用来判断地区串的第一个词是不是省级
PROVINCES = {
    "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南",
    "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏",
    "宁夏", "新疆", "香港", "澳门",
}
# 七大洲最高峰在 GROUPS 里只写了洲名，这里换成真正的国家
CONTINENT_COUNTRY = {
    "亚洲": "尼泊尔", "南美洲": "阿根廷", "北美洲": "美国", "非洲": "坦桑尼亚",
    "欧洲": "俄罗斯", "南极洲": "南极洲", "大洋洲": "印度尼西亚",
}


def split_region(region: str):
    """地区串 → (国家, 省, 市)。分不清的一律留空。"""
    region = (region or "").strip()
    if not region:
        return None, None, None
    if region in CONTINENT_COUNTRY:
        return CONTINENT_COUNTRY[region], None, None
    # "中国 / 尼泊尔" 这类跨国的：按海外算（珠峰你也不会当天往返）
    parts = [p.strip() for p in re.split(r"[/／]", region) if p.strip()]
    if len(parts) > 1:
        foreign = [p for p in parts if p != "中国"]
        return (foreign[0] if foreign else "中国"), None, None
    head = parts[0]
    if head == "中国":
        return "中国", None, None
    for p in PROVINCES:
        if head.startswith(p):
            rest = head[len(p):].strip()
            city = rest.split()[0] if rest else (p if p in ("北京", "上海", "天津", "重庆") else None)
            return "中国", p, city
    return head, None, None      # 只剩国名（日本、瑞士…）


def split_city(s):
    """线路的 city / race_place → (省, 市)。"""
    s = (s or "").strip()
    if not s:
        return None, None
    tokens = [t.strip() for t in re.split(r"[·,，、/／\s]+", s) if t.strip()]
    if not tokens:
        return None, None
    prov = next((t for t in tokens if t in PROVINCES), None)
    if not prov:
        return None, None
    city = next((t for t in tokens if t != prov and not t.endswith("区")), None)
    if prov in ("北京", "上海", "天津", "重庆"):
        city = prov                      # 直辖市：市 == 省，本市就是北京
    return prov, city


def main():
    # 名山：按 GROUPS 的声明顺序复原编号（和 import_famous_peaks.py 的规则一致）
    sys.path.insert(0, "/srv/pipeline")
    import import_famous_peaks as F  # noqa: E402
    famous = {}
    for prefix, (_label, items) in F.GROUPS.items():
        for i, (title, name, region) in enumerate(items, 1):
            famous[f"{prefix}-{i:02d}"] = (name, region)

    n_line = n_famous = 0
    with engine.begin() as c:
        rows = c.execute(text("""SELECT id, slug, city, race_place, kind FROM routes""")).mappings().all()
        for r in rows:
            src = r["race_place"] or r["city"]
            prov, city = split_city(src)
            res = c.execute(text("""UPDATE points
                SET country = '中国', province = :p, city = :c
                WHERE route_id = :id"""), {"p": prov, "c": city, "id": r["id"]})
            n_line += res.rowcount

        for code, (name, region) in famous.items():
            country, prov, city = split_region(region)
            if not country:
                continue
            res = c.execute(text("""UPDATE points
                SET country = :co, province = :p, city = :ci WHERE code = :code"""),
                {"co": country, "p": prov, "ci": city, "code": code})
            n_famous += res.rowcount

    with engine.begin() as c:
        for row in c.execute(text("""SELECT coalesce(country,'(空)') co, coalesce(province,'(空)') pr,
                                     count(*) n FROM points GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12""")).mappings():
            print(f"   {row['co']:<10}{row['pr']:<10}{row['n']:>5}")
    print(f"✓ 线路点位 {n_line} 个、名山点位 {n_famous} 个补上地区")


if __name__ == "__main__":
    main()
