"""把 outputs/hikes-design-v3.html 里已确认的 8 屏设计，原样抽成正式页面基底。

设计稿就是事实来源。不要重新设计、不要照文档文字重新实现——
把设计稿的 markup 和 CSS 抽出来，再往里接真数据。

用法：python3 pipeline/extract_design.py
输出：app/web/design.css  +  app/web/pages/*.html
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "outputs" / "hikes-design-v3.html"
OUT = ROOT / "app" / "web"
PAGES = OUT / "pages"

SLUG = {
    "首页": "home",
    "路书": "routes",
    "山头·岔路": "places",
    "扫码到达页 · 山头打卡点": "arrive",
    "山头页（打卡点）": "peak",
    "岔路页（路书点）": "junction",
    "消息": "messages",
    "我": "me",
}


def main():
    src = SRC.read_text(encoding="utf-8")

    # ① 设计稿自己的 CSS —— 这才是页面的视觉标准
    css = re.search(r"<style>([\s\S]*?)</style>", src).group(1)
    (OUT / "design.css").write_text(css, encoding="utf-8")

    # ② 逐屏抽出 .phone 的完整 DOM
    PAGES.mkdir(parents=True, exist_ok=True)
    chunks = src.split('<figure class="phone-wrap">')[1:]
    made = []
    for chunk in chunks:
        m = re.search(r"<figcaption><b>([^<]+)</b>", chunk)
        if not m:
            continue
        title = m.group(1).strip()
        slug = SLUG.get(title)
        if not slug:
            print(f"  ! 未登记标题：{title}")
            continue
        body = re.search(r"(<div class=\"phone\"[\s\S]*?)\s*</div>\s*<figcaption>", chunk)
        if not body:
            print(f"  ! 抽不出 DOM：{title}")
            continue
        html = (
            "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            f"<title>{title} · 到此一游</title>\n"
            "<link rel=\"stylesheet\" href=\"/design.css\">\n"
            "<link rel=\"stylesheet\" href=\"/pages/page.css\">\n"
            "<script src=\"guard.js\"></script>\n"
            "</head>\n<body>\n"
            "<div class=\"pagewrap\">\n"
            + body.group(1) + "\n</div>\n"
            "<script src=\"/pages/" + slug + ".js\"></script>\n"
            "</body>\n</html>\n"
        )
        (PAGES / (slug + ".html")).write_text(html, encoding="utf-8")
        made.append((slug, title))

    print(f"✓ CSS → {OUT/'design.css'}（{len(css.splitlines())} 行）")
    print(f"✓ 抽出 {len(made)} 屏 → {PAGES}")
    for s, t in made:
        print(f"    {s}.html  ←  {t}")
    print("\n下一步：逐屏把写死的示例数据换成 /api 请求（pages/*.js）")


if __name__ == "__main__":
    main()
