"""赛事官方赛道 GPX → 入库用的路线数据

对 tracks/races/*.gpx 逐条跑和徒步路书**同一套**管线（pipeline/build.py）：
按距离重采样 → 5 点平滑 → 找山顶 → 分段定级 → 原始高程 + 3m 滞回算累计爬升，
所以前端画图、算难度、算用时的代码不用改，赛事路线和路书是同一个形状。

两处差别：
  1. 名称/城市/年份不从 GPX 里猜，直接取 tracks/races/manifest.json
     （赛事 GPX 的 <name> 是补给点名，照抄会把「起终点-中和广场」当成线路名）。
  2. 爬升优先用官方公布值——UTMB 几站的 GPX 海拔噪声大，去噪后仍显著高于官方。
     两个值都写进 est，不丢信息。

用法：python3 pipeline/build_races.py
输出：pipeline/out/race_routes.json（server/seeds/seed_race_routes.py 读它入库）
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import build as B  # noqa: E402  复用徒步路书的同一套算法

RACES = ROOT / "tracks" / "races"
OUT = ROOT / "pipeline" / "out"


def main():
    manifest = json.loads((RACES / "manifest.json").read_text(encoding="utf-8"))
    out, fail = {}, []
    for m in manifest:
        path = RACES / m["file"]
        try:
            r = B.pickup(path)
            if not r:
                fail.append((m["file"], "点太少或距离过短"))
                continue
        except Exception as ex:                       # noqa: BLE001
            fail.append((m["file"], f"{type(ex).__name__}: {ex}"))
            continue

        # 数值优先级：官方公布值 → 清单里的参考值 → 我们自己从 GPX 算的。
        # 为什么要夹一层清单参考值：有些轨迹点密到离谱（五台山 21K：21 公里 1.3 万个点），
        # 原始高程的 3m 滞回会把 GPS 抖动全累加成爬升，算出 2.5 万米这种不可能的数。
        off_km = (m.get("official_distance_m") or 0) / 1000.0
        off_up = m.get("official_gain_m")
        ref_km, ref_up = m.get("distance_km"), m.get("gain_m")
        km = round(off_km, 1) if off_km else (ref_km or r["km"])
        up = int(off_up) if off_up else int(ref_up or r["up"])

        slug = f'{m["slug"]}-{m["year"]}'   # 年份进 slug：同一条赛道不同年份是不同的路线
        out[slug] = {
            "slug": slug,
            "name": m["name"],
            "sub": f'{m["year"]} · {m["category"]}',
            "city": m["place"],
            "year": m["year"],
            "event": m["event"],
            "category": m["category"],
            "place": m["place"],
            "source": m.get("source"),
            "activity": "trail",
            "km": km, "up": up,
            "down": m.get("official_loss_m") or m.get("loss_m") or r["down"],
            # 赛事结果不套用休闲徒步时间/热量模型；官方赛事数据单独保留。
            "hardest": r["hardest"], "hours": None, "kcal": None,
            "est": {**r["est"], "basis": "race",
                    "gainOfficial": off_up, "gainManifest": ref_up, "gainGpx": r["up"],
                    "kmOfficial": round(off_km, 1) or None, "kmManifest": ref_km,
                    "kmGpx": r["km"],
                    "note": m.get("gain_note")},
            "peaks": r["peaks"], "segments": r["segments"],
            "path": r["path"], "profile": r["profile"],
            "points": r["points"], "resampled": r["resampled"],
        }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "race_routes.json").write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8")

    print(f'{"slug":<26}{"年份":>6}{"km":>8}{"爬升":>8}{"顶":>4}{"段":>4}  赛事')
    print("-" * 78)
    for r in out.values():
        print(f'{r["slug"]:<26}{r["year"]:>6}{r["km"]:>8}{r["up"]:>8}'
              f'{len(r["peaks"]):>4}{len(r["segments"]):>4}  {r["event"]}')
    if fail:
        print("\n跳过：")
        for s, why in fail:
            print(f"  {s}: {why}")
    print(f'\n✓ {len(out)} 条赛事路线写入 {OUT / "race_routes.json"}'
          f'（{sum(r["points"] for r in out.values())} 个原始轨迹点）')


if __name__ == "__main__":
    main()
