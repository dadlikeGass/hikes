/* hikes · 轨迹渲染 / 难度图形 / 标牌 / 二维码 */
/*
  真实轨迹已经接进来了：js/routes.data.js（自动生成，内嵌抽稀后的 GPX）
  + js/routes.real.js（把线路/山头/岔路换成真实内容）。两者都在 data.js 之后、
  本文件之前加载，本文件再沿用 HIKES.gpxText。

  想换成别的轨迹，两种都行：
  1) 把 GPX/XML 内容贴进 HIKES.gpxText（键用路线 id）：
       HIKES.gpxText.mytrail = '<gpx><trk><trkseg><trkpt lat="31.02" lon="121.11"/>...</gpx>'
     支持 GPX 的 trkpt / rtept，也支持 KML/XML 的 coordinates。
     完整精度的原始文件在仓库根的 tracks/ 与 tracks/parks/。
  2) 有服务器时，把文件放到 app/tracks/<id>.gpx，再 fetch 进来替换：
       fetch('tracks/<id>.gpx').then(r => r.text()).then(t => HIKES.gpxText[id] = t)
     （file:// 直接打开时 fetch 会被浏览器拦住，所以默认走方案 1）
  解析出点之后，缩略轨迹图和距离都会自动跟着变。
*/
(function (g) {
  'use strict';

  /* 示例：这是一段真实 GPX（lat / lon / ele），可以直接替换成你导出的文件 */
  var XIGU_GPX = '<gpx><trk><trkseg>' +
    '<trkpt lat="30.2450" lon="120.1210"><ele>180</ele></trkpt>' +
    '<trkpt lat="30.2490" lon="120.1250"><ele>205</ele></trkpt>' +
    '<trkpt lat="30.2530" lon="120.1290"><ele>245</ele></trkpt>' +
    '<trkpt lat="30.2565" lon="120.1335"><ele>285</ele></trkpt>' +
    '<trkpt lat="30.2598" lon="120.1382"><ele>318</ele></trkpt>' +
    '<trkpt lat="30.2628" lon="120.1432"><ele>338</ele></trkpt>' +
    '<trkpt lat="30.2656" lon="120.1485"><ele>350</ele></trkpt>' +
    '<trkpt lat="30.2682" lon="120.1540"><ele>358</ele></trkpt>' +
    '<trkpt lat="30.2705" lon="120.1598"><ele>352</ele></trkpt>' +
    '<trkpt lat="30.2726" lon="120.1658"><ele>338</ele></trkpt>' +
    '<trkpt lat="30.2745" lon="120.1720"><ele>320</ele></trkpt>' +
    '<trkpt lat="30.2762" lon="120.1784"><ele>300</ele></trkpt>' +
    '</trkseg></trk></gpx>';

  /* 真实轨迹：js/routes.real.js 会先把 HIKES.gpxText 填好，这里就沿用它；
     单独跑演示数据时才回落到下面那段示例。 */
  var GPX_TEXTS = (g.HIKES && g.HIKES.gpxText) || { xigu: XIGU_GPX };
  g.HIKES.gpxText = GPX_TEXTS;

  function hash(str) {
    var s = 2166136261;
    for (var i = 0; i < String(str).length; i++) { s ^= String(str).charCodeAt(i); s = Math.imul(s, 16777619); }
    return s >>> 0;
  }
  function rng(seed) {
    var a = hash(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 解析 ---------- */
  function parseTrack(text) {
    if (!text || typeof text !== 'string') return null;
    var pts = [], re = /<(?:trkpt|rtept|wpt)\b[^>]*?lat\s*=\s*"([-\d.]+)"[^>]*?lon\s*=\s*"([-\d.]+)"/gi, m;
    while ((m = re.exec(text))) pts.push([parseFloat(m[2]), parseFloat(m[1])]);
    if (!pts.length) {
      var inner = /<coordinates>([\s\S]*?)<\/coordinates>/i.exec(text);
      if (inner) {
        inner[1].split(/\s+/).forEach(function (pair) {
          var v = pair.split(',');
          if (v.length >= 2 && !isNaN(+v[0]) && !isNaN(+v[1])) pts.push([+v[0], +v[1]]);
        });
      }
    }
    return pts.length >= 2 ? normalize(pts) : null;
  }

  function normalize(pts) {
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var dx = x1 - x0 || 1, dy = y1 - y0 || 1;
    return pts.map(function (p) { return [(p[0] - x0) / dx, 1 - (p[1] - y0) / dy]; });
  }

  function synth(id) {
    var r = rng('track:' + id), n = 9 + Math.floor(r() * 4);
    var pts = [[0.08 + r() * 0.06, 0.86]];
    for (var i = 1; i < n; i++) {
      pts.push([0.06 + 0.88 * (i / (n - 1)) + (r() - 0.5) * 0.12, 0.9 - 0.78 * (i / (n - 1)) + (r() - 0.5) * 0.3]);
    }
    return pts;
  }

  function getTrack(id) {
    if (GPX_TEXTS[id]) { var p = parseTrack(GPX_TEXTS[id]); if (p) return p; }
    if (g.HIKES.tracks && g.HIKES.tracks[id]) return g.HIKES.tracks[id];
    return synth(id);
  }
  function isReal(id) { return !!(GPX_TEXTS[id] && parseTrack(GPX_TEXTS[id])); }

  /* ---------- 缩放 ---------- */
  function fit(pts, W, H, pad) {
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var s = Math.min((W - pad * 2) / Math.max(1e-6, x1 - x0), (H - pad * 2) / Math.max(1e-6, y1 - y0));
    var ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    return pts.map(function (p) { return [(p[0] - x0) * s + ox, (p[1] - y0) * s + oy]; });
  }

  /* 轨迹缩略图：放在 .trk 容器里 */
  function trackSVG(id, opt) {
    opt = opt || {};
    var W = 200, H = 130;
    var pts = fit(getTrack(id), W, H, opt.pad != null ? opt.pad : 20);
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var stroke = opt.color || '#3455F5';
    var a = pts[0], b = pts[pts.length - 1];
    var out = '<svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    out += '<g fill="none" stroke="#E9E3D5" stroke-width="1">';
    [30, 56, 82, 108].forEach(function (y) {
      out += '<path d="M-10 ' + y + ' q 48 -11 96 0 t 124 0"/>';
    });
    out += '</g>';
    out += '<path d="' + d + '" fill="none" stroke="#D8E0F7" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';
    out += '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
    out += '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="5" fill="#fff"/>';
    out += '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="3.2" fill="#3455F5"/>';
    out += '<circle cx="' + b[0].toFixed(1) + '" cy="' + b[1].toFixed(1) + '" r="6" fill="#fff"/>';
    out += '<circle cx="' + b[0].toFixed(1) + '" cy="' + b[1].toFixed(1) + '" r="4.2" fill="#FF714E"/>';
    out += '</svg>';
    return out;
  }

  function trackBox(id, cls) {
    return '<span class="trk ' + (cls || 'trk-sm') + '" title="' +
      (isReal(id) ? '真实 GPX 轨迹' : '示例轨迹 · 把 GPX 放进 js/track.js 即替换') + '">' + trackSVG(id) + '</span>';
  }

  /* ---------- 难度图形：圆（绿）/ 三角（蓝）/ 菱形（深红）/ 六边形（黑·隐藏） ---------- */
  var SHAPE_COLOR = { easy: '#52B44A', mid: '#2563EB', hard: '#9E1B1B', hidden: '#22242E' };
  function shapeSVG(level) {
    var c = SHAPE_COLOR[level] || '#2563EB';
    var s = '<svg viewBox="0 0 100 100" aria-hidden="true">';
    if (level === 'easy') s += '<circle cx="50" cy="50" r="41" fill="' + c + '"/>';
    else if (level === 'mid') s += '<polygon points="50,10 92,87 8,87" fill="' + c + '" stroke="' + c + '" stroke-width="7" stroke-linejoin="round"/>';
    else if (level === 'hidden') s += '<polygon points="50,5 89,27 89,73 50,95 11,73 11,27" fill="' + c + '" stroke="' + c + '" stroke-width="5" stroke-linejoin="round"/>';
    else s += '<polygon points="50,6 94,50 50,94 6,50" fill="' + c + '" stroke="' + c + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '</svg>';
    return s;
  }

  /* ---------- 二维码占位图形（不是可扫的真码） ---------- */
  function qrSVG(text) {
    var N = 25, r = rng('qr:' + text), cells = [], i, j;
    function finder(x, y) {
      return '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="#22242E"/>' +
        '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#fff"/>' +
        '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="#22242E"/>';
    }
    for (i = 0; i < N; i++) {
      for (j = 0; j < N; j++) {
        var inFinder = (i < 8 && j < 8) || (i < 8 && j > N - 9) || (i > N - 9 && j < 8);
        if (inFinder || i === 6 || j === 6) continue;
        if (r() > 0.52) cells.push('<rect x="' + i + '" y="' + j + '" width="1" height="1" fill="#22242E"/>');
      }
    }
    for (var t = 8; t < N - 8; t++) {
      if (t % 2 === 0) {
        cells.push('<rect x="' + t + '" y="6" width="1" height="1" fill="#22242E"/>');
        cells.push('<rect x="6" y="' + t + '" width="1" height="1" fill="#22242E"/>');
      }
    }
    return '<svg viewBox="-1 -1 ' + (N + 2) + ' ' + (N + 2) + '" shape-rendering="crispEdges" aria-hidden="true">' +
      '<rect x="-1" y="-1" width="' + (N + 2) + '" height="' + (N + 2) + '" fill="#fff"/>' +
      cells.join('') + finder(0, 0) + finder(N - 7, 0) + finder(0, N - 7) + '</svg>';
  }

  /*
    实体标牌：左侧难度图形，图形下方是「DCYY | 海拔」，右边是二维码，
    底部一行小字注释 I HAVE BEEN HERE。
  */
  function signage(place, opt) {
    opt = opt || {};
    var level = place.level || opt.level || 'mid';
    var L = g.HIKES.levels[level];
    var code = place.code || opt.code || ('QSD-' + (place.seq || 100));
    var alt = place.alt ? (place.alt + 'M')
      : (place.km ? (place.km + 'KM') : (opt.alt || '—M'));
    return '<div class="signage">' +
      '<span class="signleft">' +
      '<span class="shape">' + shapeSVG(level) + '</span>' +
      '<span class="signcode">DCYY&nbsp;|&nbsp;' + alt + '</span>' +
      '</span>' +
      '<span class="signmid">' +
      '<span class="signlvl">' + L.short + ' · ' + L.en + '</span>' +
      '<span class="signorg">I HAVE BEEN HERE</span>' +
      '</span>' +
      '<span class="qrbox"><span class="qr">' + qrSVG(code) + '</span><span class="qrcap">示例二维码</span></span>' +
      '</div>';
  }

  /* ================= 坡度自动分段 ================= */

  /* 解析出点 + 海拔 */
  function parseFull(text) {
    if (!text) return null;
    var re = /<(?:trkpt|rtept)\b[^>]*?lat\s*=\s*"([-\d.]+)"[^>]*?lon\s*=\s*"([-\d.]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi, m;
    var pts = [], eles = [], has = false;
    while ((m = re.exec(text))) {
      pts.push([parseFloat(m[2]), parseFloat(m[1])]);
      var e = /<ele>\s*([-\d.]+)\s*<\/ele>/i.exec(m[3]);
      if (e) { eles.push(parseFloat(e[1])); has = true; } else { eles.push(0); }
    }
    if (pts.length < 2) return null;
    return { pts: pts, eles: has ? eles : null };
  }
  function norm01(a) {
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), d = mx - mn || 1;
    return a.map(function (v) { return (v - mn) / d; });
  }
  function trailOf(id) {
    return (g.HIKES.trails || []).filter(function (t) { return t.id === id; })[0] || {};
  }
  /* 没有海拔时，按 id 稳定生成一条"总体上升"的剖面 */
  function synthEle(id, n) {
    var r = rng('ele:' + id), a = [0], v = 0;
    for (var i = 1; i < n; i++) { v += 0.35 + r() * 0.9; a.push(v); }
    return norm01(a);
  }
  function trackData(id) {
    var t = trailOf(id), km = t.km || 5, up = t.up || 200, f;
    var gpx = GPX_TEXTS[id];
    if (gpx && (f = parseFull(gpx))) {
      /* eleSpan 是轨迹本身的海拔跨度。坡度要用它来还原真实高度差——
         用 up（总爬升）当比例会把环形线路的坡度放大 up/跨度 倍。 */
      var span = 0;
      if (f.eles) {
        var mn = Math.min.apply(null, f.eles), mx = Math.max.apply(null, f.eles);
        span = mx - mn;
      }
      return { pts: normalize(f.pts), eles: f.eles ? norm01(f.eles) : synthEle(id, f.pts.length),
        km: km, up: up, eleSpan: span || up, src: 'gpx', n: f.pts.length };
    }
    var pts = (g.HIKES.tracks && g.HIKES.tracks[id]) || synth(id);
    return { pts: pts, eles: synthEle(id, pts.length), km: km, up: up, eleSpan: up,
      src: 'demo', n: pts.length };
  }
  function cumDist(pts) {
    var c = [0], t = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      t += Math.sqrt(dx * dx + dy * dy); c.push(t);
    }
    return c;
  }

  /* 段落着色用坡度：≤15% 绿 · 15–25% 蓝 · >25% 红 */
  var GRADES = [
    { max: 15,  level: 'easy', color: '#52B44A' },
    { max: 25,  level: 'mid',  color: '#2563EB' },
    { max: 1e9, level: 'hard', color: '#9E1B1B' }
  ];
  function gradeOf(pct) { for (var i = 0; i < GRADES.length; i++) { if (pct <= GRADES[i].max) return GRADES[i]; } }

  /* 整条线路的难度 = 总爬升定基础 + 持续坡度只能往上拉 */
  var CLIMB_STEPS = [
    { max: 300, level: 'easy' },    /* 300 m 以内一定是简单 */
    { max: 900, level: 'mid' },
    { max: 1e9, level: 'hard' }     /* 只靠爬升到不了「隐藏」：隐藏只留给需要保护措施的地形 */
  ];
  var GRAD_STEPS = [
    { max: 15, level: 'easy' },
    { max: 25, level: 'mid' },
    { max: 1e9, level: 'hard' }
  ];
  var ORDER = ['easy', 'mid', 'hard', 'hidden'];
  function stepOf(steps, v) { for (var i = 0; i < steps.length; i++) { if (v <= steps[i].max) return steps[i].level; } }
  function climbLevel(up) { return stepOf(CLIMB_STEPS, up || 0); }
  function gradLevel(pct) { return stepOf(GRAD_STEPS, pct || 0); }

  /* 持续坡度：只认连续 ≥400 m 的段落，避免一小段陡坡把整条线路顶格 */
  function sustainedGradient(id) {
    var sg = segments(id), best = 0, longest = null;
    sg.segs.forEach(function (s) {
      if (!longest || s.km > longest.km) longest = s;
      if (s.km * 1000 >= 400) best = Math.max(best, s.pct);
    });
    return best || (longest ? longest.pct : 0);
  }
  function trailLevel(id) {
    var up = trailOf(id).up || 0;
    var a = ORDER.indexOf(climbLevel(up)), b = ORDER.indexOf(gradLevel(sustainedGradient(id)));
    return ORDER[Math.max(a, b)];
  }
  function levelBasis(id) {
    var t = trailOf(id), up = t.up || 0, grad = sustainedGradient(id);
    var L = g.HIKES.levels;
    function row(k, v, lv) {
      return '<div class="kv2"><span>' + k + '</span><b>' + v + ' → ' + L[lv].label + '</b></div>';
    }
    return '<div class="card" style="background:var(--blue-bg);box-shadow:none">' +
      '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:6px">难度是怎么算出来的</div>' +
      row('总爬升（基础）', up + ' m', climbLevel(up)) +
      row('持续坡度（往上拉）', Math.round(grad) + '%', gradLevel(grad)) +
      row('综合', '', trailLevel(id)) +
      '<div class="note" style="margin-top:10px;color:var(--blue-deep)">' +
      '爬升决定这条路"累不累"，坡度决定"险不险"。坡度只能把难度往上拉，不会往下拉——' +
      '坡度平缓但爬升 1200 m 的路，依然是一整天。需要保护措施时由山友反馈升级到隐藏档。</div></div>';
  }

  /** 把一条轨迹按坡度切成若干段，相邻同难度合并 */
  function segments(id) {
    var d = trackData(id), cd = cumDist(d.pts), total = cd[cd.length - 1] || 1;
    var raw = [];
    for (var i = 1; i < d.pts.length; i++) {
      var dm = (cd[i] - cd[i - 1]) / total * d.km * 1000;
      /* 用 eleSpan（轨迹的海拔跨度）还原真实高差；用 up 会把环形线路的坡度放大 up/跨度 倍 */
      var de = (d.eles[i] - d.eles[i - 1]) * (d.eleSpan || d.up);
      var pct = dm > 0 ? de / dm * 100 : 0;
      pct = Math.abs(pct);                    /* 下坡就是反向的爬坡，同权 */
      raw.push({ level: gradeOf(pct).level, pct: pct, de: de, km: dm / 1000,
        from: cd[i - 1] / total * d.km, to: cd[i] / total * d.km, a: i - 1, b: i });
    }
    var merged = [];
    raw.forEach(function (s) {
      var last = merged[merged.length - 1];
      if (last && last.level === s.level) {
        last.to = s.to; last.b = s.b; last.de += s.de; last.km += s.km;
      } else {
        merged.push({ level: s.level, pct: s.pct, de: s.de, km: s.km, from: s.from, to: s.to, a: s.a, b: s.b });
      }
    });
    merged.forEach(function (s, i) {
      s.pct = s.km > 0 ? Math.abs(s.de) / (s.km * 1000) * 100 : 0;
      var gr = gradeOf(s.pct);
      s.level = gr.level; s.color = gr.color; s.no = i + 1;
    });
    return { segs: merged, km: d.km, up: d.up, src: d.src, n: d.n, pts: d.pts, eles: d.eles, cd: cd };
  }

  /** 按段着色的轨迹图 */
  function gradientSVG(id, opt) {
    opt = opt || {};
    var W = 200, H = 130, sg = segments(id);
    var p = fit(sg.pts, W, H, opt.pad != null ? opt.pad : 20);
    var out = '<svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    out += '<g fill="none" stroke="#E9E3D5" stroke-width="1">';
    [30, 56, 82, 108].forEach(function (y) { out += '<path d="M-10 ' + y + ' q 48 -11 96 0 t 124 0"/>'; });
    out += '</g>';
    var full = p.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
    out += '<path d="' + full + '" fill="none" stroke="#E4E0D4" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>';
    sg.segs.forEach(function (s) {
      var seg = p.slice(s.a, s.b + 1);
      if (seg.length < 2) return;
      var d2 = seg.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
      out += '<path d="' + d2 + '" fill="none" stroke="' + s.color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    var st = p[0], en = p[p.length - 1];
    out += '<circle cx="' + st[0].toFixed(1) + '" cy="' + st[1].toFixed(1) + '" r="5" fill="#fff"/>' +
      '<circle cx="' + st[0].toFixed(1) + '" cy="' + st[1].toFixed(1) + '" r="3.2" fill="#3455F5"/>' +
      '<circle cx="' + en[0].toFixed(1) + '" cy="' + en[1].toFixed(1) + '" r="6" fill="#fff"/>' +
      '<circle cx="' + en[0].toFixed(1) + '" cy="' + en[1].toFixed(1) + '" r="4.2" fill="#FF714E"/>';
    return out + '</svg>';
  }

  /** 海拔剖面 + 底部按难度着色的色带 */
  function profileSVG(id) {
    var W = 320, H = 96, pad = 10;
    var sg = segments(id), n = sg.pts.length, total = sg.cd[n - 1] || 1;
    var xs = [], ys = [];
    for (var i = 0; i < n; i++) {
      xs.push(pad + (sg.cd[i] / total) * (W - pad * 2));
      ys.push(H - 20 - sg.eles[i] * (H - 34));
    }
    var line = xs.map(function (x, i) { return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1); }).join(' ');
    var area = line + ' L' + xs[n - 1].toFixed(1) + ' ' + (H - 14) + ' L' + xs[0].toFixed(1) + ' ' + (H - 14) + ' Z';
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
    out += '<path d="' + area + '" fill="#EDF1FD"/>';
    out += '<path d="' + line + '" fill="none" stroke="#3455F5" stroke-width="2" stroke-linejoin="round"/>';
    sg.segs.forEach(function (s) {
      var x0 = pad + (s.from / sg.km) * (W - pad * 2), x1 = pad + (s.to / sg.km) * (W - pad * 2);
      out += '<rect x="' + x0.toFixed(1) + '" y="' + (H - 11) + '" width="' + Math.max(1, x1 - x0).toFixed(1) +
        '" height="7" fill="' + s.color + '"/>';
    });
    return out + '</svg>';
  }

  function segRows(id) {
    var sg = segments(id);
    return sg.segs.map(function (s) {
      return '<div class="segrow"><span class="sq" style="background:' + s.color + '"></span>' +
        '<span class="sgno">第 ' + s.no + ' 段</span>' +
        '<span class="sgrange">' + s.from.toFixed(1) + '–' + s.to.toFixed(1) + ' km</span>' +
        '<span class="sgpct">' + Math.round(s.pct) + '%</span>' +
        g.UI.levelBadge(s.level) + '</div>';
    }).join('') +
      '<div class="note" style="padding:10px 2px 0">' +
      (sg.src === 'gpx' ? '来自 GPX 的 ' + sg.n + ' 个轨迹点' : '示例剖面') +
      '，按「爬升 / 距离」自动分段：≤15% 绿 · 15–25% 蓝 · &gt;25% 深红。</div>';
  }

  /* ================= 山顶识别 + 路段划分 =================
     重采样 → 平滑 → 找有相对高度的山顶 → 从山顶双向扩出爬升段 → 分段定级。
     结论只是"基础判断"，最终由维护人确认。
  */
  function routeParts(id, opt) {
    opt = opt || {};
    var stepM = opt.step || 100;          /* 重采样间隔 */
    var minPro = opt.prominence || 30;    /* 山顶相对高度门槛 */
    var d = trackData(id), cd = cumDist(d.pts), total = cd[cd.length - 1] || 1;
    var kmM = d.km * 1000, upM = d.eleSpan || d.up || 0;   /* 剖面用真实海拔跨度，不用总爬升 */
    var N = Math.max(10, Math.min(200, Math.round(kmM / stepM)));
    var xs = [], ys = [], k, q;
    for (k = 0; k < N; k++) {
      var t = k / (N - 1), j = 0;
      while (j < cd.length - 2 && cd[j + 1] / total < t) j++;
      var a = cd[j] / total, b = cd[j + 1] / total, f = b > a ? (t - a) / (b - a) : 0;
      xs.push(k * (kmM / (N - 1)) / 1000);
      ys.push((d.eles[j] + (d.eles[j + 1] - d.eles[j]) * f) * upM);
    }
    /* 5 点滑动平均：GPS 高程误差 ±5–10 m，不平滑的话坡度全是噪声 */
    var sm = ys.map(function (v, i) {
      var s = 0, n = 0;
      for (var z = -2; z <= 2; z++) { var p = i + z; if (p >= 0 && p < N) { s += ys[p]; n++; } }
      return s / n;
    });
    /* 相对高度（prominence）：向外走到更高的点为止，中间的最低点就是鞍部 */
    function prominence(p) {
      var lo = sm[p], l = p, r = p;
      while (l > 0 && sm[l - 1] <= sm[p]) { l--; if (sm[l] < lo) lo = sm[l]; }
      while (r < N - 1 && sm[r + 1] <= sm[p]) { r++; if (sm[r] < lo) lo = sm[r]; }
      return sm[p] - lo;
    }
    var cand = [];
    for (k = 1; k < N - 1; k++) if (sm[k] >= sm[k - 1] && sm[k] > sm[k + 1]) cand.push(k);
    var peaks = cand.map(function (p) { return { i: p, x: xs[p], y: sm[p], pro: prominence(p) }; })
      .filter(function (p) { return p.pro >= minPro; })
      .sort(function (p1, p2) { return p2.pro - p1.pro; });
    var kept = [];
    peaks.forEach(function (p) {
      if (!kept.some(function (q2) { return Math.abs(q2.x - p.x) < 0.5; })) kept.push(p);
    });
    kept.sort(function (p1, p2) { return p1.x - p2.x; });
    /* 从山顶向两侧扩：整段的平均坡度还 ≥5% 且净爬升 ≥30 m 就继续吃 */
    function extend(pi) {
      function walk(dir) {
        var cur = pi, best = pi;
        while (true) {
          var nx = cur + dir;
          if (nx < 0 || nx > N - 1) break;
          var lo = sm[pi], hi = sm[pi];
          for (var z = Math.min(nx, pi); z <= Math.max(nx, pi); z++) { lo = Math.min(lo, sm[z]); hi = Math.max(hi, sm[z]); }
          var dist = Math.abs(xs[nx] - xs[pi]) * 1000;
          var rise = sm[pi] - lo;
          if (!dist || rise < 30 || rise / dist * 100 < 5) break;
          best = nx; cur = nx;
        }
        return best;
      }
      return { a: walk(-1), b: walk(1) };
    }
    var marks = [];
    kept.forEach(function (p) {
      var e = extend(p.i);
      [e.a, p.i, e.b].forEach(function (v) { if (typeof v === 'number') marks.push(v); });
    });
    marks.push(0); marks.push(N - 1);
    marks = marks.filter(function (v, i2) { return marks.indexOf(v) === i2; }).sort(function (m1, m2) { return m1 - m2; });

    var raw = [];
    for (k = 0; k + 1 < marks.length; k++) {
      var i0 = marks[k], i1 = marks[k + 1];
      if (i1 - i0 < 1) continue;
      var dm = (xs[i1] - xs[i0]) * 1000, de = sm[i1] - sm[i0];
      var pct = dm > 0 ? de / dm * 100 : 0, ap = Math.abs(pct);
      var gr = gradeOf(ap);
      var isSummit = kept.some(function (p) { return p.i === i1; });
      var kind = pct > 3 ? 'climb' : (pct < -3 ? 'descend' : 'flat');
      raw.push({ from: xs[i0], to: xs[i1], km: xs[i1] - xs[i0], rise: de, pct: pct,
        level: gr.level, color: gr.color, kind: kind, summit: isSummit });
    }
    var parts = [];
    raw.forEach(function (s) {
      var last = parts[parts.length - 1];
      if (last && last.level === s.level && last.kind === s.kind && !last.summit && !s.summit) {
        last.to = s.to; last.km += s.km; last.rise += s.rise; last.summit = s.summit;
      } else { parts.push(Object.assign({}, s)); }
    });
    parts.forEach(function (s, i) {
      s.no = i + 1;
      s.pct = s.km > 0 ? s.rise / (s.km * 1000) * 100 : 0;
      var g2 = gradeOf(Math.abs(s.pct));
      s.level = g2.level; s.color = g2.color;
    });
    return { peaks: kept, parts: parts, km: d.km, up: d.up, src: d.src, n: d.n };
  }

  function partsHTML(id) {
    var r = routeParts(id);
    var KIND = { climb: '爬升', descend: '下降', flat: '平缓' };
    var heads = r.peaks.length
      ? r.peaks.map(function (p) { return '山坡 ' + p.x.toFixed(1) + ' km（相对高度 ' + Math.round(p.pro) + ' m）'; }).join(' · ')
      : '这条轨迹上没有找到 ≥30 m 相对高度的山顶';
    return '<div class="card" style="background:var(--bg);box-shadow:none;padding:12px 14px;margin-bottom:11px">' +
      '<div style="font-size:12px;font-weight:800;color:var(--ink2);margin-bottom:5px">自动识别到 ' +
      r.peaks.length + ' 个山顶</div>' +
      '<div class="note">' + heads + '</div></div>' +
      r.parts.map(function (s) {
        return '<div class="segrow"><span class="sq" style="background:' + s.color + '"></span>' +
          '<span class="sgno">' + (s.summit ? '登顶段' : KIND[s.kind]) + '</span>' +
          '<span class="sgrange">' + s.from.toFixed(1) + '–' + s.to.toFixed(1) + ' km</span>' +
          '<span class="sgpct">' + (s.pct > 0 ? '+' : '') + Math.round(s.pct) + '%</span>' +
          '</div>';
      }).join('') +
      '<div class="note" style="padding:10px 2px 0">规则：山顶 = 局部最高点且相对高度 ≥' +
      '30 m；从山顶向两侧扩，整段平均坡度 ≥5% 且净爬升 ≥30 m 就继续吃，跌破即停——那一点就是这一段爬升的起点。' +
      '下坡按反向爬坡同权计算。这只是基础判断，最终由维护人确认。</div>';
  }

  g.UI.trackSVG = trackSVG;
  g.UI.routeParts = routeParts;
  g.UI.partsHTML = partsHTML;
  g.UI.segments = segments;
  g.UI.gradientSVG = gradientSVG;
  g.UI.profileSVG = profileSVG;
  g.UI.segRows = segRows;
  g.UI.trackData = trackData;
  g.UI.trailLevel = trailLevel;
  g.UI.levelBasis = levelBasis;
  g.UI.sustainedGradient = sustainedGradient;
  g.UI.trackBox = trackBox;
  g.UI.shapeSVG = shapeSVG;
  g.UI.qrSVG = qrSVG;
  g.UI.signage = signage;
  g.UI.parseTrack = parseTrack;
  g.UI.isRealTrack = isReal;
})(window);
