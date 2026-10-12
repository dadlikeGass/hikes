/* 直接双击 HTML 文件（file://）打开时，页面拿不到 /api —— 给一句能照做的话，而不是白屏或 "加载失败"。 */
(function () {
  if (location.protocol !== 'file:') return;
  function show() {
    document.body.innerHTML =
      '<div style="max-width:430px;margin:0 auto;padding:48px 22px;' +
      'font:15px/1.75 -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;' +
      'color:#22242E;background:#F7F3EC;min-height:100vh">' +
      '<div style="font-size:20px;font-weight:800;margin-bottom:6px">到此一游</div>' +
      '<div style="font-size:13px;color:#FF714E;font-weight:700;letter-spacing:2px;' +
      'margin-bottom:22px">HIKERS</div>' +
      '<div style="background:#FFF1EC;border-left:4px solid #FF714E;border-radius:12px;' +
      'padding:16px 18px;font-size:14px">' +
      '<b>这个页面要从服务器打开，不能直接双击文件。</b><br>' +
      '<span style="color:#6B6E7E">页面里的数据来自后端接口，' +
      '用 <code>file://</code> 打开时浏览器会拒绝这些请求。</span></div>' +
      '<div style="margin-top:22px;font-size:13.5px;color:#6B6E7E">先在终端里启动服务：</div>' +
      '<pre style="background:#22242E;color:#EAE8E2;padding:14px 16px;border-radius:12px;' +
      'font-size:12.5px;overflow-x:auto;margin:10px 0 20px">cd hikes/server\n' +
      'docker compose up -d</pre>' +
      '<div style="font-size:13.5px;color:#6B6E7E">然后打开：</div>' +
      '<a href="http://localhost:8000/" style="display:inline-block;margin-top:8px;' +
      'background:#3455F5;color:#fff;font-weight:700;text-decoration:none;' +
      'padding:12px 22px;border-radius:12px">http://localhost:8000/</a>' +
      '<div style="margin-top:26px;font-size:12.5px;color:#9A9CAA;line-height:1.8">' +
      '首页 <code>localhost:8000/</code><br>' +
      '路书 <code>localhost:8000/routes.html</code><br>' +
      '山头与岔路 <code>localhost:8000/places.html</code><br>' +
      '我 <code>localhost:8000/me.html</code><br>' +
      '扫码落地页 <code>localhost:8000/index.html?code=QS-TEST01</code><br>' +
      '维护台 <code>localhost:8000/admin.html</code></div></div>';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', show);
  } else { show(); }
})();
