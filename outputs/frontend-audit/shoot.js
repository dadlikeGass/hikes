// 前端清点截图：整页截取，移动端视口 430x932
const { chromium } = require('playwright');

const BASE = 'http://localhost:8000';
const OUT = '/Users/2026brooke/Documents/ChatGPT/hikes/outputs/frontend-audit';

const PAGES = [
  // 主线 SPA（唯一在服务的前端）
  ['root-redirect', '/'],
  ['spa-home', '/app/'],
  ['spa-places', '/app/#/places'],
  ['spa-board', '/app/#/board'],
  ['spa-me', '/app/#/me'],
  ['spa-letters', '/app/#/me/letters'],
  ['spa-sanfeng', '/app/sanfeng.html'],
  // 合规页与共用底图仍在服务，纳入回归
  ['legal-privacy', '/privacy.html'],
  // 已封存：/routes.html /places.html /me.html /admin.html /index.html
  // /pages/*.html /design.css 均应 404，见 archive/README.md
];

(async () => {
  // 本机没有 playwright 自带浏览器，直接复用已安装的 Google Chrome
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();

  for (const [name, path] of PAGES) {
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 25000 });
    } catch (e) {
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log('shot', name, '->', await page.title());
  }

  // 封存回归：这些路径必须 404，否则说明封存被绕过
  const SEALED = [
    '/routes.html', '/places.html', '/me.html', '/admin.html', '/index.html',
    '/pages/arrive.html', '/pages/peak.html', '/design.css', '/nav.js', '/guard.js',
  ];
  const failed = [];
  for (const p of SEALED) {
    const r = await page.request.get(BASE + p);
    const ok = r.status() === 404;
    if (!ok) failed.push(`${p} -> ${r.status()}`);
    console.log(ok ? 'sealed  ok ' : 'sealed FAIL', p, r.status());
  }
  console.log(failed.length ? `\n封存回归失败 ${failed.length} 项: ${failed.join(', ')}` : '\n封存回归全部通过');

  await browser.close();
})();
