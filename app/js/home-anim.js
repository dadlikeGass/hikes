/* 首页视觉动效（GSAP + hanzi-writer 自托管；2026-10-26 第四版）
 *
 * 这一版把上一版实测出的问题一起修掉：
 *   1) placeSun() 里引用了不存在的 sun 变量 → 每次进入首页抛 ReferenceError，
 *      品牌 logo / DCYY 那一段动画根本没跑（DCYY 还因为 CSS opacity:0 一直不显示）。
 *      白色太阳已被用户删除，placeSun 整段拆掉，连 resize 绑定一起删。
 *   2) 入场动画靠 850ms 后的延时启动，元素先以终态出现、再跳回透明度 0 重放，
 *      肉眼就是"闪一下再动"。现在渲染当帧就 prime() 设好初始态，延时缩到 ~140ms。
 *   3) prefers-reduced-motion 只挡了标题，山景入场/呼吸/视差照跑。现在统一由 reduced() 拦。
 *   4) 滚动视差把底图往上推，hero 底部露出空白；倾斜视差左右也会露边。
 *      现在取消滚动视差，底图统一加 8% 安全余量（BASE_SCALE），倾斜幅度收到 ±10px。
 *   5) 毛笔接管标题时 app.js 不再启动打字机，口号「记录，每次去山野」一句话都不打、
 *      光标还一直杵着。现在标题/口号拆开：毛笔只接标题，口号照常打字（app.js 见 skipTitle）。
 *   6) 毛笔与 F4 静态字之间是硬切。现在先 0.3s 淡出静态字，再进入毛笔模式。
 *
 * 节奏：山景入场 2.4s + 呼吸 5s 往返、徒步者 1.6s 入场 + 4.5s 浮动、
 *       品牌三层 1.5s（错 0.2/0.5s）+ DCYY 1.4s（错 0.18s）、毛笔一轮约 7.4s。
 */
(function (g) {
  'use strict';
  var BASE_SCALE = 1.08;      /* 底图基础放大：给视差/呼吸留余量，不露边 */
  var BREATH = 0.045;         /* 呼吸幅度：1.08 → 1.125 */

  var played = false;
  /* 品牌动画跟着"这一份 DOM"走：换页重来就重播，同一份 DOM 的重复渲染才直接补终态。
     以前用一个布尔量记住"播过了"，结果从别的页面回到首页时 logo 是直接蹦出来的，
     看起来就像"动画没了"。 */
  var brandPlayedEl = null;

  function killBrandLoops(el) {
    if (!el || !g.gsap) return;
    var prev = el.querySelectorAll(".logo-layer");
    if (prev.length) g.gsap.killTweensOf(prev);
  }
  var liveBg = null, liveHiker = null;
  var tiltBound = false;
  var brushState = null;

  function reduced() {
    if (/[?&]motion=1(&|$)/.test(g.location.search)) return false;
    return !!(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function q(sel, root) { return (root || document).querySelector(sel); }

  /* ---------- 渲染当帧先把初始态压住，避免"先出现再跳回去重放" ---------- */
  function prime(canBrush) {
    if (!g.gsap || reduced()) return;
    var brand = document.getElementById('homeBrand');
    if (brand && brandPlayedEl !== brand) g.gsap.set(brand.querySelectorAll('.logo-layer'), { opacity: 0 });
    if (!played) {
      var hiker = q('.home-scene .home-hiker');
      if (hiker) g.gsap.set(hiker, { y: 42, opacity: 0 });
    }
    /* 标题要让毛笔写：F4 那行静态字先藏起来、红线归零，
       否则会先看到"打字机标题"再被墨迹重写一遍（用户说的"两层字"）。 */
    if (canBrush) {
      var h1 = q('.home-copy h1');
      if (h1) {
        h1.style.setProperty('--p', 0);
        g.gsap.set([h1.querySelector('[data-tw]'), h1.querySelector('.tw-caret')], { opacity: 0 });
      }
    }
  }

  /* ---------- 场景：入场 + 呼吸循环 ---------- */
  function loops(bg, hiker) {
    var G = g.gsap;
    G.to(bg, { scale: BASE_SCALE + BREATH, duration: 5, ease: 'sine.inOut', repeat: -1, yoyo: true });
    if (hiker) G.to(hiker, { y: -6, duration: 4.5, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.3 });
  }
  function scene() {
    var G = g.gsap;
    if (!G) return;
    var root = q('.home-scene');
    if (!root) return;
    var bg = q('.home-bg', root);
    if (!bg) return;
    var hiker = q('.home-hiker', root);
    var reduce = reduced();

    /* 换页后旧元素可能已被替换：把旧无限循环停掉，别留在脱离文档的节点上烧帧 */
    if (liveBg && liveBg !== bg) G.killTweensOf(liveBg);
    if (liveHiker && liveHiker !== hiker) G.killTweensOf(liveHiker);
    liveBg = bg; liveHiker = hiker;

    if (reduce) {
      G.set(bg, { scale: BASE_SCALE });
      if (hiker) G.set(hiker, { y: 0, opacity: 1 });
      return;                                   /* 减少动态效果：不呼吸、不视差 */
    }

    if (!played) {
      played = true;
      /* 底图不再淡入（会把背景透出来显得"闪"），只收一点点缩放 */
      var tl = G.timeline({ defaults: { ease: 'power2.out' } });
      tl.fromTo(bg, { scale: BASE_SCALE + 0.06 }, { scale: BASE_SCALE, duration: 2.4 });
      if (hiker) {
        tl.fromTo(hiker, { y: 42, opacity: 0 }, { y: 0, opacity: 1, duration: 1.6 }, '-=1.2');
      }
      tl.eventCallback('onComplete', function () { loops(bg, hiker); });
    } else {
      G.set(bg, { scale: BASE_SCALE });
      if (hiker) G.set(hiker, { y: 0, opacity: 1 });
      loops(bg, hiker);
    }
    bindTilt();
  }

  /* 手机倾斜视差：只动 x，幅度压在安全余留内（Android 免授权） */
  function bindTilt() {
    if (tiltBound || !g.gsap) return;
    tiltBound = true;
    if (!g.DeviceOrientationEvent || g.DeviceOrientationEvent.requestPermission) return;
    g.addEventListener('deviceorientation', function (e) {
      var bg = q('.home-scene .home-bg');
      if (!bg) return;
      var gamma = Math.max(-30, Math.min(30, e.gamma || 0));
      g.gsap.to(bg, { x: gamma * 0.32, duration: 1, ease: 'power2.out', overwrite: 'auto' });
    }, { passive: true });
  }

  /* ---------- 毛笔书写 ---------- */
  var CHARS = ['到', '此', '一', '游'];
  var dataCache = {};
  function loadChar(ch) {
    if (dataCache[ch]) return Promise.resolve(dataCache[ch]);
    var url = 'js/hanzi/data/' + encodeURIComponent(ch) + '.json';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('char ' + ch + ' HTTP ' + r.status);
      return r.json();
    }).then(function (d) { dataCache[ch] = d; return d; });
  }
  function hwLib() { return g.HanziWriter || g.hanziWriter; }

  /* hanzi-writer 只给 <svg> 设 width/height，不给 viewBox。我们用 CSS 把 svg 缩到
     几十像素时，浏览器就按 1:1 用户单位裁掉左上角——字看着"只剩几笔"或干脆空白。
     补一个 viewBox 让它整体缩放到容器里。 */
  function fixWriterSvg(div) {
    var svg = div && div.querySelector ? div.querySelector('svg') : null;
    if (!svg || svg.getAttribute('viewBox')) return;
    var w = parseFloat(svg.getAttribute('width')) || 200;
    var hgt = parseFloat(svg.getAttribute('height')) || 200;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hgt);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  /* 毛笔不可用时的退路：回到 F4 静态字 + 满格红线（口号由 app.js 打字机负责） */
  function fallbackText(h1) {
    if (!h1) return;
    h1.classList.remove('brush-mode');
    h1.style.setProperty('--p', 1);
    var span = h1.querySelector('[data-tw]');
    var caret = h1.querySelector('.tw-caret');
    if (g.gsap) g.gsap.set([span, caret], { clearProps: 'opacity' });
    else {
      if (span) span.style.opacity = '';
      if (caret) caret.style.opacity = '';
    }
  }

  function brushRun() {
    var h1 = q('.home-copy h1');
    var host = document.getElementById('homeWriter');
    if (!h1 || !host) return;
    if (brushState && brushState.h1 === h1) return;     /* 同一份 DOM，已在写 */
    Promise.all(CHARS.map(loadChar)).then(function (all) {
      if (all.some(function (d) { return !d; })) { fallbackText(h1); return; }
      if (!document.body.contains(h1)) return;          /* 期间已换页，别再动 */
      try { startBrush(h1, host, all); } catch (e) { fallbackText(h1); }
    }).catch(function () { fallbackText(h1); });
  }

  function startBrush(h1, host, dataList) {
    host.innerHTML = '';
    var writers = CHARS.map(function (ch, i) {
      var d = document.createElement('div');
      d.className = 'hw-char';
      host.appendChild(d);
      var w = hwLib().create(d, ch, {
        width: 200, height: 200, padding: 10,
        showCharacter: false, showOutline: false,
        strokeColor: '#1b1b1b',
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 45,
        charDataLoader: function (c, onLoad) { onLoad && onLoad(dataList[i]); }
      });
      fixWriterSvg(d);
      return w;
    });
    brushState = { h1: h1, host: host, writers: writers };
    var alive = function () { return document.body.contains(host) && document.body.contains(h1); };

    var splashEl = null;
    function setRule(n) { h1.style.setProperty('--p', (n / CHARS.length).toFixed(4)); }

    function splash() {
      if (!alive()) return;
      if (splashEl) splashEl.remove();
      splashEl = document.createElement('div');
      splashEl.className = 'ink-splash';
      splashEl.setAttribute('aria-hidden', 'true');
      splashEl.innerHTML =
        '<svg viewBox="0 0 120 120">' +
        '<path d="M60 26c16 3 26 15 24 30-1 13-13 22-27 21-12-1-21-9-21-21 0-9 5-13 3-21-2-8 8-12 21-9z" fill="#1b1b1b"/>' +
        '<circle cx="34" cy="86" r="4.5" fill="#1b1b1b"/>' +
        '<circle cx="92" cy="40" r="3.2" fill="#1b1b1b"/>' +
        '<circle cx="88" cy="92" r="2.6" fill="#1b1b1b"/>' +
        '<circle cx="30" cy="42" r="2.2" fill="#1b1b1b"/>' +
        '</svg>';
      host.appendChild(splashEl);
      g.gsap.fromTo(splashEl, { scale: 0, rotate: -20, opacity: 0 },
        { scale: 1, rotate: 0, opacity: 1, duration: 0.55, ease: 'elastic.out(1, 0.45)' });
      g.gsap.fromTo(splashEl.querySelectorAll('circle'), { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'back.out(3)', delay: 0.12 });
      g.gsap.to(splashEl, { opacity: 0, duration: 0.4, delay: 1.7, onComplete: function () {
        if (splashEl) { splashEl.remove(); splashEl = null; }
      }});
      setTimeout(function () { if (alive()) cycle(); }, 2600);
    }

    function cycle() {
      if (!alive()) return;
      setRule(0);
      writers.forEach(function (w) { try { w.hideCharacter({ duration: 0 }); } catch (e) {} });
      var i = 0;
      function step() {
        if (!alive()) return;
        if (i >= writers.length) { splash(); return; }
        writers[i].animateCharacter({
          duration: 1100, delayBetweenStrokes: 60,
          onComplete: function () {
            if (!alive()) return;
            i++;
            setRule(i);
            setTimeout(step, 110);
          }
        });
      }
      step();
    }

    /* 先让 F4 静态字淡出，再切毛笔模式：不是硬切，也不会两层字叠着 */
    var span = h1.querySelector('[data-tw]');
    var caret = h1.querySelector('.tw-caret');
    if (g.gsap && !reduced()) {
      g.gsap.to([span, caret], { opacity: 0, duration: 0.3, ease: 'power1.out' });
      setTimeout(function () {
        if (!alive()) return;
        h1.classList.add('brush-mode');
        cycle();
      }, 300);
    } else {
      h1.classList.add('brush-mode');
      cycle();
    }
  }

  /* ---------- 品牌三层 + DCYY ---------- */
  function brandFinal() {
    var brand = document.getElementById('homeBrand');
    if (!brand) return;
    var letters = Array.prototype.slice.call(brand.querySelectorAll('.bw'));
    var layers = brand.querySelectorAll('.logo-layer');
    if (g.gsap) {
      g.gsap.set(layers, { opacity: 1, x: 0, y: 0, scale: 1 });
      g.gsap.set(letters, { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, color: '#25283b' });
    } else {
      Array.prototype.forEach.call(layers, function (el) { el.style.opacity = 1; });
      letters.forEach(function (el) { el.style.opacity = 1; el.style.color = ''; });
    }
  }

  function brandPlay() {
    if (!g.gsap) { brandFinal(); return; }
    var brandNow = document.getElementById('homeBrand');
    if (reduced() || !brandNow || brandPlayedEl === brandNow) { brandFinal(); return; }
    killBrandLoops(brandNow);
    brandPlayedEl = brandNow;
    var brand = document.getElementById('homeBrand');
    var letters = Array.prototype.slice.call(brand.querySelectorAll('.bw'));
    var green = document.getElementById('logoGreen');
    var pink = document.getElementById('logoPink');
    var white = document.getElementById('logoWhite');
    var tl = g.gsap.timeline({ defaults: { ease: 'power2.out' } });
    /* 三块料 duang 出来：绿山先落地，粉山侧后跟上，白太阳最后弹一下 */
    if (green) tl.fromTo(green, { y: 28, scale: 0.82, opacity: 0 },
      { y: 0, scale: 1, opacity: 1, duration: 1.5, ease: 'elastic.out(1, 0.5)' }, 0);
    if (pink) tl.fromTo(pink, { x: 14, y: 20, scale: 0.86, opacity: 0 },
      { x: 0, y: 0, scale: 1, opacity: 1, duration: 1.5, ease: 'elastic.out(1, 0.5)' }, 0.2);
    if (white) tl.fromTo(white, { y: -26, scale: 0.6, opacity: 0 },
      { y: 0, scale: 1, opacity: 1, duration: 1.5, ease: 'bounce.out' }, 0.5);
    /* DCYY：拉伸出现 → 收缩回文本框 */
    letters.forEach(function (el, i) {
      el.style.color = i % 2 ? '#ff5298' : '#2fb47c';
      tl.fromTo(el, { opacity: 0, scaleY: 1.9, scaleX: 0.55, y: -4 },
        { opacity: 1, scaleY: 1, scaleX: 1, y: 0, duration: 1.4, ease: 'elastic.out(1, 0.4)' }, 0.2 + i * 0.18);
    });
    tl.to(letters, { color: '#25283b', duration: 0.8, ease: 'power1.out' }, '+=0.4');
    /* 动画收尾后交给极缓的呼吸，避免一下子完全静止 */
    tl.eventCallback('onComplete', function () {
      if (!document.body.contains(brand)) return;
      if (green) g.gsap.to(green, { scale: 1.02, duration: 4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      if (pink) g.gsap.to(pink, { scale: 1.015, duration: 4.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      if (white) g.gsap.to(white, { y: -2, duration: 2.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    });
  }

  /* ---------- 入口 ---------- */
  var pending = null;
  function home() {
    var canBrush = !!(hwLib() && !reduced());
    if (reduced()) brandFinal();                 /* 减少动态效果：直接落终态 */
    prime(canBrush);
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      if (!document.querySelector('.home-scene')) return;
      try {
        scene();
        brandPlay();
        if (canBrush) brushRun();
      } catch (e) {
        /* 兜底：任何异常都让页面回到"该有的样子"，不要停在半截动画上 */
        if (g.console && g.console.warn) g.console.warn('[home-anim]', e);
        brandFinal();
        try {
          var b = q('.home-scene .home-bg'), h = q('.home-scene .home-hiker');
          if (g.gsap) {
            if (b) g.gsap.set(b, { scale: BASE_SCALE });
            if (h) g.gsap.set(h, { y: 0, opacity: 1 });
          }
        } catch (e2) {}
      }
    }, 140);
    return canBrush;    /* 同步告诉 app.js：标题由毛笔接管（口号仍然要打字） */
  }

  /* ---------- 山头页「占山为王」标题：同一套毛笔 ---------- */
  var KING_CHARS = ['占', '山', '为', '王'];
  var kingWritten = false;

  function paintKingStatic(big, writers) {
    /* 重渲染后（翻页、筛选）直接落终态，别让标题空着 */
    writers.forEach(function (w) { try { w.showCharacter({ duration: 0 }); } catch (e) {} });
    if (big) big.classList.add('kk-brush');
  }

  function king() {
    var big = document.querySelector('.places-page .kk-big');
    var host = big && big.querySelector('[data-king-brush]');
    if (!big || !host) return false;
    if (!hwLib() || reduced()) return false;      /* 交给打字机 */
    if (host.getAttribute('data-busy') === '1') return true;
    host.setAttribute('data-busy', '1');
    big.classList.add('kk-brush');                /* 先把静态字藏起来，避免"先字后墨"两层 */
    Promise.all(KING_CHARS.map(loadChar)).then(function (all) {
      if (all.some(function (d) { return !d; })) { revive(); return; }
      if (!document.body.contains(host)) return;
      host.innerHTML = '';
      var writers = KING_CHARS.map(function (ch, i) {
        var d = document.createElement('div');
        d.className = 'hw-char kk-hw';
        host.appendChild(d);
        var w = hwLib().create(d, ch, {
          width: 200, height: 200, padding: 10,
          showCharacter: false, showOutline: false,
          strokeColor: '#1b1b1b',
          strokeAnimationSpeed: 1,
          delayBetweenStrokes: 55,
          charDataLoader: function (c, onLoad) { onLoad && onLoad(all[i]); }
        });
        fixWriterSvg(d);
        return w;
      });
      if (kingWritten) { paintKingStatic(big, writers); return; }
      kingWritten = true;
      var i = 0;
      function step() {
        if (!document.body.contains(host)) return;
        if (i >= writers.length) return;
        writers[i].animateCharacter({
          duration: 1000, delayBetweenStrokes: 55,
          onComplete: function () { i++; setTimeout(step, 90); }
        });
      }
      step();
    }).catch(function () { revive(); });

    /* 毛笔没起来（字库缺失/异常）：把静态字放回来，标题照常显示 */
    function revive() {
      if (!document.body.contains(big)) return;
      big.classList.remove('kk-brush');
      host.removeAttribute('data-busy');
      host.innerHTML = '';
      var span = big.querySelector('[data-king-tw]');
      if (span) span.textContent = KING_CHARS.join('');
    }
    return true;
  }

  g.HIKES_ANIM = { home: home, king: king };
})(window);
