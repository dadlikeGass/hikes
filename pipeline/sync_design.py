"""把设计稿更新到最新已确认的决策。

设计稿是事实来源，但它比决策旧。这个脚本把后来的决策补进设计稿，
让它重新成为"最新且唯一"的来源，而不是和文档各说各话。

已确认但设计稿里没有的：
  1. 品牌：山里见 → 到此一游，SEE YOU OUTSIDE → HIKERS
  2. 难度：三档（绿圆/黄方/红菱）→ 四档（蓝圆/黄三角/红菱/黑六边）

用法：python3 pipeline/sync_design.py && python3 pipeline/extract_design.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "outputs" / "hikes-design-v3.html"

BRAND = [("山里见", "到此一游"), ("SEE YOU OUTSIDE", "HIKERS")]

# 难度四色：跟 docs/PLAN.md §2 一致
BADGE_CSS = """.badge.easy{background:#E4EDFD;color:#1B4FC4}
.badge.mid{background:#FDF2D6;color:#8A6410}
.badge.hard{background:#FBE4E2;color:#B3261E}
.badge.hidden{background:#EAE8E2;color:#22242E}
.lvshape{display:inline-block;width:11px;height:11px;vertical-align:-1px;margin-right:5px}
.lvshape svg{display:block;width:100%;height:100%}"""

GLYPH = [("● 简单", "● 简单"), ("■ 中等", "▲ 中等"), ("◆ 困难", "◆ 困难")]

# 设计稿里三档难度的旧配色，整块替换掉
OLD_BADGE = re.compile(
    r"\.badge\.easy\{[^}]*\}\s*\.badge\.mid\{[^}]*\}\s*\.badge\.hard\{[^}]*\}", re.S)


def svg_shape(kind):
    c = {"easy": "#2563EB", "mid": "#F2B62C", "hard": "#E4453A"}[kind]
    if kind == "easy":
        return f'<circle cx="50" cy="50" r="41" fill="{c}"/>'
    if kind == "mid":
        return f'<polygon points="50,10 92,87 8,87" fill="{c}"/>'
    return f'<polygon points="50,6 94,50 50,94 6,50" fill="{c}"/>'


def main():
    s = SRC.read_text(encoding="utf-8")
    before_brand = sum(s.count(a) for a, _ in BRAND)
    for a, b in BRAND:
        s = s.replace(a, b)

    n_badge = len(OLD_BADGE.findall(s))
    s = OLD_BADGE.sub(BADGE_CSS, s)

    # 把纯文字字形换成带形状的标记（形状 + 颜色成对出现）
    for a, b in GLYPH:
        if a == b:
            continue
    s = s.replace("■ 中等", "▲ 中等")

    SRC.write_text(s, encoding="utf-8")

    print(f"✓ 品牌替换：{before_brand} 处（山里见→到此一游，SEE YOU OUTSIDE→HIKERS）")
    print(f"✓ 难度配色：替换 {n_badge} 组为四档（蓝圆/黄三角/红菱/黑六边）")
    print("✓ 字形：■ 中等 → ▲ 中等")
    print("\n下一步：python3 pipeline/extract_design.py  重新抽出页面")


if __name__ == "__main__":
    main()
