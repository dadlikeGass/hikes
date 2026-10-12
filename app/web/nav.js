/* 底部导航：所有页面共用。
   5 格 = 路书 / 山头·岔路 / 扫一扫(凸起) / 消息 / 我；首页走左上角品牌 logo。 */
(function () {
  var ICO = {
    book: '<path d="M4 4.5h7v7H4zM13 4.5h7v7h-7zM4 13.5h7v6H4zM13 13.5h7v6h-7z"/>',
    hill: '<path d="M2 19.5 9 6.5l3.6 6.2 2.2-3.4 7.2 10.2z"/>',
    scan: '<path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9"/><path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9"/>' +
      '<path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15"/><path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15"/>' +
      '<rect x="10" y="10" width="4" height="4" rx="1.2"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
    me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4"/>'
  };
  function svg(k, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICO[k] + '</svg>';
  }
  var here = location.pathname;
  function on(p) { return here.indexOf(p) === 0 ? ' class="on"' : ''; }

  var css = document.createElement('style');
  css.textContent = '.tabbar{position:fixed;left:0;right:0;bottom:0;max-width:430px;margin:0 auto;z-index:50}' +
    '@media(min-width:600px){.tabbar{left:50%;transform:translateX(-50%)}}' +
    'body{padding-bottom:84px!important}' +
    '.tabbar .scanb{border:none;background:none;padding:0}';
  document.head.appendChild(css);

  var nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.innerHTML =
    '<a href="/routes.html"' + on('/routes') + '>' + svg('book') + '路书</a>' +
    '<a href="/places.html"' + on('/places') + '>' + svg('hill') + '山头·岔路</a>' +
    '<a class="scan" href="#" id="scanBtn"><span class="scan-btn">' + svg('scan', 'sc') +
    '</span><em>扫一扫</em></a>' +
    '<a href="#" id="msgBtn">' + svg('chat') + '消息</a>' +
    '<a href="/me.html"' + on('/me') + '>' + svg('me') + '我</a>';
  document.body.appendChild(nav);

  function toast(m) {
    var t = document.createElement('div');
    t.textContent = m;
    t.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);' +
      'background:rgba(28,26,42,.92);color:#fff;font-size:13px;font-weight:600;padding:10px 18px;' +
      'border-radius:999px;z-index:99;white-space:nowrap';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  document.getElementById('scanBtn').onclick = function (e) {
    e.preventDefault();
    toast('扫一扫需要相机权限，先看一张示例点位的效果');
    setTimeout(function () { location.href = '/?code=QS-TEST01'; }, 700);
  };
  document.getElementById('msgBtn').onclick = function (e) {
    e.preventDefault();
    toast('消息还没做——等留言和情报有人回应了再来');
  };
})();
