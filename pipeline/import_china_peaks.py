"""把「中国热门徒步登山山峰 100 座」补进山头库（`mountains`），并做去重。

数据：`pipeline/data/china_peaks_100.json`（名山大川 + 大城市周边热门线路，
坐标为 WGS84 山顶/主峰位置，人次与坐标来源逐行记录）。
表结构：需要先跑 `alembic upgrade head`（0009_mountain_profile 加档案列）。

去重口径（关键）：
  身份只有一个山头一行，合并必须人工核实（见 `server/db/013`、`018` 与
  `POST /api/admin/mountains/link`）。所以本脚本**不按名字或距离自动合并**，
  只做两件确定的事：
    1) MERGES 里逐条写明依据的——确认是同一座山，只更新那座山的档案字段，
       不新建身份（海拔、几何、name_status 一律不覆盖）；
    2) 其余一律作为新山头插入，stable_key = cn-peak-100:<省>-<名>。
  插入前另有一次兜底检查：同名（去掉括号后缀）且 3 km 内已有山头 → 跳过并打印，
  这样脚本被重复跑也不会攒出重复身份。

用法：
    docker compose exec api python /srv/pipeline/import_china_peaks.py --dry
    docker compose exec api python /srv/pipeline/import_china_peaks.py
    docker compose exec api python /srv/pipeline/import_china_peaks.py --with-points --with-opening
    docker compose exec api python /srv/pipeline/import_china_peaks.py --fix-coords

`--fix-coords`：把 MERGES 中与本研究坐标相距 > 20 km 的旧行几何纠正到真山顶
（现测出 3 座：恒山偏 141 km、天柱山偏 79 km、青城山偏 8 km 落在赵公山）。
默认不动几何——改的是别人已发布的身份，得有人点头。

`--with-points`：给本批山头补齐**扫码点位 + 短链 + 山顶留言板**（沿用名山大川那批的
  CN-xx 格式：`points.code` = CNP-<原表序号>，published、type=peak）。
  已经有已发布点位（CN-xx、线路点位）的山头直接复用，不另发编号——编号印在标牌上，
  一座山只能有一个。`--with-opening`：给每块山顶板写首条开板留言（官方账号，
  内容取自本数据集的简介 / 常规路线 / 用时），已有则不重复写。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "/srv")
for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine          # noqa: E402
from sqlalchemy import text          # noqa: E402

DATA = Path(__file__).resolve().parent / "data" / "china_peaks_100.json"
BATCH = "china_peaks_100@2026-10-15"
EDITOR_NICKNAME = "山野路簿"       # 开板留言的作者：产品自己的资料账号
OPENING_MAX = 200                   # comments.text 的库内上限

# ---- 已核实属于同一座山的：峰名 → (已有 stable_key, 判定依据) ----
MERGES = {
    "东灵山": ("legacy-route-peak:3:1", "同为主峰：库内点位距本研究坐标 0.75 km，海拔 2287 m 与实测口径一致"),
    "泰山": ("point:CN-01", "同名同山：坐标差 1.19 km（玉皇顶 vs 山体中心）"),
    "崂山": ("point:CN-24", "同名同山，坐标一致"),
    "恒山": ("point:CN-04", "同名同山（北岳浑源）：库内坐标偏 141 km，档案按天峰岭写入，坐标问题见输出提醒"),
    "嵩山（峻极峰）": ("point:CN-05", "同名同山：峻极峰即太室山最高点"),
    "华山": ("point:CN-02", "同名同山，坐标一致（均为南峰）"),
    "贡嘎山": ("point:CN-14", "同名同山，坐标一致"),
    "峨眉山": ("point:CN-08", "同名同山，坐标一致（均为金顶/万佛顶）"),
    "青城山": ("point:CN-22", "同名同山：库内坐标偏 8 km 落在赵公山，坐标问题见输出提醒"),
    "玉龙雪山": ("point:CN-12", "同名同山，坐标差 0.17 km"),
    "梅里雪山（卡瓦格博）": ("point:CN-15", "同名同山，坐标差 0.16 km"),
    "衡山（祝融峰）": ("point:CN-03", "同名同山：祝融峰即南岳最高点，坐标差 4 km 属山顶与景区中心之差"),
    "武当山（金顶）": ("point:CN-09", "同名同山，坐标差 0.05 km"),
    "庐山": ("point:CN-07", "同名同山，坐标一致（汉阳峰口径）"),
    "三清山": ("point:CN-21", "同名同山，坐标一致"),
    "黄山": ("point:CN-06", "同名同山：莲花峰与库内坐标差 0.57 km"),
    "九华山": ("point:CN-18", "同名同山：十王峰与库内坐标差 2.47 km"),
    "天柱山": ("point:CN-23", "同名同山（安徽潜山）：库内坐标偏 79 km，坐标问题见输出提醒"),
    "雁荡山": ("point:CN-20", "同名同山：百岗尖与景区中心差 3.78 km"),
    "长白山（白云峰）": ("point:CN-11", "同名同山：白云峰为长白山最高峰，坐标差 2.32 km"),
    "五台山北台叶斗峰": ("point:CN-17", "库内「五台山」的点就落在北台叶斗峰（3061 m），同一山顶：名字是山系、点位是主峰"),
    "冈仁波齐": ("point:CN-16", "库内写作「冈仁波齐峰」，坐标一致"),
}

# ---- 看着像但**不是**同一座山的：写在这里，免得以后有人当成漏合并去"修" ----
NOT_MERGED = [
    ("四姑娘山大峰 / 二峰 / 三峰", "库内 CN-13「四姑娘山」是幺妹峰（6250 m）；三座 5000 米级卫峰是不同山顶，各自建身份"),
    ("小五台山", "与 CN-17「五台山」只是名字包含，实际相距 152 km（河北蔚县 vs 山西五台）"),
    ("黄岗山", "与 CN-10「武夷山」不是同一顶：库内武夷山的点落在风景区，黄岗山在闽赣界山脊"),
    ("赵公山", "库内 CN-22 的点落在赵公山附近但名字是青城山；赵公山本身是独立山头，按新山头录入"),
    ("香山（香炉峰）", "与西山一带已有的玉皇顶 / 翠微顶 / 打鹰洼相距 1–4 km，只有邻接关系，不是同一山头"),
]

# ---- 旧数据提醒（只打印，不动库）----
WARNINGS = [
    ("point:CN-04 恒山", "坐标 (38.58333, 112.90000) 在忻州一带，离北岳恒山（39.67440, 113.73920）141 km"),
    ("point:CN-23 天柱山", "坐标 (30.11667, 116.08333)、海拔 1760 m，与安徽潜山天柱山（30.74470, 116.46440 / 1489.8 m）相距 79 km"),
    ("point:CN-22 青城山", "坐标 (30.97333, 103.51556) 落在赵公山山顶，海拔 1600 m 与青城山（1260 m）不符"),
    ("point:CN-10 武夷山", "海拔 2158 m 取的是黄岗山，坐标却是武夷山风景区，两者相距 15 km"),
]


def base_name(name: str) -> str:
    """'梅里雪山（卡瓦格博）' → '梅里雪山'，用于兜底同名检查。"""
    return re.sub(r"[（(].*$", "", name or "").strip()


def point_level(p) -> str:
    """点位难度：按常规登顶用时与海拔定档（easy / mid / hard）。

    名山大川那批一律写了 'hard'，这里按实际强度分档——佘山 20 分钟和哈巴雪山
    四天不该是同一个标签。规则：多日行程或海拔 ≥ 4500 m → hard；单程 ≥ 6 小时
    也 → hard；≥ 2 小时或海拔 ≥ 3000 m → mid；其余 easy。
    """
    t, elev = p["summit_time"], p["elevation_m"] or 0
    if "日" in t or elev >= 4500:
        return "hard"
    # 注意小数：「1.5 小时」要算 90 分钟，不能只取到「5 小时」
    mins = [round(float(h) * 60) for h in re.findall(r"(\d+(?:\.\d+)?)\s*小时", t)]
    mins += [round(float(m)) for m in re.findall(r"(\d+(?:\.\d+)?)\s*分钟", t)]
    if not mins:
        return "mid"
    top = max(mins)
    if top >= 360:
        return "hard"
    if top >= 120 or elev >= 3000:
        return "mid"
    return "easy"


def split_city(region: str) -> str | None:
    """'广东 · 韶关乳源 / 湖南宜章' → '韶关乳源'（市一级取不到就留空，不猜）。"""
    parts = [x.strip() for x in re.split(r"[·]", region or "")]
    if len(parts) < 2:
        return None
    return re.split(r"\s*/\s*", parts[1])[0].strip() or None


def opening_note(p) -> str:
    """开板留言：一段可核对的资料，不留空板。"""
    text = (f"开板资料：{p['intro']}"
            f"　常规路线：{p['route_hint']}；平均登顶 {p['summit_time']}。")
    return text[:OPENING_MAX - 1] + "…" if len(text) > OPENING_MAX else text


def main():
    dry = "--dry" in sys.argv
    fix_coords = "--fix-coords" in sys.argv
    with_points = "--with-points" in sys.argv
    with_opening = "--with-opening" in sys.argv
    data = json.loads(DATA.read_text())
    peaks = data["peaks"]
    ins = ref = upd = skip = miss = 0
    fixed = []
    minted = reused = boarded = noted = 0
    previewed = 0

    with engine.begin() as c:
        for p in peaks:
            key, name = p["stable_key"], p["name"]
            prof = {
                "region": p["region"], "area_group": p["area_group"],
                "range_name": p["range_name"], "intro": p["intro"],
                "heat_tier": p["heat_tier"], "annual_visits": p["annual_visits"],
                "summit_time": p["summit_time"], "route_hint": p["route_hint"],
            }
            prov = json.dumps({"dataset": "china_peaks_100", "batch": BATCH,
                               "coord_source": p["coord_source"],
                               "visits_source": p["visits_source"]},
                              ensure_ascii=False)
            merge = MERGES.get(name)
            if merge:
                target, why = merge
                if dry:
                    print(f"  ~ 合并 {name:<14} → {target:<22} {why}")
                    upd += 1
                    continue
                row = c.execute(text("""
                    UPDATE mountains SET
                      region = :region, area_group = :area_group, range_name = :range_name,
                      intro = :intro, heat_tier = :heat_tier, annual_visits = :annual_visits,
                      summit_time = :summit_time, route_hint = :route_hint,
                      altitude = COALESCE(altitude, :alt),
                      geom = COALESCE(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)),
                      provenance = provenance || CAST(:prov AS jsonb),
                      updated_at = now()
                    WHERE stable_key = :key
                    RETURNING id, ST_Distance(geom::geography,
                              ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS m
                """), {**prof, "key": target, "alt": p["elevation_m"], "lat": p["lat"],
                       "lng": p["lng"], "prov": prov}).first()
                if not row:
                    print(f"  ! 合并目标不存在，跳过：{name} → {target}")
                    miss += 1
                    continue
                upd += 1
                print(f"  ~ 合并 {name:<14} → {target:<22} {row.m and round(row.m / 1000, 1)} km")
                if fix_coords and row.m and row.m > 20000:
                    c.execute(text("""UPDATE mountains
                        SET geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), updated_at = now()
                        WHERE id = :id"""),
                              {"lng": p["lng"], "lat": p["lat"], "id": row.id})
                    fixed.append((name, target, round(row.m / 1000, 1)))
                continue

            # 兜底：同名且 3 km 内已有山头 → 不新建身份
            hit = c.execute(text("""
                SELECT stable_key, name FROM mountains
                WHERE geom IS NOT NULL AND name IS NOT NULL
                  AND regexp_replace(name, '[（(].*$', '') = :base
                  AND ST_DWithin(geom::geography,
                                 ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 3000)
                LIMIT 1
            """), {"base": base_name(name), "lng": p["lng"], "lat": p["lat"]}).first()
            # 命中的是**别人**的身份 → 只能人工合并，脚本不动它；
            # 命中的是本脚本上次插的行（stable_key 相同）→ 正常刷新档案。
            if hit and hit.stable_key != key:
                print(f"  = 已存在同名同址山头，跳过：{name}（{hit.stable_key} {hit.name}）")
                skip += 1
                continue

            if dry:
                print(f"  {'↻ 刷新' if hit else '+ 新建'} {name:<14} {key}")
                ref, ins = (ref + 1, ins) if hit else (ref, ins + 1)
                continue
            c.execute(text("""
                INSERT INTO mountains (stable_key, name, altitude, geom, name_status,
                                       name_source, region, area_group, range_name, intro,
                                       heat_tier, annual_visits, summit_time, route_hint,
                                       provenance)
                VALUES (:key, :name, :alt, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                        'candidate', CAST(:nsrc AS jsonb), :region, :area_group, :range_name,
                        :intro, :heat_tier, :annual_visits, :summit_time, :route_hint,
                        CAST(:prov AS jsonb))
                ON CONFLICT (stable_key) DO UPDATE SET
                  name = EXCLUDED.name, altitude = EXCLUDED.altitude, geom = EXCLUDED.geom,
                  region = EXCLUDED.region, area_group = EXCLUDED.area_group,
                  range_name = EXCLUDED.range_name, intro = EXCLUDED.intro,
                  heat_tier = EXCLUDED.heat_tier, annual_visits = EXCLUDED.annual_visits,
                  summit_time = EXCLUDED.summit_time, route_hint = EXCLUDED.route_hint,
                  provenance = mountains.provenance || CAST(:prov AS jsonb),
                  updated_at = now()
            """), {**prof, "key": key, "name": name, "alt": p["elevation_m"],
                   "lat": p["lat"], "lng": p["lng"], "prov": prov,
                   "nsrc": json.dumps([{"src": "china_peaks_100",
                                        "ref": p["coord_source"],
                                        "at": "2026-10-15"}], ensure_ascii=False)})
            ref, ins = (ref + 1, ins) if hit else (ref, ins + 1)

    print(f"\n新建山头 {ins}　刷新本批山头 {ref}　合并已有山头 {upd}　"
          f"同名同址跳过 {skip}　合并目标缺失 {miss}")

    if with_points or with_opening:
        editor_id = None
        if with_opening and not dry:
            with engine.begin() as c:
                # nickname 上没有唯一约束，所以先查再建：跑两遍不会多出第二个资料账号
                editor_id = c.execute(text("""SELECT id FROM users WHERE nickname = :n
                    ORDER BY id LIMIT 1"""), {"n": EDITOR_NICKNAME}).scalar()
                if editor_id is None:
                    editor_id = c.execute(text("INSERT INTO users (nickname) VALUES (:n) "
                                               "RETURNING id"),
                                          {"n": EDITOR_NICKNAME}).scalar()
        for p in peaks:
            target = MERGES.get(p["name"], (p["stable_key"], ""))[0]
            with engine.begin() as c:
                m = c.execute(text("""SELECT id, name FROM mountains WHERE stable_key = :k"""),
                              {"k": target}).first()
                if not m:
                    print(f"  ! 找不到山头，跳过：{p['name']}（{target}）")
                    continue
                pt = c.execute(text("""SELECT id, code FROM points
                    WHERE mountain_id = :m AND type = 'peak' ORDER BY id LIMIT 1"""),
                               {"m": m.id}).first()
                if pt:
                    reused += 1
                else:
                    code = f"CNP-{p['no']:03d}"
                    if dry:
                        print(f"  + 点位 {code} {p['name']} level={point_level(p)}")
                        minted += 1
                        pt = None
                    else:
                        pt = c.execute(text("""
                            INSERT INTO points (code, type, name, level, altitude, geom,
                                                country, province, city, status, mountain_id)
                            VALUES (:code, 'peak', :name, :level, :alt,
                                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                                    '中国', :prov, :city, 'published', :m)
                            ON CONFLICT (code) DO UPDATE SET
                              name = EXCLUDED.name, altitude = EXCLUDED.altitude,
                              geom = EXCLUDED.geom, province = EXCLUDED.province,
                              city = EXCLUDED.city, mountain_id = EXCLUDED.mountain_id
                            RETURNING id, code"""),
                            {"code": code, "name": p["name"], "level": point_level(p),
                             "alt": p["elevation_m"], "lng": p["lng"], "lat": p["lat"],
                             "prov": p["province"], "city": split_city(p["region"]),
                             "m": m.id}).first()
                        c.execute(text("""INSERT INTO short_links (code, point_id)
                            VALUES (:c, :p) ON CONFLICT (code) DO NOTHING"""),
                                  {"c": pt.code, "p": pt.id})
                        minted += 1
                if dry:
                    if with_opening and previewed < 3:
                        print(f"  ✎ 开板留言（{p['name']}）：{opening_note(p)}")
                        previewed += 1
                    continue
                if c.execute(text("""INSERT INTO boards (board_type, mountain_id)
                        VALUES ('summit', :m) ON CONFLICT (mountain_id) DO NOTHING
                        RETURNING id"""), {"m": m.id}).scalar():
                    boarded += 1
                if with_opening and pt:
                    text_ = opening_note(p)
                    if len(text_) > OPENING_MAX:
                        print(f"  ! 开板留言超长，跳过：{p['name']}")
                        continue
                    done = c.execute(text("""SELECT 1 AS x FROM comments
                        WHERE point_id = :p AND user_id = :u LIMIT 1"""),
                                     {"p": pt.id, "u": editor_id}).scalar()
                    if done:
                        continue
                    c.execute(text("""INSERT INTO comments (point_id, user_id, text)
                        VALUES (:p, :u, :t)"""), {"p": pt.id, "u": editor_id, "t": text_})
                    noted += 1
        print(f"铸新点位 {minted}　复用已有点位 {reused}　新建山头板 {boarded}　"
              f"开板留言 {noted}")
        if minted:
            lv = {}
            for p in peaks:
                if MERGES.get(p["name"]):
                    continue
                lv[point_level(p)] = lv.get(point_level(p), 0) + 1
            print("　难度分档：" + "　".join(f"{k} {lv.get(k, 0)}" for k in ("easy", "mid", "hard")))

    if fixed:
        print("已纠正的几何：")
        for name, key, km in fixed:
            print(f"  · {name} ({key}) 由旧坐标移动 {km} km")
    print("未合并但形似的（人工核对后确认是不同山头）：")
    for name, why in NOT_MERGED:
        print(f"  · {name}：{why}")
    print("旧数据提醒（本脚本未改动）：")
    for target, why in WARNINGS:
        print(f"  · {target}：{why}")
    if dry:
        print("\n（--dry：以上为预演，未写入数据库）")


if __name__ == "__main__":
    main()
