"""六只脚区域线路 GPX → 入库用的路线数据

和赛事路线（pipeline/build_races.py）同一套做法：跑 pipeline/build.py 的
重采样/平滑/找山顶/分段管线，但名称、城市、来源直接取 tracks/routes-cn/manifest.json，
不从 GPX 里猜（六只脚导出的 GPX 没有可靠的 <desc>，城市会全部退化成"北京"）。

用法：python3 pipeline/build_routes_cn.py
输出：pipeline/out/routes_cn.json（server/seeds/seed_routes_cn.py 读它入库）
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import build as B  # noqa: E402

SRC_DIR = ROOT / "tracks" / "routes-cn"
OUT = ROOT / "pipeline" / "out"


def main():
    manifest = json.loads((SRC_DIR / "manifest.json").read_text(encoding="utf-8"))
    out, fail = {}, []
    for m in manifest:
        path = SRC_DIR / m["file"]
        try:
            r = B.pickup(path)
            if not r:
                fail.append((m["file"], "点太少或距离过短"))
                continue
        except Exception as ex:                       # noqa: BLE001
            fail.append((m["file"], f"{type(ex).__name__}: {ex}"))
            continue

        city = m["place"].replace(" ", " · ") if m.get("place") else m.get("region")
        out[m["slug"]] = {
            "slug": m["slug"],
            "name": m["name"],
            "sub": m.get("region"),
            "city": city,
            "kind": "hike",
            "activity": "hiking",
            "source": m.get("source"),
            "km": r["km"], "up": r["up"], "down": r["down"],
            "hardest": r["hardest"], "hours": r["hours"], "kcal": r["kcal"],
            "est": {**r["est"], "basis": "hike",
                    "sixfootViews": m.get("views"), "sixfootFavs": m.get("favs")},
            "peaks": r["peaks"], "segments": r["segments"],
            "path": r["path"], "profile": r["profile"],
            "points": r["points"], "resampled": r["resampled"],
        }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "routes_cn.json").write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8")

    print(f'{"slug":<16}{"km":>8}{"爬升":>8}{"顶":>4}{"段":>4}  {"区域":<10}线路')
    print("-" * 78)
    for r in out.values():
        print(f'{r["slug"]:<16}{r["km"]:>8}{r["up"]:>8}'
              f'{len(r["peaks"]):>4}{len(r["segments"]):>4}  {r["sub"]:<10}{r["name"][:26]}')
    if fail:
        print("\n跳过：")
        for s, why in fail:
            print(f"  {s}: {why}")
    print(f'\n✓ {len(out)} 条区域线路写入 {OUT / "routes_cn.json"}'
          f'（{sum(r["points"] for r in out.values())} 个原始轨迹点）')


if __name__ == "__main__":
    main()
