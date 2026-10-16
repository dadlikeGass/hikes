// 前端清点截图：整页截取，移动端视口 430x932
const { chromium } = require('playwright');

const BASE = 'http://localhost:8000';
const OUT = '/Users/2026brooke/Documents/ChatGPT/hikes/outputs/frontend-audit';

const PAGES = [
  ['A1-static-home', '/'],
  ['A2-static-routes', '/routes.html'],
  ['A3-static-places', '/places.html'],
  ['A4-static-me', '/me.html'],
  ['A5-static-admin', '/admin.html'],
  ['A6-static-points', '/index.html'],
  ['B1-spa-home', '/app/'],
  ['B2-spa-places', '/app/#/places'],
  ['B3-spa-board', '/app/#/board'],
  ['B4-spa-me', '/app/#/me'],
  ['B5-spa-letters', '/app/#/me/letters'],
  ['B6-spa-sanfeng', '/app/sanfeng.html'],
  ['C1-proto-arrive', '/pages/arrive.html'],
  ['C2-proto-peak', '/pages/peak.html'],
  ['C3-proto-me', '/pages/me.html'],
  ['C4-proto-routes', '/pages/routes.html'],
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

  await browser.close();
})();
