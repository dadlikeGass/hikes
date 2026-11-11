/* 路书页动效（2026-10-26）
 *
 * 只做两件事，都围绕「把轨迹图和坡度图用起来」，不做装饰性乱飞：
 *
 *  1) 列表页卡片里的迷你轨迹图：卡片进入视口时，轨迹按段从左往右"描"出来
 *     （stroke-dashoffset 偏移），起点/终点圆点随后弹出；滚到哪张画哪张。
 *  2) 详情页：
 *     地形栅格淡入 → 轨迹按段落色描出来 → 山顶/CP 记号逐个弹出
 *     → 坡度图用裁剪矩形从左往右"长"出来（曲线、分段色带、山顶标、CP 虚线一起长）。
 *
 * 三条硬规则（宁可没动画，也不能把图弄没了）：
 *   · prefers-reduced-motion / 缺 GSAP / getTotalLength 不可用 → 一律不动，保持静态终态；
 *   · 所有长度先全部量完再改样式，量不出来就整段放弃；
 *   · 任何异常都被吞掉并还原虚线样式，页面退化成静态图。
 */
(function (g) {
  'use strict';
  function reduced() {
    if (/[?&]motion=1(&|$)/.test(g.location.search)) return false;
    return !!(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function nodes(list) { return Array.prototype.slice.call(list || []); }
  function mark(el) { try { el.setAttribute('data-mv', '1'); } catch (e) {} }
  function seen(el) { return el.getAttribute('data-mv') === '1'; }
  function isStroked(p) {
    var s = p.getAttribute('stroke');
    return !!s && s !== 'none';
  }

  /* 全部描边路径的长度；任何一个量不出来就地放弃（否则会把线画丢） */
  function strokedWithLens(svg) {
    var stroked = nodes(svg.querySelectorAll('path')).filter(isStroked);
    if (!stroked.length) return null;
    var lens = [];
    for (var i = 0; i < stroked.length; i++) {
      var len = 0;
      try { len = stroked[i].getTotalLength(); } catch (e) { len = 0; }
      if (!len || !isFinite(len)) return null;
      lens.push(len);
    }
    return { paths: stroked, lens: lens };
  }

  /* 按段描线：每段的起跑时间与自身长度成正比，整体的观感就是"一条线长出来" */
  function drawPaths(svg, dur) {
    var Gs = g.gsap;
    if (!Gs) return false;
    var info = strokedWithLens(svg);
    if (!info) return false;
    var total = info.lens.reduce(function (a, b) { return a + b; }, 0) || 1;
    var cum = 0;
    info.paths.forEach(function (p, i) {
      var len = info.lens[i];
      var delay = cum / total * dur;
      var span = Math.max(0.18, len / total * dur);
      cum += len;
      Gs.set(p, { strokeDasharray: len, strokeDashoffset: len });
      Gs.to(p, { strokeDashoffset: 0, duration: span, delay: delay, ease: 'power1.out' });
    });
    return true;
  }

  function clearDash(svg) {
    nodes(svg.querySelectorAll('path')).forEach(function (p) {
      p.style.strokeDasharray = '';
      p.style.strokeDashoffset = '';
    });
  }

  /* 记号逐个出现：圆点从 0 半径弹开（改 attr，不用 transform，缩放不受影响），
     CP 方块与文字淡入。 */
  function popMarkers(svg, delay, stagger) {
    var Gs = g.gsap;
    if (!Gs) return;
    nodes(svg.querySelectorAll('circle')).forEach(function (c, i) {
      var r = parseFloat(c.getAttribute('r')) || 4;
      Gs.fromTo(c, { attr: { r: 0 }, opacity: 0 },
        { attr: { r: r }, opacity: 1, duration: 0.4, ease: 'back.out(2.5)', delay: delay + i * stagger });
    });
    nodes(svg.querySelectorAll('rect[rx="2.5"]')).concat(nodes(svg.querySelectorAll('text')))
      .forEach(function (el, i) {
        Gs.fromTo(el, { opacity: 0 },
          { opacity: 1, duration: 0.35, ease: 'power1.out', delay: delay + 0.15 + i * stagger });
      });
  }

  /* ---------- 列表页：卡片迷你轨迹 ---------- */
  function drawCard(svg) {
    loadContours(svg);                 /* 卡片也叠一层精简等高线（滚到才拉） */
    try {
      if (!drawPaths(svg, 1.1)) return;
      var area = svg.querySelector('.trk-area');
      if (area) g.gsap.fromTo(area, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.16 });
      popMarkers(svg, 1.15, 0.07);
    } catch (e) {
      clearDash(svg);
    }
  }

  function list() {
    if (!g.gsap || reduced()) return;
    nodes(document.querySelectorAll('.trailcard svg')).forEach(function (svg) {
      if (seen(svg)) return;
      mark(svg);
      if (!g.IntersectionObserver) { drawCard(svg); return; }
      var io = new g.IntersectionObserver(function (ents) {
        for (var i = 0; i < ents.length; i++) {
          if (ents[i].isIntersecting) { io.disconnect(); drawCard(svg); return; }
        }
      }, { rootMargin: '60px 0px', threshold: 0.12 });
      io.observe(svg);
    });
  }

  /* ---------- 详情页：轨迹 + 坡度图 ---------- */
  function drawDetail(svg) {
    var Gs = g.gsap;
    try {
      var img = svg.querySelector('image');
      if (img) Gs.fromTo(img, { opacity: 0 }, { opacity: 0.8, duration: 1, ease: 'power1.out' });
      var ok = drawPaths(svg, 1.6);
      var area = svg.querySelector('.trk-area');
      if (area) Gs.fromTo(area, { opacity: 0 }, { opacity: 1, duration: 0.7, delay: ok ? 0.5 : 0 });
      if (ok) popMarkers(svg, 1.65, 0.09);
    } catch (e) {
      clearDash(svg);
    }
  }

  function growProfile(svg) {
    var Gs = g.gsap;
    var clip = svg.querySelector('.prof-clip');
    if (!clip) return;
    var full = parseFloat(clip.getAttribute('width')) || 0;
    if (!full) return;
    try {
      Gs.fromTo(clip, { attr: { width: 0 } }, { attr: { width: full }, duration: 1.5, ease: 'power2.out', delay: 0.1 });
    } catch (e) {
      clip.setAttribute('width', full);
    }
  }

  /* ---------- 矢量等高线：放大不糊，1.7× 以上再补一层细线 ---------- */
  var SVGNS = 'http://www.w3.org/2000/svg';

  function loadContours(svg) {
    var host = svg.querySelector('g.trk-contours');
    if (!host || host.getAttribute('data-loaded') === '1') return;
    var url = host.getAttribute('data-cs');
    if (!url) return;
    host.setAttribute('data-loaded', '1');
    fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) paintContours(svg, host, data); })
      .catch(function () {});                       /* 拿不到就没有等高线，不挡路 */
  }

  function paintContours(svg, host, data) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    /* 栅格是 preserveAspectRatio="none" 拉伸铺满 viewBox 的，所以 x/y 要分别换算
       （详情页 380×210 对 760×420 刚好都是 0.5，卡片 200×120 就不是了）。 */
    var ux = (vb && vb.width ? vb.width : 380) / (data.w || 760);
    var uy = (vb && vb.height ? vb.height : 210) / (data.h || 420);
    var s = data.scale || 2;
    function layer(list, minor) {
      list.forEach(function (entry) {
        var lines = entry[1] || [];
        var d = '';
        lines.forEach(function (pts) {
          for (var i = 0; i < pts.length; i += 2) {
            d += (i ? 'L' : 'M') + (pts[i] / s * ux).toFixed(2) + ' ' + (pts[i + 1] / s * uy).toFixed(2);
          }
        });
        if (!d) return;
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', minor ? '#709b93' : '#4f7d76');
        p.setAttribute('stroke-width', minor ? '0.4' : '0.75');
        p.setAttribute('stroke-opacity', minor ? '0.5' : '0.72');
        p.setAttribute('stroke-linejoin', 'round');
        /* 线宽不随缩放变粗：放大时是"看得更清"，不是"线变粗" */
        p.setAttribute('vector-effect', 'non-scaling-stroke');
        if (minor) p.setAttribute('class', 'minor');
        host.appendChild(p);
      });
    }
    try {
      layer(data.major || [], false);
      layer(data.minor || [], true);
    } catch (e) {}
  }

  /* ---------- 坡度图：进入视口才长出来 ----------
     原来在渲染时就播完 1.5s，用户还没滚到屏幕就结束了，看起来像"没有动画"。 */
  function watchProfile(svg) {
    if (!svg || seen(svg)) return;
    mark(svg);
    if (!g.gsap || reduced()) return;
    if (!g.IntersectionObserver) { growProfile(svg); return; }
    var io = new g.IntersectionObserver(function (ents) {
      for (var i = 0; i < ents.length; i++) {
        if (ents[i].isIntersecting) { io.disconnect(); growProfile(svg); return; }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.25 });
    io.observe(svg);
  }

  /* ---------- 坡度图交互：拖红点读海拔/里程 + 就地标注（存本机） ---------- */
  var NOTES_KEY = 'hikes.prof.notes.v1';
  function readNotes() {
    try { return JSON.parse(g.localStorage.getItem(NOTES_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeNotes(all) {
    try { g.localStorage.setItem(NOTES_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function notesOf(id) {
    var all = readNotes();
    return (all[id] || []).slice().sort(function (a, b) { return a.km - b.km; });
  }

  function setupProfile(svg) {
    if (!svg || svg.getAttribute('data-wired') === '1') return;
    var id = svg.getAttribute('data-prof-id');
    var geo = (g.HIKES_PROF || {})[id];
    if (!id || !geo || !geo.prof || geo.prof.length < 2) return;
    svg.setAttribute('data-wired', '1');

    var W = geo.W, H = geo.H, L = geo.L, R = geo.R, B = geo.B;
    var n = geo.n, span = (geo.max - geo.min) || 1, kmTotal = geo.km || 0;
    var stepKm = n > 1 ? kmTotal / (n - 1) : 0;
    function X(i) { return L + i / (n - 1) * (W - L - R); }
    function Y(v) { return H - B - (v - geo.min) / span * (H - geo.B - geo.T); }

    var box = svg.closest ? svg.closest('[data-profbox]') : null;
    var read = box && box.querySelector('[data-prof-read]');
    var addBtn = box && box.querySelector('[data-prof-add]');
    var form = box && box.querySelector('[data-prof-form]');
    var input = box && box.querySelector('[data-prof-input]');
    var noteList = box && box.querySelector('[data-prof-notes]');

    var cursor = document.createElementNS(SVGNS, 'g');
    cursor.setAttribute('class', 'prof-cursor');
    cursor.setAttribute('pointer-events', 'none');
    cursor.innerHTML = '<line class="pc-line"/><circle class="pc-dot" r="3.4"/>';
    svg.appendChild(cursor);
    cursor.setAttribute('hidden', '');
    var cLine = cursor.querySelector('.pc-line'), cDot = cursor.querySelector('.pc-dot');

    var pinLayer = document.createElementNS(SVGNS, 'g');
    pinLayer.setAttribute('class', 'prof-pins');
    pinLayer.setAttribute('pointer-events', 'none');
    svg.appendChild(pinLayer);

    var cur = null;      /* 当前红点：{i, km, alt} */
    var dragging = false;

    function xToIndex(clientX) {
      var rect = svg.getBoundingClientRect();
      if (!rect || !rect.width) return null;
      var ux = (clientX - rect.left) / rect.width * W;
      var t01 = (ux - L) / ((W - L - R) || 1);
      t01 = Math.max(0, Math.min(1, t01));
      return Math.round(t01 * (n - 1));
    }
    function showAt(i) {
      if (i == null || i < 0 || i >= n) return;
      var v = geo.prof[i];
      var km = stepKm * i;
      var i1 = Math.max(0, i - 1), i2 = Math.min(n - 1, i + 1);
      var dv = geo.prof[i2] - geo.prof[i1];
      var dkm = (i2 - i1) * stepKm;
      var pct = dkm > 0 ? dv / (dkm * 1000) * 100 : 0;
      var x = X(i), y = Y(v);
      cLine.setAttribute('x1', x.toFixed(1)); cLine.setAttribute('x2', x.toFixed(1));
      cLine.setAttribute('y1', geo.T.toFixed(1)); cLine.setAttribute('y2', (H - B).toFixed(1));
      cDot.setAttribute('cx', x.toFixed(1)); cDot.setAttribute('cy', y.toFixed(1));
      cursor.removeAttribute('hidden');
      cur = { i: i, km: km, alt: v };
      if (read) {
        read.textContent = km.toFixed(1) + ' km · 海拔 ' + Math.round(v) + ' m · 坡度 ' +
          (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%';
      }
      if (addBtn) addBtn.disabled = false;
    }
    function hideCursor() {
      if (dragging) return;
      cursor.setAttribute('hidden', '');
    }

    svg.addEventListener('pointerdown', function (e) {
      var i = xToIndex(e.clientX);
      if (i == null) return;
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      showAt(i);
      if (e.cancelable) e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      if (!dragging && e.pointerType !== 'mouse') return;   /* 手机上只在按下时跟踪，别抢页面滚动 */
      var i = xToIndex(e.clientX);
      if (i != null) showAt(i);
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      svg.addEventListener(ev, function () { dragging = false; });
    });
    svg.addEventListener('pointerleave', function () { dragging = false; hideCursor(); });

    /* --- 标注：存本机（localStorage），刷新后还在；不冒充全站共享数据 --- */
    function renderPins() {
      while (pinLayer.firstChild) pinLayer.removeChild(pinLayer.firstChild);
      if (noteList) noteList.innerHTML = '';
      var arr = notesOf(id);
      arr.forEach(function (note, k) {
        var km = note.km || 0;
        var i = stepKm > 0 ? Math.round(km / stepKm) : 0;
        if (i < 0 || i >= n) return;
        var v = geo.prof[i];
        var g1 = document.createElementNS(SVGNS, 'g');
        var c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', X(i).toFixed(1));
        c.setAttribute('cy', Y(v).toFixed(1));
        c.setAttribute('r', '3.6');
        c.setAttribute('fill', '#2563EB');
        c.setAttribute('stroke', '#fff');
        c.setAttribute('stroke-width', '1');
        var t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', X(i).toFixed(1));
        t.setAttribute('y', (Y(v) + 1.7).toFixed(1));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '4.6');
        t.setAttribute('font-weight', '800');
        t.setAttribute('fill', '#fff');
        t.textContent = String(k + 1);
        g1.appendChild(c); g1.appendChild(t);
        pinLayer.appendChild(g1);

        if (!noteList) return;
        var row = document.createElement('div');
        row.className = 'prof-note';
        var head = document.createElement('b');
        head.textContent = (k + 1) + '. ' + Number(km).toFixed(1) + ' km · ' +
          Math.round(note.alt || v) + ' m';
        var txt = document.createElement('span');
        txt.textContent = note.text || '';
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'prof-note-del';
        del.textContent = '删除';
        del.addEventListener('click', function () {
          var all = readNotes();
          all[id] = (all[id] || []).filter(function (x) { return x.ts !== note.ts; });
          writeNotes(all);
          renderPins();
        });
        row.appendChild(head); row.appendChild(txt); row.appendChild(del);
        noteList.appendChild(row);
      });
    }
    renderPins();

    if (addBtn) addBtn.addEventListener('click', function () {
      if (!cur || !form) return;
      form.removeAttribute('hidden');
      if (input) { input.value = ''; input.focus(); }
    });
    if (form) {
      var save = form.querySelector('[data-prof-save]');
      var cancel = form.querySelector('[data-prof-cancel]');
      if (save) save.addEventListener('click', function () {
        var text = input ? String(input.value || '').trim().slice(0, 40) : '';
        if (!text || !cur) return;
        var all = readNotes();
        all[id] = (all[id] || []).concat([{
          km: Number(cur.km.toFixed(2)), alt: Math.round(cur.alt), text: text, ts: Date.now()
        }]);
        writeNotes(all);
        form.setAttribute('hidden', '');
        renderPins();
      });
      if (cancel) cancel.addEventListener('click', function () { form.setAttribute('hidden', ''); });
    }
  }

  /* 地形图先用底图，空闲时把 @2x 预取好：一放大就是清的了，不用等 */
  function prefetchHi(svg) {
    var hi = svg.querySelector && svg.querySelector('.trk-terrain-hi');
    if (!hi || hi.getAttribute('href')) return;
    var url = hi.getAttribute('data-src2');
    if (!url) return;
    setTimeout(function () {
      if (!hi.isConnected) return;
      var base = svg.querySelector('.trk-terrain');
      hi.setAttribute('data-q', '2');
      hi.addEventListener('load', function () {
        hi.style.opacity = (base && base.getAttribute('opacity')) || '.8';
      }, { once: true });
      hi.setAttribute('href', url);
    }, 900);
  }

  function detail() {
    var svg = document.querySelector('.tracewrap svg');
    if (svg) {
      loadContours(svg);
      prefetchHi(svg);
      if (!seen(svg)) { mark(svg); if (g.gsap && !reduced()) drawDetail(svg); }
    }
    var prof = document.querySelector('.profilebox svg');
    if (prof) { watchProfile(prof); setupProfile(prof); }
  }

  g.HIKES_TRAIL_MOTION = { list: list, detail: detail };
})(window);
