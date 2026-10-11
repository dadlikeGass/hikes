/* hikes · 渲染工具：插画、图标、存储、弹层 */
(function (g) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hash(str) {
    var s = 2166136261;
    for (var i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
    return s >>> 0;
  }
  function rng(seed) {
    var a = hash(String(seed));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var PALETTES = [
    { sky: ['#FFE9C8', '#FFD09A', '#F4A97E', '#C4869A', '#6E6394'], ridges: ['#575278', '#423D61', '#2C2942'], sun: '#FFE0A0' },
    { sky: ['#EAF2F8', '#D3E2EC', '#AEC3D6', '#8897B2', '#5E6C8C'], ridges: ['#54607C', '#3F4A64', '#2B3349'], sun: '#F6FAFD' },
    { sky: ['#EDF4E7', '#D6E7CC', '#B2CCA4', '#89A87E', '#628067'], ridges: ['#456051', '#33503F', '#22392D'], sun: '#F8F4CC' },
    { sky: ['#FFDCC6', '#F5AE93', '#CE8189', '#8E5F80', '#4E3D66'], ridges: ['#41345B', '#302749', '#201A33'], sun: '#FFCE93' },
    { sky: ['#FFF4DA', '#FFE3AC', '#F6C27A', '#D49463', '#8E5F4E'], ridges: ['#5D4440', '#453031', '#2F2121'], sun: '#FFF3C4' },
    { sky: ['#E9E6FA', '#D3CDF2', '#B3A9E4', '#8C80CE', '#5E549E'], ridges: ['#4C4680', '#383369', '#26234A'], sun: '#F2EEFF' }
  ];

  /**
   * 生成一张"山景"插画（确定性：同一个 seed 永远长一样）
   * @param {string} seed
   * @param {{palette?:number, sun?:boolean, flat?:boolean}} [opt]
   */
  function scene(seed, opt) {
    opt = opt || {};
    var r = rng(seed);
    var pal = PALETTES[(opt.palette != null ? opt.palette : Math.floor(r() * PALETTES.length)) % PALETTES.length];
    var uid = 'g' + hash(String(seed)).toString(36);
    var W = 400, H = 300;
    var out = '<svg class="scene" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
    out += '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">';
    pal.sky.forEach(function (c, i) {
      out += '<stop offset="' + Math.round((i / (pal.sky.length - 1)) * 100) + '%" stop-color="' + c + '"/>';
    });
    out += '</linearGradient></defs>';
    out += '<rect width="' + W + '" height="' + H + '" fill="url(#' + uid + ')"/>';

    if (opt.sun !== false) {
      var sx = 90 + r() * 220, sy = 60 + r() * 70, sr = 16 + r() * 10;
      out += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + (sr * 3).toFixed(1) + '" fill="' + pal.sun + '" opacity=".26"/>';
      out += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + sr.toFixed(1) + '" fill="' + pal.sun + '"/>';
    }

    for (var k = 0; k < 3; k++) {
      var baseY = 150 + k * 48;
      var amp = 58 - k * 10;
      var n = 5 + Math.floor(r() * 3);
      var pts = [[0, baseY + (r() - 0.5) * amp * 0.7]];
      for (var i = 1; i <= n; i++) {
        var x = (W / n) * i - (r() * (W / n)) * 0.45;
        var y = baseY - Math.abs(r() * 2 - 1) * amp;
        pts.push([Math.max(0, x), Math.max(20, y)]);
      }
      pts.push([W, baseY + (r() - 0.5) * amp * 0.6]);
      var d = 'M0 ' + H + ' L' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L') + ' L' + W + ' ' + H + ' Z';
      out += '<path d="' + d + '" fill="' + pal.ridges[Math.min(k, pal.ridges.length - 1)] + '" opacity="' + (0.72 + k * 0.14).toFixed(2) + '"/>';
    }
    out += '</svg>';
    return out;
  }

  var ICONS = {
    book: 'M4 4.5h7v7H4zM13 4.5h7v7h-7zM4 13.5h7v6H4zM13 13.5h7v6h-7z',
    hill: 'M2 19.5 9 6.5l3.6 6.2 2.2-3.4 7.2 10.2z',
    scan: '<path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9"/><path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9"/><path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15"/><path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15"/><rect x="10" y="10" width="4" height="4" rx="1.2"/>',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z',
    me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 19a2 2 0 0 0 3 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.9a4.1 4.1 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>',
    clap: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 12V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 12V6a1.5 1.5 0 0 1 3 0v6"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-2"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7.5l8 5.5 8-5.5"/>',
    star: '<path d="M12 3.8l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 10l5.9-.9z"/>',
    hill2: '<path d="M3 19.5 10 8l4 6.5 2.5-3L21 19.5z"/><circle cx="17" cy="6" r="1.8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2v.2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h3"/>'
  };

  function icon(name, cls) {
    var body = ICONS[name] || '';
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }

  /* 难度标识：彩色形状 + 文字，形状颜色固定为 绿 / 蓝 / 深红 / 黑 */
  function levelMark(level, text) {
    var L = g.HIKES.levels[level];
    var svg = g.UI.shapeSVG ? g.UI.shapeSVG(level) : '';
    return '<span class="lvmark"><span class="lvshape">' + svg + '</span>' +
      (text === '' ? '' : esc(text || L.short)) + '</span>';
  }
  function levelBadge(level) {
    return '<span class="badge ' + level + '">' + levelMark(level) + '</span>';
  }

  function avatar(person, tone) {
    var p = typeof person === 'string' ? g.HIKES.people[person] : person;
    if (!p) p = { av: '山', tone: 'a1' };
    return '<span class="av ' + (tone || p.tone || 'a1') + '">' + esc(p.av) + '</span>';
  }

  /* ---- 本地存储 ---- */
  var KEY = 'hikes.v1.';
  function load(name, fallback) {
    try {
      var raw = localStorage.getItem(KEY + name);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(name, val) {
    try { localStorage.setItem(KEY + name, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
  }

  /* ---- DOM ---- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 1900);
  }

  function openSheet(html, center) {
    var mask = $('#mask'), sheet = $('#sheet');
    sheet.innerHTML = '<div class="handle"></div>' + html;
    mask.classList.toggle('center', !!center);
    mask.hidden = false;
    $('#view').style.overflow = 'hidden';
  }
  function closeSheet() {
    var mask = $('#mask');
    mask.hidden = true;
    $('#sheet').innerHTML = '';
    $('#view').style.overflow = '';
  }

  function go(hash) { location.hash = hash; }

  g.UI = {
    esc: esc, scene: scene, icon: icon, levelBadge: levelBadge, levelMark: levelMark, avatar: avatar,
    load: load, save: save, $: $, $$: $$, toast: toast, openSheet: openSheet,
    closeSheet: closeSheet, go: go
  };
})(window);
