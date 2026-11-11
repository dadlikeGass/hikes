/* 山头页「登顶记录板」：机场航班牌（split-flap）效果（2026-10-26 第二版）
 *
 * 一座山（默认香山）、两个 tab，都是列表形态：
 *   · 登顶记录：/api/peaks/leaderboard ?codes=<code> → 名次 / 用户 / 用时 / 日期
 *   · 最近登顶：/api/visits/recent ?code=<code>       → 用户 / 时间 / 用时 / 地点
 * 每 30 秒自动刷新；数据一变就按翻牌节奏更新（旧值翻下去 → 换字 → 翻回来），
 * 不是整块闪一下。切 tab、页面切到后台都不白刷（回来后补一次）。
 *
 * 还没有真实记录时用 ★ 示例行占位（站内既有口径），页脚写明；真实数据到了自动替换。
 */
(function (g) {
  'use strict';
  var REFRESH_MS = 30000;
  var SHOW_SAMPLE = true;      /* 没有任何真实记录时用 ★ 示例占位 */

  var boardEl = null;
  var timer = null;
  var bound = null;            /* 已经绑过事件的看板节点 */
  var tab = 'records';
  var data = { records: null, recent: null };
  var sig = { records: '', recent: '' };
  var updatedAt = null;
  var busy = false;

  function peak() { return g.HIKES_FLAP_PEAK || null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hash(code) {
    var s = String(code || 'x'), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function fmtDur(sec) {
    if (sec === null || sec === undefined || sec === '') return '—';
    var n = Number(sec);
    if (!isFinite(n)) return '—';
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    if (h) return h + ' 时 ' + (m < 10 ? '0' + m : m) + ' 分';
    if (m) return m + ' 分 ' + (s < 10 ? '0' + s : s) + ' 秒';
    return s + ' 秒';
  }
  function fmtWhen(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    var now = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
  }
  function fmtDate(v) {
    if (!v) return '—';
    return String(v).slice(0, 10) || '—';
  }

  /* ---------- 取数 ---------- */
  function loadRecords(p) {
    if (!(g.API && g.API.peaksLeaderboard)) { data.records = []; return Promise.resolve(); }
    return g.API.peaksLeaderboard(p.code).then(function (d) {
      var items = (d && d.items) || {};
      data.records = (items[p.code] || []).map(function (r) {
        return { who: r.nickname || '山友', dur: r.durationS, date: r.date };
      });
    }).catch(function () { data.records = []; });
  }
  function loadRecent(p) {
    return fetch('/api/visits/recent?days=30&limit=20&code=' + encodeURIComponent(p.code),
      { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        data.recent = (Array.isArray(list) ? list : []).map(function (v) {
          return { who: v.who || '山友', at: v.at, dur: v.duration_sec, place: v.place || '' };
        });
      })
      .catch(function () { data.recent = []; });
  }
  function load(which, p) {
    return which === 'records' ? loadRecords(p) : loadRecent(p);
  }

  /* ---------- 示例行（全部带 ★） ---------- */
  var SAMPLE_WHO = ['山友一', '山友二', '山友三', '老王', '阿岩', '小林'];
  function sampleRecords(p) {
    var h = hash(p.code);
    return [0, 1, 2].map(function (i) {
      return {
        rank: i + 1,
        who: SAMPLE_WHO[(h + i * 2) % SAMPLE_WHO.length],
        dur: fmtDur(3900 + ((h >>> (i + 1)) % 4200)),
        date: '示例',
        star: true
      };
    });
  }
  function sampleRecent(p) {
    var h = hash(p.code + 'r');
    var whens = ['今天 08:12', '昨天 16:20', '2 天前 09:15'];
    var out = [];
    for (var i = 0; i < 3; i++) {
      out.push({
        who: SAMPLE_WHO[(h + i * 2 + 1) % SAMPLE_WHO.length],
        when: whens[i],
        dur: fmtDur(3900 + ((h >>> (i + 2)) % 3600)),
        place: p.name || '山头',
        star: true
      });
    }
    return out;
  }

  function columns(which) {
    return which === 'records' ? ['名次', '用户', '用时', '日期'] : ['用户', '时间', '用时', '地点'];
  }

  function rowsOf(which) {
    var p = peak() || {};
    if (which === 'records') {
      var list = data.records;
      if (list === null) return null;
      if (!list.length) return SHOW_SAMPLE ? sampleRecords(p) : [];
      return list.map(function (r, i) {
        return { rank: i + 1, who: r.who, dur: fmtDur(r.dur), date: fmtDate(r.date) };
      });
    }
    var rec = data.recent;
    if (rec === null) return null;
    if (!rec.length) return SHOW_SAMPLE ? sampleRecent(p) : [];
    return rec.map(function (r) {
      return { who: r.who, when: fmtWhen(r.at), dur: fmtDur(r.dur), place: r.place };
    });
  }

  function rowHTML(which, r) {
    var cells = which === 'records'
      ? ['<span class="fb-rank">' + (r.rank || '·') + '</span>', r.who, r.dur, r.date]
      : [r.who, r.when, r.dur, r.place];
    return '<div class="fb-row">' + cells.map(function (c, i) {
      var cls = 'fb-cell' + (i === 0 && which === 'records' ? ' fb-c1' : '');
      return '<span class="' + cls + '"><i class="fb-v">' + c + '</i></span>';
    }).join('') + (r.star ? '<b class="fb-star" aria-label="示例数据">★</b>' : '') + '</div>';
  }

  function bodyHTML(which, rows) {
    if (rows === null) return '<div class="fb-empty">读取中…</div>';
    if (!rows.length) {
      var nm = esc((peak() || {}).name || '这座山');
      return '<div class="fb-empty">' + (which === 'records'
        ? '还没有人在' + nm + '留下登顶用时。' : '最近 30 天还没有登顶打卡。') + '</div>';
    }
    return rows.map(function (r) { return rowHTML(which, r); }).join('');
  }

  function signatureOf(which, rows) {
    if (rows === null) return 'loading';
    return JSON.stringify(rows.map(function (r) {
      return [r.rank || 0, r.who, r.dur || '', r.date || r.when || ''].join('|');
    }));
  }

  /* ---------- 渲染 ---------- */
  function paintStamp() {
    var el = boardEl && boardEl.querySelector('[data-flap-stamp]');
    if (!el) return;
    var hm = updatedAt
      ? ('0' + updatedAt.getHours()).slice(-2) + ':' + ('0' + updatedAt.getMinutes()).slice(-2)
      : '--:--';
    el.textContent = '更新于 ' + hm + ' · 30 秒自动刷新';
  }

  /* 翻牌：先把当前字翻下去 → 换内容 → 翻回来（整行错开几毫秒） */
  function flipCells(root, html) {
    var cells = root.querySelectorAll('.fb-cell');
    Array.prototype.forEach.call(cells, function (c) { c.classList.add('is-flip'); });
    setTimeout(function () {
      root.innerHTML = html;
      var next = root.querySelectorAll('.fb-cell');
      Array.prototype.forEach.call(next, function (c, i) {
        c.classList.add('is-flip');
        setTimeout(function () { c.classList.remove('is-flip'); }, 18 + (i % 8) * 26);
      });
    }, 140);
  }

  function paint(mode) {
    if (!boardEl) return;
    var rowsEl = boardEl.querySelector('[data-flap-rows]');
    var colsEl = boardEl.querySelector('[data-flap-cols]');
    var rows = rowsOf(tab);
    var html = bodyHTML(tab, rows);
    if (colsEl) {
      colsEl.innerHTML = columns(tab).map(function (c) { return '<span>' + c + '</span>'; }).join('');
    }
    if (mode === 'flip' && rowsEl && rowsEl.querySelector('.fb-row')) flipCells(rowsEl, html);
    else if (rowsEl) rowsEl.innerHTML = html;
    Array.prototype.forEach.call(boardEl.querySelectorAll('[data-flap-tab]'), function (b) {
      var on = b.getAttribute('data-flap-tab') === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var foot = boardEl.querySelector('[data-flap-foot]');
    if (foot) {
      var sample = !!(rows && rows.length && rows[0].star);
      foot.innerHTML = sample
        ? '★ 为示例数据；有人在这里打卡后会自动换成真实记录。'
        : '实时看板：每 30 秒刷新一次，有新登顶就会翻牌更新。';
    }
    paintStamp();
  }

  /* ---------- 刷新 ---------- */
  function refresh(which, opts) {
    var p = peak();
    if (!p || !p.code) return Promise.resolve();
    var mode = (opts && opts.mode) || 'auto';
    if (busy) return Promise.resolve();
    busy = true;
    return load(which, p).then(function () {
      busy = false;
      var rows = rowsOf(which);
      var next = signatureOf(which, rows);
      var changed = next !== sig[which];
      sig[which] = next;
      updatedAt = new Date();
      if (which === tab) paint(changed && mode !== 'quiet' ? 'flip' : 'quiet');
    }).catch(function () { busy = false; });
  }

  function tick() {
    if (!boardEl || !document.documentElement.contains(boardEl)) { stop(); return; }
    if (document.hidden) return;      /* 后台标签页不刷，回到前台时补一次 */
    refresh(tab);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function mount() {
    var el = document.querySelector('[data-flap]');
    if (!el) { stop(); boardEl = null; bound = null; return; }
    boardEl = el;
    if (bound === el) return;         /* 同一个看板已经绑过，别重复挂事件 */
    bound = el;
    stop();
    var p = peak();
    if (!p || !p.code) {
      var rowsEl = el.querySelector('[data-flap-rows]');
      if (rowsEl) rowsEl.innerHTML = '<div class="fb-empty">还没有可展示的山头数据。</div>';
      return;
    }
    tab = 'records';
    data = { records: null, recent: null };
    sig = { records: '', recent: '' };
    el.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var t = e.target.closest('[data-flap-tab]');
      if (t && el.contains(t)) {
        var next = t.getAttribute('data-flap-tab');
        if (next === tab) return;
        tab = next;
        paint('quiet');
        refresh(tab, { mode: 'quiet' });
        return;
      }
      if (e.target.closest('[data-flap-refresh]') && el.contains(e.target)) refresh(tab);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && boardEl && document.documentElement.contains(boardEl)) {
        refresh(tab, { mode: 'quiet' });
      }
    });
    paint('quiet');
    refresh('records');
    timer = setInterval(tick, REFRESH_MS);
  }

  g.HIKES_FLAP = { mount: mount };
})(window);
