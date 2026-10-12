/* 到此一游 HIKERS —— 路由、页面与交互 */
(function () {
  'use strict';
  var H = window.HIKES, U = window.UI, esc = U.esc;

  /* ==================== 状态 ==================== */
  var S = {
    visited: U.load('visited', H.visitedSeed.slice()),
    want: U.load('want', H.wantSeed.slice()),
    joined: U.load('joined', []),
    claps: U.load('claps', {}),
    myComments: U.load('myComments', {}),
    myIntel: U.load('myIntel', []),
    intelUp: U.load('intelUp', {}),
    letters: U.load('letters', []),
    friends: U.load('friends', {}),
    pb: U.load('pb', { dongling: '03:05' }),
    mySeqs: U.load('mySeqs', {}),
    myActs: U.load('myActs', []),
    segFb: U.load('segFb', {}),
    mySegFb: U.load('mySegFb', {})
  };
  function persist() {
    ['visited', 'want', 'joined', 'claps', 'myComments', 'myIntel', 'intelUp',
      'letters', 'friends', 'pb', 'mySeqs', 'myActs', 'segFb', 'mySegFb'].forEach(function (k) { U.save(k, S[k]); });
  }
  window.APP_S = S;          /* 让 api.js 把后端数据灌进来 */

  /* ==================== 查询 ==================== */
  function trail(id) { return H.trails.filter(function (t) { return t.id === id; })[0]; }
  function peak(id) { return H.peaks.filter(function (p) { return p.id === id; })[0]; }
  function junction(id) { return H.junctions.filter(function (j) { return j.id === id; })[0]; }
  function isWant(id) { return S.want.indexOf(id) >= 0; }
  function beenThere(id) { return S.visited.some(function (v) { return v.id === id; }); }
  function commentsFor(id) {
    var mine = (S.myComments[id] || []).map(function (c) {
      return { who: 'me', when: c.when, text: c.text, mine: true };
    });
    var base = [];
    var p = peak(id); if (p && p.comments) base = base.concat(p.comments);
    var t = trail(id); if (t && t.comments) base = base.concat(t.comments);
    return mine.concat(base);
  }
  function intelFor(j) {
    var extra = S.myIntel.filter(function (i) { return i.jid === j.id; }).map(function (i) {
      return { id: i.id, who: 'me', when: '刚刚', ok: false, title: i.title, text: i.text, confirm: 1, mine: true };
    });
    return extra.concat(j.intel);
  }
  function placeOf(type, id) {
    if (type === 'peak') return peak(id);
    if (type === 'junction') return junction(id);
    if (type === 'trail') return trail(id);
    return null;
  }
  function personByName(name) {
    if (name === '你' || name === '我') return H.me;
    var byId = Object.keys(H.people).map(function (k) { return H.people[k]; })
      .filter(function (p) { return p.name === name; })[0];
    var hit = byId || H.peoples.filter(function (p) { return p.name === name; })[0];
    return hit || { name: name, av: String(name).slice(0, 1), tone: 'a4' };
  }
  function linkTo(p) {
    if (p.type === 'me') return '#/me/' + p.id;          /* 山间信箱 / 我的山头 这类"回到我自己"的上下文 */
    return p.type === 'peak' ? '#/peaks/' + p.id : p.type === 'junction' ? '#/junctions/' + p.id : '#/trails/' + p.id;
  }

  /* ==================== 片段 ==================== */
  function rankRows(rows, opts) {
    opts = opts || {};
    return rows.map(function (r, i) {
      var mine = r.mine || r.who === '我';
      return '<div class="rank' + (i === 0 ? ' p1' : '') + (mine ? ' me' : '') + '">' +
        '<span class="pos">' + (r.pos || i + 1) + '</span>' +
        (r.thumb ? '<span class="thumb">' + U.scene(r.thumb) + '</span>' : (r.av ? U.avatar(r.av) : '')) +
        '<span class="nm"><b>' + esc(r.name || r.who) + '</b><em>' + esc(r.sub || r.when || '') + '</em></span>' +
        (r.right ? '<span class="tm" style="font-size:12px;color:var(--ink3)">' + esc(r.right) + '</span>'
          : '<span class="tm"' + (opts.tmSmall ? ' style="font-size:12px"' : '') + '>' + esc(r.time || '') + '</span>') +
        '</div>';
    }).join('');
  }

  function postCard(p) {
    var person = H.people[p.who];
    var clapped = !!S.claps[p.id];
    return '<div class="item">' +
      '<div class="ph" style="height:' + p.h + 'px">' + U.scene(p.place.id) +
      (p.seq ? '<span class="seq">' + esc(p.seq) + '</span>' : '') + '</div>' +
      '<div class="body">' +
      '<div class="who">' + U.avatar(person) + esc(person.name) + ' · ' + esc(p.when) + '</div>' +
      '<div class="txt">' + esc(p.text) + '</div>' +
      '<a class="place" href="' + linkTo(p.place) + '">' + esc(p.place.name) + ' ›</a>' +
      '<div class="foot">' +
      '<button class="clap' + (clapped ? ' on' : '') + '" data-act="clap" data-id="' + p.id + '">' +
      U.icon('clap', 's') + ' 击掌 <b>' + (p.claps + (clapped ? 1 : 0)) + '</b></button>' +
      '<span>' + U.icon('chat', 's') + ' ' + p.comments + '</span>' +
      '</div></div></div>';
  }

  function trailCard(t) {
    var lv = U.trailLevel(t.id);
    return '<div class="trailcard">' +
      '<div class="tc-top">' +
      '<a class="tc-name" href="#/trails/' + t.id + '">' + esc(t.name) + '</a>' +
      '<button class="favbtn flat" data-act="want" data-id="' + t.id + '" data-on="♥" data-off="♡">' +
      (isWant(t.id) ? '♥' : '♡') + '</button></div>' +
      '<div class="tc-mid">' + U.trackBox(t.id, 'trk-tc') +
      '<div class="tc-stats">' +
      '<div class="tcs"><span>六只脚人气</span><b>' + t.visits7 + '</b></div>' +
      '<div class="tcs"><span>参考用时</span><b class="hi">' + t.fastest.time + '</b></div>' +
      '<div class="tcs"><span>' + (t.group === 'park' ? '类型' : '区域') + '</span><b class="who">' + esc(t.group === 'park' ? '公园跑道' : t.region) + '</b></div>' +
      '</div></div>' +
      '<div class="tc-bot"><span class="tc-dim">' + t.km + ' km · ↗ ' + t.up + ' m</span>' +
      U.levelBadge(lv) + '</div>' +
      '</div>';
  }

  function compactRow(o) {
    return '<div class="rank">' +
      (o.pos != null ? '<span class="pos">' + o.pos + '</span>' : '') +
      (o.thumb ? U.trackBox(o.thumb, 'trk-xs') : '') +
      '<span class="nm"><b>' + esc(o.title) + '</b><em>' + esc(o.sub) + '</em></span>' +
      '<span class="tm" style="font-size:12px">' + (o.level ? U.levelBadge(o.level) : esc(o.right)) + '</span></div>';
  }

  function intelCard(i, jid) {
    var up = !!S.intelUp[i.id];
    var person = H.people[i.who] || { name: '山友', av: '山', tone: 'a4' };
    return '<div class="intel' + (i.ok ? ' ok' : '') + '">' +
      '<div class="hd">' + U.avatar(person) + esc(person.name) +
      (i.by ? ' · ' + esc(i.by) : '') + (i.when ? ' · ' + esc(i.when) : '') +
      '<span class="tag ' + (i.ok ? 'ok' : 'wait') + '">' + (i.ok ? '已核验' : '待核验') + '</span></div>' +
      '<b class="t">' + esc(i.title) + '</b><p>' + esc(i.text) + '</p>' +
      '<div class="foot"><button data-act="intel-up" data-id="' + i.id + '" class="' + (up ? 'on' : '') + '">' +
      (up ? '✓ 你已确认' : '我也遇到了') + '</button>' +
      '<span>' + (i.confirm + (up ? 1 : 0)) + ' 人确认</span>' +
      '<span style="margin-left:auto">' + esc(i.when || '') + '</span></div></div>';
  }

  function commentCard(c) {
    var person = c.who === 'me' ? H.me : H.people[c.who];
    return '<div class="comment"><div class="ph">' + U.avatar(person, c.who === 'me' ? 'a1' : null) +
      esc(person.name) + ' · ' + esc(c.when) + (c.mine ? ' · 我发的' : '') + '</div>' +
      '<p>' + esc(c.text) + '</p></div>';
  }

  /* ==================== 首页 ==================== */
  function homeView() {
    var hot = H.trails.slice().sort(function (a, b) { return b.visits7 - a.visits7; }).slice(0, 4);
    var acts = S.myActs.concat(H.activities);
    var act = acts[0];
    var actPerson = H.people[act.host] || H.me;
    var joined = S.joined.indexOf(act.id) >= 0;

    var posts = H.posts.slice();
    var left = [], right = [];
    posts.forEach(function (p, i) { (i % 2 ? right : left).push(p); });

    return (
      '<a class="scanstrip" href="#/scan">' + U.icon('scan') + '扫码，留下我来过<span>→</span></a>' +

      '<div class="carousel" id="carousel">' + hot.map(function (t) {
        return '<div class="slide">' +
          '<div class="ph">' + U.scene(t.id) +
          '<div class="scrim"></div>' +
          '<div class="ovl tl"><h4>' + esc(t.name) + '</h4>' +
          '<div class="st">' + t.km + ' km · ↗ ' + t.up + ' m · ' + esc(t.hours) + '</div></div>' +
          '<button class="favbtn" data-act="want" data-id="' + t.id + '" data-on="♥" data-off="♡">' + (isWant(t.id) ? '♥' : '♡') + '</button>' +
          '<div class="ovl br">' + U.levelBadge(U.trailLevel(t.id)) + '</div>' +
          '</div>' +
          '<a href="#/trails/' + t.id + '"><div class="sb">' + U.trackBox(t.id, 'trk-mini') +
          '<div class="sbtx">' +
          '<div class="sline"><span>六只脚人气</span><b>' + t.visits7 + '</b></div>' +
          '<div class="sline"><span>参考用时</span><b class="hi">' + t.fastest.time + ' · ' + (t.group === 'park' ? '跑步' : '徒步') + '估算</b></div>' +
          '</div></div></a>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="dots" id="dots">' + hot.map(function (_, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>' +

      '<div class="sec-head" style="margin-top:14px"><h3>周末有人组队' +
      '<span class="soon-tag">待开发</span></h3><span class="more">全部活动 ›</span></div>' +
      '<div class="act soon-block">' +
      '<div class="date"><b>' + esc(act.day) + '</b><span>' + esc(act.week) + '</span></div>' +
      '<div style="flex:1;min-width:0">' +
      '<h4>' + esc(act.title) + '</h4>' +
      '<div class="meta">' + esc(act.time) + ' · ' + H.levels[act.level].label + ' · ' + esc(act.hours) + '<br>发起人 ' +
      esc(actPerson.name) + ' · ' + esc(act.note) + '</div>' +
      '<div class="foot"><div class="avstack">' +
      H.peoples.slice(0, Math.min(4, act.joined)).map(function (p, i) { return U.avatar(p, p.tone); }).join('') +
      '</div><span class="cnt">' + (act.joined + (joined ? 1 : 0)) + ' 人已参加</span>' +
      '<button class="btn ' + (joined ? 'ghost' : 'coral') + ' mini" style="margin-left:auto" data-act="join" data-id="' +
      act.id + '">' + (joined ? '已参加 · 退出' : '我也去参加') + '</button></div></div></div>' +

      '<div class="sec-head"><h3>山友的今天<span class="soon-tag">待开发</span></h3>' +
      '<span class="more">全部 ›</span></div>' +
      '<div class="falls soon-block"><div class="col">' + left.map(postCard).join('') + '</div>' +
      '<div class="col">' + right.map(postCard).join('') + '</div></div>' +

      '<div class="letter" style="margin-top:16px">' +
      '<span class="stampmark"></span><div class="ltag">留给下一位</div>' +
      '<div class="line">上面风大，<br>记得带件外套。</div>' +
      '<div class="lsub">这条路上已有 214 句留言 · <a href="#/junctions/haohanpo" style="color:var(--violet);font-weight:700">到现场拆开一封 ›</a></div>' +
      '</div>'
    );
  }

  function homeInit() {
    var c = document.getElementById('carousel'), dots = document.getElementById('dots');
    if (!c) return;
    var idx = 0, timer = null, stopped = false;
    function paint() {
      if (!dots) return;
      var i = Math.round(c.scrollLeft / 264);
      Array.prototype.forEach.call(dots.children, function (d, k) { d.className = k === i ? 'on' : ''; });
    }
    function start() {
      stop();
      timer = setInterval(function () {
        if (stopped) return;
        idx = (idx + 1) % 4;
        var card = c.firstElementChild;
        var step = card ? card.getBoundingClientRect().width + 12 : 264;
        c.scrollTo({ left: idx * step, behavior: 'smooth' });
      }, 5000);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) {
      c.addEventListener(ev, function () { stopped = true; stop(); }, { passive: true });
    });
    c.addEventListener('scroll', function () { paint(); }, { passive: true });
    start();
    paint();
  }

  /* ==================== 路书 ==================== */
  var q = '', lv = 'all', grp = 'all';

  function trailListResults() {
    var all = H.trails;
    var searching = q.trim() !== '' || lv !== 'all' || grp !== 'all';
    if (searching) {
      var res = all.filter(function (t) {
        var okLv = lv === 'all' || t.level === lv;
        var okG = grp === 'all' || t.group === grp;
        var okQ = q.trim() === '' || (t.name + t.region).indexOf(q.trim()) >= 0;
        return okLv && okG && okQ;
      });
      if (!res.length) return '<div class="empty"><span class="big">⛰</span>没有匹配的线路，换个词或难度试试。</div>';
      return '<div class="sec-head"><h3>筛选结果 ' + res.length + ' 条</h3>' +
        '<button class="more" data-act="clear-filter">清除</button></div>' +
        '<div class="card tight">' + res.map(function (t) {
          return compactRow({ thumb: t.id, title: t.name,
            sub: t.km + ' km · ↗ ' + t.up + ' m · ' + t.hours + ' · ' + (t.group === 'park' ? '公园跑道' : t.region),
            right: H.levels[t.level].label });
        }).join('') + '</div>';
    }
    var hot = all.slice().sort(function (a, b) { return b.visits7 - a.visits7; }).slice(0, 4);
    var easy = all.filter(function (t) { return t.level === 'easy'; }).slice(0, 3);
    var hard = all.filter(function (t) { return t.level === 'hard' || t.level === 'hidden'; }).slice(0, 3);
    var longest = all.slice().sort(function (a, b) { return b.km - a.km; }).slice(0, 2);
    var fresh = all.filter(function (t) { return t.newest; });

    return (
      '<div class="sec-head"><h3>热门线路</h3><span class="more">看全部 ›</span></div>' +
      '<div class="carousel">' + hot.map(trailCard).join('') + '</div>' +
      '<div class="card" style="background:var(--blue-bg);box-shadow:none;padding:13px 15px;font-size:12.5px;color:var(--blue-deep);margin-top:10px">' +
      '<b>口径</b>　用时只在同一条线路上比较，每条线路各自成榜；跨线路不排名。</div>' +

      '<div class="sec-head"><h3>新手小白线路<small>平缓 · 3 小时内</small></h3><span class="more">看全部 ›</span></div>' +
      '<div class="card tight">' + easy.map(function (t, i) {
        return compactRow({ pos: i + 1, thumb: t.id, title: t.name, sub: t.km + ' km · ↗ ' + t.up + ' m', level: U.trailLevel(t.id) });
      }).join('') + '</div>' +

      '<div class="sec-head"><h3>最难的线路</h3><span class="more">看全部 ›</span></div>' +
      '<div class="card tight">' + hard.map(function (t, i) {
        return compactRow({ pos: i + 1, thumb: t.id, title: t.name, sub: t.km + ' km · ↗ ' + t.up + ' m · ' + t.hours, level: U.trailLevel(t.id) });
      }).join('') + '</div>' +

      '<div class="sec-head"><h3>最长的线路</h3><span class="more">看全部 ›</span></div>' +
      '<div class="card tight">' + longest.map(function (t, i) {
        return compactRow({ pos: i + 1, thumb: t.id, title: t.name, sub: t.km + ' km · ' + t.hours, level: U.trailLevel(t.id) });
      }).join('') + '</div>' +

      '<div class="sec-head"><h3>公园跑道<small>平路 · 1 小时内可完成</small></h3>' +
      '<button class="more" data-act="filter-grp" data-val="park">看全部 ' +
      all.filter(function (t) { return t.group === 'park'; }).length + ' 条 ›</button></div>' +
      '<div class="card tight">' + all.filter(function (t) { return t.group === 'park'; }).slice(0, 8).map(function (t) {
        return compactRow({ thumb: t.id, title: t.name, sub: t.km + ' km · ↗ ' + t.up + ' m · ' + esc(t.region), level: U.trailLevel(t.id) });
      }).join('') + '</div>' +

      '<a class="rowlink" href="#/me/activity" style="margin-top:14px"><span class="em">＋</span>' +
      '<div class="tx"><b>本周新增路线 ' + fresh.length + ' 条</b><span>由 ' + (fresh.length * 2) + ' 位山友共建 · 发起你自己的线路</span></div>' +
      '<span class="ar">›</span></a>' +
      '<button class="rowlink" style="width:100%;text-align:left" data-act="doc">' +
      '<span class="em">?</span><div class="tx"><b>关于难度</b><span>● 简单 · ▲ 中等 · ◆ 困难 · 中美瑞对照</span></div>' +
      '<span class="ar">›</span></button>'
    );
  }

  function trailListView() {
    return '<div class="searchbar">' + U.icon('search') +
      '<input id="q" type="text" placeholder="搜索线路名称或地区" value="' + esc(q) + '"></div>' +
      '<div class="chips" id="chips">' +
      [['all', '全部'], ['easy', '简单'], ['mid', '中等'], ['hard', '困难'], ['hidden', '隐藏']].map(function (c) {
        return '<button class="chip' + (lv === c[0] ? ' on' : '') + '" data-act="filter" data-val="' + c[0] + '">' +
          (c[0] === 'all' ? '全部' : U.levelMark(c[0])) + '</button>';
      }).join('') + '</div>' +
      '<div class="chips" id="grpchips">' +
      [['all', '山野 + 公园'], ['wild', '只看山野'], ['park', '只看公园跑道']].map(function (c) {
        return '<button class="chip' + (grp === c[0] ? ' on' : '') + '" data-act="filter-grp" data-val="' + c[0] + '">' +
          c[1] + '</button>';
      }).join('') + '</div>' +
      '<div id="trailResults">' + trailListResults() + '</div>';
  }

  function refreshTrailResults() {
    var el = document.getElementById('trailResults');
    if (el) el.innerHTML = trailListResults();
  }

  function trailDetailView(id) {
    var t = trail(id);
    if (!t) return notFound();
    var want = isWant(t.id);
    var rows = t.sections.length ? t.sections.map(function (s) {
      var target = s.kind === 'peak' ? '#/peaks/' + s.point : '#/junctions/' + s.point;
      var done = beenThere(s.point);
      return '<a class="rank" href="' + target + '">' +
        '<span class="pos" style="color:' + (done ? 'var(--blue)' : '#C9C3B4') + '">' + s.no + '</span>' +
        '<span class="nm"><b>' + esc(s.name) + '</b><em>' + esc(s.tip) + '</em></span>' +
        '<span class="tm" style="font-size:12px;color:var(--ink3)">' + (done ? '✓ 去过' : '›') + '</span></a>';
    }).join('') : '<div class="note" style="padding:12px 2px">这条线路是环线/单点轨迹，还没有分段扫码点，' +
      '先看上面的轨迹与坡度分析。</div>';
    var cs = [];
    H.posts.forEach(function (p) { if (p.place.id === t.id) cs.push({ who: p.who, when: p.when, text: p.text }); });
    return (
      '<div class="hero tall">' + U.scene(t.id) +
      '<div class="floating">' + U.levelBadge(U.trailLevel(t.id)) + '</div>' +
      '<div class="cap">' + esc(t.name) + '</div></div>' +
      '<div class="hint" style="margin:0 2px 14px">' + t.km + ' km · ↗ ' + t.up + ' m · ' + esc(t.hours) +
      ' · 六只脚人气 ' + t.visits7 + '</div>' +
      '<p class="muted" style="font-size:13.5px">' + esc(t.desc) + '</p>' +
      (t.group === 'park' ? runCard(t) : '') +
      U.levelBasis(t.id) +
      U.signage(t, { code: 'TH-' + t.id.toUpperCase() }) +
      '<div class="tracewrap">' + apiTrackSVG(t) +
      '<div class="tcap"><span>GPX 轨迹 · 按难度分段着色</span>' +
      '<span>' + t.km + ' km · ↗ ' + t.up + ' m</span></div></div>' +

      '<div class="sec-head"><h3>按坡度自动分段</h3>' +
      '<span class="more">服务端按 GPX 生成</span></div>' +
      '<div class="profilebox">' + apiProfileSVG(t) + '</div>' +
      '<div class="card tight">' + apiSegTable(t) +
      '<div style="font-size:11.5px;color:var(--ink3);padding:10px 0 2px;line-height:1.7">' +
      '段难度只看<strong>爬升高度</strong>与<strong>平均坡度</strong>：爬升 ≤200 / 200–500 / &gt;500 m，' +
      '坡度 ≤15 / 15–25 / &gt;25%。距离不进难度——它体现在用时与消耗里。' +
      '是否要手脚并用、是否需要绳索冰爪，由山友和维护人确认。</div></div>' +

      '<div class="sec-head"><h3>分段路书</h3><span class="more">' +
      (t.status ? '维护人 ' + esc(t.status.who) + ' ›' : '待维护人确认 ›') + '</span></div>' +
      '<div class="card tight">' + rows + '</div>' +

      (t.status
        ? '<div class="card" style="background:var(--blue-bg);box-shadow:none;margin-top:14px">' +
          '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:6px">最近路况</div>' +
          '<div style="font-size:13px;color:#33415E">' + esc(t.status.when) + '维护人确认：' +
          esc(t.status.text) + '</div></div>'
        : '<div class="card soonrow" style="margin-top:14px;border:1px dashed #DED7C8">' +
          '<div style="font-size:12px;font-weight:800;color:var(--ink2);margin-bottom:6px">' +
          '最近路况<span class="soon-tag">待开发</span></div>' +
          '<div style="font-size:12.5px;color:var(--ink3)">' +
          '需要维护人核验的数据表，还没有。</div></div>') +

      '<div class="sec-head"><h3>用时榜</h3><span class="more">按线路 ›</span></div>' +
      '<div class="card tight">' + rankRows([
        { pos: 1, av: H.me, name: '参考用时', sub: '按距离与爬升估算，非真实纪录', time: t.fastest.time },
        { pos: 2, av: H.people.zhou, name: '老周', sub: '本月', time: addMin(t.fastest.time, 6) },
        beenThere(t.id)
          ? { pos: 3, av: H.me, name: '你', sub: '个人最好 · ' + (S.pb[t.id] || '—'), time: S.pb[t.id] || '—', mine: true }
          : { pos: 3, av: H.people.nan, name: '阿楠', sub: '本周', time: addMin(t.fastest.time, 11) }
      ]) + '<div style="font-size:11.5px;color:var(--ink3);padding:10px 0 2px">六只脚上被浏览 ' + t.visits7 +
      ' 次 · 请以安全返程为第一目标</div></div>' +

      '<div class="sec-head"><h3>留言板</h3><span class="more">全部 ›</span></div>' +
      (commentsFor(t.id).length ? commentsFor(t.id).slice(0, 2).map(commentCard).join('')
        : '<div class="empty">还没有留言，做第一个。</div>') +
      '<button class="btn ghost" style="margin-top:6px" data-act="comment-open" data-type="trail" data-id="' + t.id + '">写一句给下一位</button>' +

      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="want" data-id="' + t.id + '" data-on="♥ 已收藏到想去" data-off="♡ 收藏到想去">' + (want ? '♥ 已收藏到想去' : '♡ 收藏到想去') + '</button>' +
      '<a class="btn coral" href="#/scan">我也到了</a></div>'
    );
  }

  function addMin(t, m) {
    var parts = String(t).split(':').map(Number);
    var total = parts[0] * 60 + parts[1] + m;
    return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ============ 详情页：全部读服务端算好的结果，前端不再重算（P6） ============ */
  var LV_C = { easy: '#2563EB', mid: '#F2B62C', hard: '#E4453A', hidden: '#22242E' };
  var LV_T = { easy: '简单', mid: '中等', hard: '困难', hidden: '隐藏' };
  var KND = { climb: '爬升', desc: '下降', flat: '平缓' };

  /* ① 轨迹图：按段着色，山顶标海拔 */
  function apiTrackSVG(t) {
    var path = t.path || [];
    if (path.length < 2) return '';
    var W = 380, H = 210, pad = 26, xs = [], ys = [];
    path.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var s = Math.min((W - pad * 2) / ((x1 - x0) || 1), (H - pad * 2) / ((y1 - y0) || 1));
    var ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    function P(i) { return [(xs[i] - x0) * s + ox, (ys[i] - y0) * s + oy]; }
    var n = path.length - 1;
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" ' +
      'style="display:block;width:100%;height:230px">';
    o += '<g fill="none" stroke="#EFEADD" stroke-width="1">';
    [40, 78, 116, 154, 192].forEach(function (y) {
      o += '<path d="M0 ' + y + ' q 70 -12 140 0 t 200 0"/>';
    });
    o += '</g>';
    /* 段边界：服务端给的是公里数，path 是等距重采样的，按比例换算成下标 */
    (t.segments || []).forEach(function (sg) {
      var a = Math.round(sg.from_km / t.km * n), b = Math.round(sg.to_km / t.km * n), d = '';
      for (var i = a; i <= b; i++) {
        var q = P(i); d += (i === a ? 'M' : 'L') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
      }
      o += '<path d="' + d + '" fill="none" stroke="' + (LV_C[sg.level] || '#999') +
        '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    (t.peakList || []).forEach(function (pk) {
      var q = P(Math.round(pk.km / t.km * n));
      o += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="6.5" fill="#22242E"/>' +
        '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] - 11).toFixed(1) +
        '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#22242E">' +
        pk.altitude + '</text>';
    });
    return o + '</svg>';
  }

  /* ② 海拔剖面 + 底部难度色带 */
  function apiProfileSVG(t) {
    var prof = t.profile || [];
    if (prof.length < 2) return '';
    var W = 340, H = 96, pad = 8, n = prof.length, xs = [], ys = [];
    for (var i = 0; i < n; i++) {
      xs.push(pad + (i / (n - 1)) * (W - pad * 2));
      ys.push(H - 16 - prof[i] * (H - 30));
    }
    var line = xs.map(function (x, i) {
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1); }).join(' ');
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'style="display:block;width:100%;height:74px">';
    o += '<path d="' + line + ' L' + xs[n - 1].toFixed(1) + ' ' + (H - 12) + ' L' +
      xs[0].toFixed(1) + ' ' + (H - 12) + ' Z" fill="#EDF1FD"/>';
    o += '<path d="' + line + '" fill="none" stroke="#3455F5" stroke-width="2" stroke-linejoin="round"/>';
    (t.segments || []).forEach(function (sg) {
      var a = pad + (sg.from_km / t.km) * (W - pad * 2);
      var b = pad + (sg.to_km / t.km) * (W - pad * 2);
      o += '<rect x="' + a.toFixed(1) + '" y="' + (H - 10) + '" width="' +
        Math.max(1, b - a).toFixed(1) + '" height="7" fill="' + (LV_C[sg.level] || '#999') + '"/>';
    });
    return o + '</svg>';
  }

  /* ③ 分段表：每段一行 */
  function apiSegTable(t) {
    if (!t.segments || !t.segments.length) return '';
    return t.segments.map(function (s) {
      return '<div style="display:flex;align-items:center;gap:9px;padding:10px 0;' +
        'border-bottom:1px solid var(--hair);font-size:12.5px">' +
        '<span style="width:10px;height:10px;border-radius:3px;flex:0 0 auto;background:' +
        (LV_C[s.level] || '#999') + '"></span>' +
        '<span style="font-weight:800;flex:0 0 56px">' + s.no + '. ' + KND[s.kind] + '</span>' +
        '<span style="color:var(--ink2);flex:0 0 96px">' + s.from_km + '–' + s.to_km + ' km</span>' +
        '<span style="flex:1;color:var(--ink2)">' + (s.rise > 0 ? '+' : '') + s.rise + ' m · ' +
        (s.pct > 0 ? '+' : '') + s.pct + '%</span>' +
        U.levelBadge(s.level) + '</div>';
    }).join('');
  }

  /* 公园跑道的跑步参考：单圈距离 / 常见路面 / 常见配速换算 */
  function fmtClock(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.round(sec % 60);
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }
  function runCard(t) {
    var st = (H.routeStats || {})[t.id] || {};
    var loop = (st.closed != null && st.closed < 150) ? '闭合环线' : '环线';
    return '<div class="sec-head"><h3>跑步参考</h3><span class="more">' + loop + ' ›</span></div>' +
      '<div class="card">' +
      '<div class="kv2"><span>单圈距离</span><b>' + t.km + ' km</b></div>' +
      '<div class="kv2"><span>累计爬升</span><b>' + t.up + ' m</b></div>' +
      (st.surface ? '<div class="kv2"><span>常见路面</span><b>' + esc(st.surface) + '</b></div>' : '') +
      [5, 6, 7].map(function (p) {
        return '<div class="kv2"><span>配速 ' + p + ':00 /km</span><b>' +
          fmtClock(Math.round(t.km * p * 60)) + '</b></div>';
      }).join('') +
      '<div class="note" style="padding:10px 2px 0">配速用时按距离直接换算，不含等灯与爬升修正；' +
      '路面是按公园普遍路况的判断，没有逐段核实。</div></div>';
  }

  /* 第二层信息：走过的人说这一段要不要手脚并用 */
  function segFeedback(id) {
    var sg = U.segments(id);
    var steep = sg.segs.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
    var key = id + '#' + steep.no;
    var f = S.segFb[key] || { walk: 0, hands: 0, pro: 0 };
    var mine = S.mySegFb[key];
    var total = f.walk + f.hands + f.pro;
    return '<div class="sec-head"><h3>这一段好走吗</h3>' +
      '<span class="more">第 ' + steep.no + ' 段 · 最陡 ' + Math.round(steep.pct) + '%</span></div>' +
      '<div class="card">' +
      '<div class="note" style="margin-bottom:11px">坡度机器算得出来，' +
      '要不要手脚并用、难不难，得走过的人说了算。你的一句话会挂在这一段上。</div>' +
      '<div class="tags-pick" id="segFb">' +
      [['walk', '简单徒步'], ['hands', '要手脚并用'], ['pro', '要保护措施']].map(function (o) {
        return '<button data-act="segfb" data-id="' + id + '" data-key="' + key + '" data-val="' + o[0] +
          '" class="' + (mine === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="kv2" style="margin-top:13px"><span>这一段的山友反馈</span><b>' + total + ' 人</b></div>' +
      '<div class="kv2"><span>简单徒步</span><b>' + f.walk + ' 人</b></div>' +
      '<div class="kv2"><span>需要手脚并用</span><b>' + f.hands + ' 人</b></div>' +
      '<div class="kv2"><span>需要保护措施</span><b>' + f.pro + ' 人</b></div>' +
      (f.pro >= 2 ? '<div class="hint" style="margin:10px 0 0;color:var(--hard-ink)">' +
        '≥2 人认为需要保护措施 · 这一段会自动升级为 ⬢ 隐藏难度</div>' : '') +
      '</div>';
  }

  /* ==================== 山头 · 岔路 ==================== */
  var seg = 'peak';
  var pq = '', pf = 'all', pcity = 'all', plv = 'all';   /* 搜索 / 档位 / 城市 / 难度 */
  var pgeo = null;                                        /* 我的坐标（点了"离我最近"才有） */

  function distKm(a, b, c, d) {          /* 球面距离，够用 */
    var R = 6371, r = Math.PI / 180;
    var dLat = (c - a) * r, dLng = (d - b) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function placesView() {
    var head = '<div class="seg">' +
      '<button class="' + (seg === 'peak' ? 'on' : '') + '" data-act="seg" data-val="peak">山头</button>' +
      '<button class="' + (seg === 'junction' ? 'on' : '') + '" data-act="seg" data-val="junction">岔路</button></div>';

    /* 搜索栏 + 筛选：两段共用，选项随分段变 */
    var FILTERS = seg === 'peak'
      ? [['all', '全部'], ['near', '离我最近'], ['h2000', '2000 m 以上'],
         ['h1500', '1500–2000 m'], ['l1500', '1500 m 以下']]
      : [['all', '全部'], ['ok', '已核验'], ['wait', '待核验']];
    if (FILTERS.every(function (f) { return f[0] !== pf; })) pf = 'all';
    var cities = ['all'].concat(H.peaks.map(function (p) { return p.city; })
      .filter(function (c, i, a) { return c && a.indexOf(c) === i; }));
    var bar =
      '<div class="searchbar">🔍<input id="pq" placeholder="' +
      (seg === 'peak' ? '搜索山头名称或所属线路' : '搜索岔路名称或情报内容') +
      '" value="' + esc(pq) + '"></div>' +
      '<div class="chips" id="pfchips">' + FILTERS.map(function (f) {
        return '<button class="chip' + (pf === f[0] ? ' on' : '') + '" data-act="pfilter" data-val="' +
          f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      (seg === 'peak'
        ? '<div class="chips">' + cities.map(function (c) {
            return '<button class="chip' + (pcity === c ? ' on' : '') +
              '" data-act="pcity" data-val="' + esc(c) + '">' +
              (c === 'all' ? '全部城市' : c) + '</button>';
          }).join('') + '</div>' +
          '<div class="chips">' + [['all', '全部难度'], ['easy', '简单'], ['mid', '中等'],
            ['hard', '困难'], ['hidden', '隐藏']].map(function (l) {
            return '<button class="chip' + (plv === l[0] ? ' on' : '') +
              '" data-act="plv" data-val="' + l[0] + '">' + l[1] + '</button>';
          }).join('') + '</div>'
        : '');

    if (seg === 'peak') {
      var board = H.peaks.slice().sort(function (a, b) {
          if (pf === 'near' && pgeo) {
            return distKm(pgeo.lat, pgeo.lng, a.lat || 0, a.lng || 0) -
                   distKm(pgeo.lat, pgeo.lng, b.lat || 0, b.lng || 0);
          }
          return b.alt - a.alt;
        })
        .filter(function (p) {
          var kw = pq.trim();
          var okQ = !kw || (p.name || '').indexOf(kw) >= 0 || (p.trailName || '').indexOf(kw) >= 0;
          var okF = pf === 'all' ||
            (pf === 'near' && pgeo) ||
            (pf === 'h2000' && p.alt >= 2000) ||
            (pf === 'h1500' && p.alt >= 1500 && p.alt < 2000) ||
            (pf === 'l1500' && p.alt < 1500);
          return okQ && okF && (pcity === 'all' || p.city === pcity) &&
            (plv === 'all' || p.level === plv);
        });
      return head + bar +
        '<div class="sec-head" style="margin-top:4px"><h3>山头热门排行榜</h3>' +
        '<span class="more">' + (pq || pf !== 'all' ? board.length + ' 个结果' : '按海拔 ›') + '</span></div>' +
        (board.length ? board.slice(0, 12).map(function (p, i) {
          return locCard({
            href: '#/peaks/' + p.id,
            scene: U.scene(p.id),
            /* 峰名还没采到，就用线路名顶标题；标题和副标题不再重复同一个词 */
            title: esc(p.name || p.trailName) +
                   (p.name ? '' : ' <span class="soon-tag">待命名</span>'),
            sub: '海拔 ' + p.alt + ' m' + (p.city ? ' · ' + esc(p.city) : '') +
                 (pgeo && p.lat ? ' · 距你 ' + distKm(pgeo.lat, pgeo.lng, p.lat, p.lng).toFixed(1) + ' km' : ''),
            heat: p.visits30 || 0,
            footTitle: '山顶留言 · 1 条',
            footText: '小鱼：风很大，但看到日出那一刻觉得都值了。' +
                      ' <span class="soon-tag">示例</span>'
          });
        }).join('') : '<div class="empty">没有匹配的山头</div>') +
        '<div class="hint" style="text-align:center">共 ' + H.peaks.length + ' 个山顶 · ' +
        '峰名与照片待实地采集</div>' +
        '<div class="sec-head"><h3>最近有人去过</h3><span class="more">全部 ›</span></div>' +
        '<div class="card tight">' + H.posts.slice(0, 4).map(function (p) {
          var person = H.people[p.who];
          return '<a class="rank" href="' + linkTo(p.place) + '">' + U.avatar(person) +
            '<span class="nm"><b>' + esc(person.name) + ' · ' + esc(p.place.name) + '</b><em>' + esc(p.when) + ' · ' + esc(p.seq || '已到访') + '</em></span>' +
            '<span class="tm" style="font-size:12px;color:var(--ink3)">›</span></a>';
        }).join('') + '</div>';
    }

    var all = [];
    H.junctions.forEach(function (j) {
      intelFor(j).forEach(function (i) { all.push({ j: j, i: i }); });
    });
    var kw = pq.trim();
    all = all.filter(function (x) {
      var okQ = !kw || (x.j.name || '').indexOf(kw) >= 0 ||
        (x.i.title || '').indexOf(kw) >= 0 || (x.i.text || '').indexOf(kw) >= 0;
      var okF = pf === 'all' || (pf === 'ok' && x.i.ok) || (pf === 'wait' && !x.i.ok);
      return okQ && okF;
    });
    all.sort(function (a, b) { return (b.i.mine ? 1 : 0) - (a.i.mine ? 1 : 0) || (b.i.ok ? 0 : 1) - (a.i.ok ? 0 : 1); });
    return head + bar +
      '<div class="sec-head" style="margin-top:4px"><h3>岔路情报 · 最新</h3><span class="more">全部 ›</span></div>' +
      '<div class="hint" style="margin-top:-6px">岔路的留言不是情绪，是情报：往哪走、能不能过。</div>' +
      (all.length ? all.slice(0, 8).map(function (x) {
        var person = H.people[x.i.who] || { name: '山友', av: '山' };
        return '<div data-act="goto-junction" data-id="' + x.j.id + '">' + locCard({
          scene: U.scene(x.j.id),
          title: esc(person.name) + ' 上报 <span class="soon-tag">示例</span>',
          sub: '第 ' + (x.j.index || 1) + ' 个点位 · ' + (x.i.ok ? '已核验' : '待核验'),
          heat: 0,
          footTitle: '岔路情报 · 1 条',
          footText: esc(x.i.title) + '（' + esc(x.i.text) + '）'
        }) + '</div>';
      }).join('') : '<div class="empty">没有匹配的岔路情报</div>') +
      '<div class="hint" style="text-align:center;margin-top:6px">共 ' + all.length + ' 条情报 · 来自 ' +
      H.junctions.length + ' 个岔路点位</div>';
  }

  /* 山头 / 岔路 共用卡片：
     上半 = 图 + 名称 + 定位 + 热度 +「我到过」；下半 = 留言 / 情报。
     两张卡片大小一致。 */
  /* 占山为王：首图右下角那颗按钮 */
  function claimBtn(key, name, kind) {
    return '<button class="claimbtn" data-act="claim" data-key="' + esc(key) +
      '" data-name="' + esc(name) + '" data-kind="' + kind + '">占山为王</button>';
  }

  function locCard(o) {
    var inner =
      '<div style="display:flex;gap:12px;padding:14px">' +
      '<span style="width:78px;height:78px;border-radius:14px;overflow:hidden;flex:0 0 auto;' +
      'background:#EDE7DA;display:block">' + o.scene + '</span>' +
      '<span style="flex:1;min-width:0;display:flex;flex-direction:column">' +
      '<b style="font-size:15px;font-weight:800;line-height:1.3">' + o.title + '</b>' +
      '<span style="font-size:11.5px;color:var(--ink3);margin-top:3px">' + o.sub + '</span>' +
      '<span style="display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:8px">' +
      '<span style="font-size:11px;color:var(--ink3)">热度 <b style="color:var(--coral);' +
      'font-size:13px">' + o.heat + '</b></span>' +
      '<span class="btn coral mini" style="margin-left:auto;padding:6px 12px;font-size:12px">' +
      '我到过</span></span></span></div>' +
      '<div style="border-top:1px solid var(--hair);background:#FCFAF6;padding:10px 14px">' +
      '<div style="font-size:10.5px;color:var(--ink3);margin-bottom:4px">' + o.footTitle + '</div>' +
      '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.55">' + o.footText + '</div></div>';
    return o.href
      ? '<a class="card" href="' + o.href + '" style="padding:0;overflow:hidden;margin-bottom:12px;' +
        'display:block">' + inner + '</a>'
      : '<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">' + inner + '</div>';
  }

  /* ==================== 山头页 ==================== */
  function peakView(id) {
    var p = peak(id);
    if (!p) return notFound();
    var board = p.board.map(function (b) { return { pos: b.pos, av: personByName(b.who), name: b.who, sub: b.when, time: b.time }; });
    if (S.mySeqs[p.id] && S.pb[p.id]) {
      board = board.filter(function (b) { return b.name !== '你'; });
      board.push({ pos: 0, av: H.me, name: '你', sub: '个人最好', time: S.pb[p.id], mine: true });
      board.sort(function (a, b) { return a.time.localeCompare(b.time); });
      board.forEach(function (b, i) { b.pos = i + 1; });
    }
    var cs = commentsFor(p.id);
    var want = isWant(p.id);
    return (
      '<div class="hero tall">' + U.scene(p.id) +
      '<div class="floating"><a href="#/places"><span class="pill">‹ 返回</span></a></div>' +
      '<div class="floating right"><span class="pill">山头 · 打卡点</span></div></div>' +
      claimBtn(p.id, p.name || p.trailName, 'peak') +
      '<div class="pad">' +
      '<h2 class="arrive-h" style="margin-top:0">' + esc(p.name) + '</h2>' +
      '<p class="arrive-p">' +
      (p.name ? esc(p.name) + ' · ' : '<span class="soon-tag">待命名</span>') +
      '海拔 ' + p.alt + ' m · 属于「' + esc(p.trailName) + '」</p>' +
      '<div class="hint" style="margin:-8px 2px 14px;display:flex;gap:12px;flex-wrap:wrap">' +
      '<span>本周热度 <b style="color:var(--coral)">' + (p.visits30 || 0) + '</b></span>' +
      (p.lat ? '<span>坐标 ' + p.lat + ', ' + p.lng + '</span>'
             : '<span>坐标待采集</span>') +
      '</div>' +
      U.signage(p, { code: 'PK-' + p.id.toUpperCase() }) +

      '<div class="sec-head"><h3>用时榜</h3><span class="more">今日 · 好友 · 我的纪录 ›</span></div>' +
      '<div class="card tight">' + rankRows(board) +
      '<div style="font-size:11.5px;color:var(--ink3);padding:10px 0 2px">共 37 人今日登顶 · 请以安全返程为第一目标</div></div>' +

      '<div class="sec-head"><h3>山顶照片墙</h3><span class="more">' + p.photos + ' 张 ›</span></div>' +
      '<div class="photowall">' + [1, 2, 3].map(function (i) {
        return '<div class="pw">' + U.scene(p.id + '-photo' + i, { palette: (i * 2) % 6 }) + '</div>';
      }).join('') + '</div>' +

      '<div class="sec-head"><h3>留言板</h3><span class="more">全部 ›</span></div>' +
      (cs.length ? cs.slice(0, 3).map(commentCard).join('') : '<div class="empty">还没有留言。</div>') +

      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="want" data-id="' + p.id + '" data-on="♥ 已收藏到想去" data-off="♡ 收藏到想去">' + (want ? '♥ 已收藏到想去' : '♡ 收藏到想去') + '</button>' +
      '<button class="btn coral" data-act="checkin" data-type="peak" data-id="' + p.id + '">' + (beenThere(p.id) ? '再打一次卡' : '我也到了') + '</button>' +
      '</div>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="comment-open" data-type="peak" data-id="' + p.id + '">在留言板写一句</button>'
      + '</div>'
    );
  }

  /* ==================== 岔路页 ==================== */
  function junctionView(id) {
    var j = junction(id);
    if (!j) return notFound();
    return (
      '<div class="hero tall">' + U.scene(j.id, { palette: 1 }) +
      '<div class="floating"><a href="#/places/junction"><span class="pill">‹ 返回</span></a></div>' +
      '<div class="floating right"><span class="pill">岔路 · 路书点</span></div></div>' +
      claimBtn(j.id, j.name, 'junction') +
      '<div class="pad">' +
      '<h2 class="arrive-h" style="margin-top:0">' + esc(j.name) + '</h2>' +
      '<p class="arrive-p">' + esc(j.trailName) + ' · 第 <b style="color:var(--blue)">' + j.index + '</b>/' + j.total +
      ' 个点位 · 点位编号 ' + esc(j.code) + '</p>' +
      U.signage(j, { level: (trail(j.trailId) || {}).level || 'easy',
        alt: '第 ' + j.index + '/' + j.total + ' 个点位' }) +

      '<div class="guide"><div class="gtag">你在这里 · 往哪走</div>' +
      '<div class="grow"><div class="gshot">' + U.scene(j.id + '-guide', { palette: 1 }) + '</div>' +
      '<span class="dir">' + esc(j.guide.arrow) + '</span>' +
      '<div class="gtxt"><b>' + esc(j.guide.title) + '</b><span>' + esc(j.guide.desc) + '</span></div></div>' +
      '<div class="next">' + esc(j.guide.next) + '</div></div>' +

      '<div class="sec-head"><h3>岔路情报</h3><span class="more">按新鲜 ›</span></div>' +
      intelFor(j).map(function (i) { return intelCard(i, j.id); }).join('') +
      '<div class="hint" style="text-align:center">一条情报被 3 个人确认后会自动升级为「已核验」</div>' +

      '<button class="btn ghost" data-act="intel-open" data-id="' + j.id + '">上报一条情报</button>' +
      '<button class="btn coral" style="margin-top:9px" data-act="checkin" data-type="junction" data-id="' + j.id + '">' +
      (beenThere(j.id) ? '再打一次卡' : '顺路打卡') + '</button>' +
      '<div class="hint" style="text-align:center">路过这里也可以打卡，留下「我走过这一段」</div>'
      + '</div>'
    );
  }

  /* ==================== 消息 ==================== */
  function messagesView() {
    var groups = ['互动', '请求', '信件', '系统'];
    var body = groups.map(function (g) {
      var list = H.messages.filter(function (m) { return m.group === g; });
      var rows = list.map(function (m) {
        var st = S.friends[m.id];
        var person = H.people[m.who] || { name: '到此一游', av: '山', tone: 'a4' };
        return '<div class="msg"' + (m.warn ? ' style="border-left:4px solid var(--coral)"' : '') + '>' +
          U.avatar(person, person.tone) +
          '<div class="tx"><b>' + esc(m.title || person.name) + '</b>' +
          (m.when ? '<em>' + esc(m.when) + '</em>' : '') +
          '<p>' + esc(m.text) + '</p>' +
          (m.ctx ? '<a class="ctx" href="' + linkTo(m.ctx) + '">' + esc(m.ctx.name) + ' ›</a>' : '') +
          (m.kind === 'friend' && !st
            ? '<div class="mini-actions"><button class="pill-btn acc" data-act="friend" data-id="' + m.id + '" data-val="acc">接受</button>' +
              '<button class="pill-btn ign" data-act="friend" data-id="' + m.id + '" data-val="ign">忽略</button></div>'
            : '') +
          (m.kind === 'friend' && st
            ? '<div class="mini-actions"><span class="pill-btn ' + (st === 'acc' ? 'acc' : 'ign') + '">' +
              (st === 'acc' ? '已是好友' : '已忽略') + '</span></div>' : '') +
          (m.kind === 'photo' && !st
            ? '<div class="mini-actions"><button class="pill-btn acc" data-act="friend" data-id="' + m.id + '" data-val="acc">交换照片</button>' +
              '<button class="pill-btn ign" data-act="friend" data-id="' + m.id + '" data-val="ign">先不用</button></div>' +
              '<div class="urgent">' + esc(m.urgent) + '</div>' : '') +
          (m.kind === 'photo' && st ? '<div class="mini-actions"><span class="pill-btn ' + (st === 'acc' ? 'acc' : 'ign') + '">' +
            (st === 'acc' ? '已交换，去留言板 ›' : '已拒绝') + '</span></div>' : '') +
          (m.action ? '<div class="mini-actions"><a class="pill-btn acc" href="#/me/peak">' + esc(m.action) + '</a></div>' : '') +
          '</div></div>';
      }).join('');
      return '<div class="group-label">' + g + '</div>' + rows;
    }).join('');
    return body + '<div class="hint" style="text-align:center">每条通知都带一个地点上下文胶囊，点它回到现场，而不是回到某个人的主页</div>';
  }

  /* ==================== 我 ==================== */
  function recordCard() {
    var rows = H.summits.map(function (s) {
      return '<div class="row">' +
        '<span class="ic ' + (s.level === 'easy' ? 'g' : s.level === 'mid' ? 'b' : '') + '">' +
        '<span class="lvshape">' + U.shapeSVG(s.level) + '</span></span>' +
        '<span class="nm"><a href="#/peaks/' + s.peakId + '"><b>' + esc(s.name) + '</b></a>' +
        '<em>海拔 ' + s.alt + ' m · ' + esc(s.date) + '</em></span>' +
        '<span class="tm' + (s.pb ? ' pb' : '') + '">' + s.time + '</span></div>';
    }).join('');
    var best = H.summits.slice().sort(function (a, b) { return a.time.localeCompare(b.time); })[0];
    return '<div class="card record">' +
      '<div class="row-between" style="margin-bottom:4px"><h3 style="font-size:16px;font-weight:800">' +
      '我的 record<span class="soon-tag">待开发</span></h3>' +
      '<span class="tiny muted">' + H.summits.length + ' 座 ›</span></div>' +
      '<div class="tiny muted" style="margin-bottom:8px">登顶时间 · 最快一次是 ' + esc(best.name) + ' ' + best.time + '</div>' +
      '<div class="soon-block">' + rows + '</div>' +
      '<div class="tiny muted" style="margin-top:10px">蓝色是个人最好成绩；时间只和自己比，不同山峰之间不排名。</div>' +
      '<div class="tiny" style="margin-top:8px;color:var(--ink3)">' +
      '上面这几座是示例——后端还没有「登顶时间」这张表。</div>' +
      '</div>';
  }

  function meView() {
    var visitedCount = S.visited.length;
    var lit = Math.min(6, visitedCount);
    return '<div class="profile"><div class="big">我</div>' +
      '<div><b>' + esc(H.me.name) + '</b><span>到过 ' + visitedCount + ' 个点位 · 认领 1 座山头 · 连续 ' + H.me.streak + ' 周上山</span></div></div>' +

      '<div class="card">' +
      '<div class="row-between"><h3 style="font-size:16px;font-weight:800">山径拼图</h3>' +
      '<span class="tiny muted">' + lit + '/6 座 ›</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(lit / 6 * 100) + '%"></i></div>' +
      '<div class="tiny muted">' + (lit >= 6 ? '6 座全部点亮，已解锁「山脊行者」'
        : '再完成 ' + (6 - lit) + ' 座，解锁「山脊行者」') + '</div>' +
      '<div class="puzzle">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
        var k = Math.ceil(i / 8 * 6);
        var cls = k <= lit ? (k % 3 === 0 ? 'peak' : 'done') : '';
        return '<i class="' + cls + '"></i>';
      }).join('') + '</div></div>' +

      recordCard() +
      rowlink('#/me/visited', '✓', '我去过的地方 ' + visitedCount, '地图 / 拼图两种看') +
      rowlink('#/me/want', '♡', '我想去的地方 ' + S.want.length +
        '<span class="soon-tag">待开发</span>', '收藏关系表还没建，下面是示例') +
      rowlink('#/me/peak', '⛰', '我的山头 · ' + esc(H.me.claim) +
        '<span class="soon-tag">待开发</span>', '认领与维护关系表还没建', true) +
      rowlink('#/me/records', '★', '我的纪录', '东灵山 PB ' + (S.pb.dongling || H.me.pb) + ' · 连续 ' + H.me.streak + ' 周上山') +
      rowlink('#/me/letters', '✉', '山间信箱 ' + (H.letters.length + S.letters.length) +
        '<span class="soon-tag">待开发</span>', '未来信数据表还没建，下面是示例') +
      rowlink('#/me/activity', '＋', '发起周末活动', '选一条路，约人一起走') +
      '<button class="btn ghost" style="margin-top:14px" data-act="reset">清空我的演示数据</button>';
  }
  function rowlink(href, em, title, sub, warn) {
    return '<a class="rowlink' + (warn ? ' warn' : '') + '" href="' + href + '"><span class="em">' + em + '</span>' +
      '<div class="tx"><b>' + title + '</b><span>' + esc(sub) + '</span></div><span class="ar">›</span></a>';
  }

  var meViewMode = 'list';
  function meVisitedView() {
    var head = '<div class="seg">' +
      '<button class="' + (meViewMode === 'list' ? 'on' : '') + '" data-act="meview" data-val="list">列表</button>' +
      '<button class="' + (meViewMode === 'map' ? 'on' : '') + '" data-act="meview" data-val="map">地图</button>' +
      '<button class="' + (meViewMode === 'puzzle' ? 'on' : '') + '" data-act="meview" data-val="puzzle">拼图</button></div>';
    if (!S.visited.length) return head + '<div class="empty"><span class="big">⛰</span>还没有到访记录，去扫一扫留下第一次。</div>';
    if (meViewMode === 'map') {
      return head + '<div class="mapbox">' + S.visited.map(function (v, i) {
        var x = 12 + (hash(v.id) % 70), y = 12 + (hash(v.id + 'y') % 64);
        return '<span class="pin" style="left:' + x + '%;top:' + y + '%" title="' + esc(v.name) + '"></span>';
      }).join('') + '</div>' +
        '<div class="hint">每个点是一个到访过的点位，橙色是这次新到的。</div>' +
        S.visited.map(function (v) { return visitedRow(v); }).join('');
    }
    if (meViewMode === 'puzzle') {
      return head + '<div class="card">' +
        '<div class="row-between"><h3 style="font-size:16px;font-weight:800">山径拼图</h3>' +
        '<span class="tiny muted">' + Math.min(S.visited.length, 6) + '/6 座</span></div>' +
        '<div class="progress"><i style="width:' + Math.round(Math.min(6, S.visited.length) / 6 * 100) + '%"></i></div>' +
        '<div class="puzzle">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
          var k = Math.ceil(i / 8 * 6), lit = Math.min(6, S.visited.length);
          return '<i class="' + (k <= lit ? (k % 3 === 0 ? 'peak' : 'done') : '') + '"></i>';
        }).join('') + '</div>' +
        '<div class="hint" style="margin:12px 0 0">每到一个新点位自动解锁一块，重复到访不再计数。</div></div>';
    }
    return head + '<div class="card tight">' + S.visited.map(function (v) {
      return '<a class="rank" href="' + (v.type === 'peak' ? '#/peaks/' + v.id : v.type === 'junction' ? '#/junctions/' + v.id : '#/trails/' + v.id) + '">' +
        '<span class="thumb">' + U.scene(v.id) + '</span>' +
        '<span class="nm"><b>' + esc(v.name) + '</b><em>第 ' + v.seq + ' 位到访 · ' + esc(v.when) + '</em></span>' +
        '<span class="tm" style="font-size:12px;color:var(--ink3)">›</span></a>';
    }).join('') + '</div>';
  }
  function visitedRow(v) {
    return '<div class="rowlink"><span class="em">✓</span><div class="tx"><b>' + esc(v.name) + '</b>' +
      '<span>第 ' + v.seq + ' 位到访 · ' + esc(v.when) + '</span></div><span class="ar">›</span></div>';
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997; return h; }

  function meWantView() {
    if (!S.want.length) return '<div class="empty"><span class="big">♡</span>还没有收藏的地方。</div>';
    return '<div class="card tight">' + S.want.map(function (id) {
      var t = trail(id);
      if (!t) return '';
      return '<div class="rank"><span class="thumb">' + U.scene(t.id) + '</span>' +
        '<span class="nm"><a href="#/trails/' + t.id + '"><b>' + esc(t.name) + '</b></a>' +
        '<em>' + t.km + ' km · ↗ ' + t.up + ' m · 六只脚人气 ' + t.visits7 + '</em></span>' +
        '<button class="wanticon" data-act="want" data-id="' + t.id + '" data-on="♥" data-off="♡" style="font-size:16px;color:var(--coral)">♥</button></div>';
    }).join('') + '</div>' +
      '<div class="hint">到访之后会自动提示「把这里从想去移到去过」。</div>';
  }

  function mePeakView() {
    return '<div class="rowlink warn" style="margin-bottom:14px"><span class="em">⛰</span>' +
      '<div class="tx"><b>' + esc(H.me.claim) + '</b><span>你认领于 ' + esc(H.me.since) + ' · 已 23 天未更新</span></div></div>' +
      '<div class="sec-head" style="margin-top:6px"><h3>待处理</h3><span class="more">4 条</span></div>' +
      '<div class="intel"><div class="hd">' + U.avatar('kai') + '阿凯 · 昨天<span class="tag wait">待核验</span></div>' +
      '<b class="t">山顶指示牌被风吹歪</b><p>拍照片时顺手扶了一下，还是有点斜。</p>' +
      '<div class="foot"><button data-act="intel-up" data-id="i2">我也遇到了</button><span>3 人确认</span></div></div>' +
      '<div class="intel"><div class="hd">' + U.avatar('yu') + '小鱼 · 2 小时前<span class="tag wait">待核验</span></div>' +
      '<b class="t">登顶最后 200 m 有积水</b><p>雨后有水，鞋会湿。</p>' +
      '<div class="foot"><button data-act="intel-up" data-id="i3">我也遇到了</button><span>1 人确认</span></div></div>' +
      '<div class="sec-head"><h3>维护记录</h3><span class="more">全部 ›</span></div>' +
      '<div class="card tight">' + compactRow({ title: '更新分段路书', sub: '9 月 18 日 · 你', right: '已发布' }) +
      compactRow({ title: '核验「林道口补给点」', sub: '9 月 12 日 · 你', right: '已核验' }) + '</div>' +
      '<a class="btn blue" href="#/admin" style="margin-top:14px">进入维护台 · 管理我的点位</a>' +
      '<div class="hint">认领门槛：至少提交过一次路书或情报。<br>维护不是荣誉，是责任——山还在等你更新。</div>';
  }

  function meRecordsView() {
    var rows = Object.keys(S.pb).map(function (id) {
      var p = peak(id);
      return { pos: null, av: H.me, name: (p ? p.name : id) + ' · 个人最好', sub: '已刷新', time: S.pb[id], mine: true };
    });
    return '<div class="sec-head" style="margin-top:6px"><h3>我的纪录</h3></div>' +
      '<div class="card tight">' + (rows.length ? rankRows(rows) : '<div class="empty" style="padding:20px">还没有纪录，去打个卡。</div>') + '</div>' +
      '<div class="mini3" style="margin-top:14px">' +
      '<div><span>连续上山</span><b>' + H.me.streak + ' 周</b></div>' +
      '<div><span>到过点位</span><b>' + S.visited.length + '</b></div>' +
      '<div><span>认领山头</span><b>1</b></div></div>' +
      '<a class="rowlink" href="#/places"><span class="em">★</span><div class="tx"><b>去看山头用时榜</b>' +
      '<span>跟别人比，也跟自己比</span></div><span class="ar">›</span></a>';
  }

  function meLettersView() {
    var got = H.letters.map(function (l) {
      return '<div class="letter"><span class="stampmark"></span><div class="ltag">来自 ' + esc(l.from) + '</div>' +
        '<div class="line" style="font-size:15.5px">' + esc(l.text) + '</div>' +
        '<div class="lsub">' + esc(l.when) + '</div></div>';
    }).join('');
    var mine = S.letters.length ? S.letters.map(function (l) {
      return '<div class="letter" style="background:#fff;border-style:solid;border-color:var(--line)">' +
        '<div class="ltag" style="color:var(--violet)">写给未来的自己</div>' +
        '<div class="line" style="font-size:15.5px">' + esc(l.text) + '</div>' +
        '<div class="lsub">' + esc(l.date) + ' 解锁 · 在 ' + esc(l.place) + '</div></div>';
    }).join('') : '';
    return '<div class="sec-head" style="margin-top:6px"><h3>收到的信</h3><span class="more">' + H.letters.length + ' 封</span></div>' +
      got +
      '<div class="sec-head"><h3>我写出的</h3><span class="more">' + S.letters.length + ' 封</span></div>' +
      (mine || '<div class="empty">还没有写给未来的自己，去山顶点位写一封。</div>') +
      '<button class="btn ghost" data-act="letter-open" data-id="dongling">在东灵山写一封未来信</button>';
  }

  function meActivityView() {
    return '<div class="sec-head" style="margin-top:6px"><h3>发起周末活动</h3></div>' +
      '<div class="field"><label>活动标题</label><input id="actTitle" type="text" placeholder="例如：溪谷步道 · 慢速队"></div>' +
      '<div class="field"><label>日期</label><input id="actDate" type="date"></div>' +
      '<div class="field"><label>集合时间与地点</label><input id="actTime" type="text" placeholder="例如：6:30 北门停车场集合"></div>' +
      '<div class="field"><label>线路</label><select id="actTrail">' +
      H.trails.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + ' · ' + H.levels[t.level].short + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>一句话说明</label><input id="actNote" type="text" placeholder="例如：可带新手 · 全程慢走不走散"></div>' +
      '<button class="btn coral" data-act="submit-activity">发布活动</button>' +
      '<div class="hint" style="margin-top:12px">发布后会出现在首页的活动卡上，并在出发前 2 小时提醒你。</div>' +
      (S.myActs.length ? '<div class="sec-head"><h3>我发起的</h3><span class="more">' + S.myActs.length + ' 个</span></div>' +
        S.myActs.map(function (a) {
          return '<div class="act" style="margin-bottom:11px"><div class="date"><b>' + esc(a.day) + '</b><span>' + esc(a.week) + '</span></div>' +
            '<div style="flex:1"><h4>' + esc(a.title) + '</h4><div class="meta">' + esc(a.time) + '</div>' +
            '<div class="foot"><span class="cnt">' + a.joined + ' 人已参加</span>' +
            '<button class="btn ghost mini" style="margin-left:auto" data-act="del-act" data-id="' + a.id + '">删除</button></div></div></div>';
        }).join('') : '');
  }

  /* ==================== 扫码 ==================== */
  function scanView() {
    var pts = [{ id: 'dongling', t: 'peak', n: '东灵山主峰 · 山顶打卡点', c: 'DLS-100' },
      { id: 'haohanpo', t: 'junction', n: '好汉坡 · 岔口扫码点位', c: 'HHP-02' },
      { id: 'dajuesi', t: 'junction', n: '大觉寺 · 起点标牌', c: 'DJS-01' }];
    return '<div class="scanbox"><div class="frame"></div><div class="laser"></div>' +
      '<div class="tip">把取景框对准标牌上的二维码</div></div>' +
      '<div class="hint" style="text-align:center;margin-top:-6px">这是演示版：点下面的按钮模拟扫到一块标牌。</div>' +
      pts.map(function (p) {
        return '<button class="rowlink" style="width:100%;text-align:left" data-act="sim" data-type="' + p.t + '" data-id="' + p.id + '">' +
          '<span class="em">' + U.icon('scan') + '</span><div class="tx"><b>' + esc(p.n) + '</b>' +
          '<span>编号 ' + p.c + '</span></div><span class="ar">›</span></button>';
      }).join('') +
      '<div class="card" style="margin-top:14px">' +
      '<div class="field" style="margin:0"><label>或者手动输入点位编号</label>' +
      '<input id="codeInput" type="text" placeholder="例如 QSD-02"></div>' +
      '<button class="btn blue" style="margin-top:12px" data-act="sim-code">确认点位</button></div>' +
      '<div class="hint">扫不到码时（标牌破损、没网）也能用编号打卡。</div>';
  }

  /* ==================== 到达页 ==================== */
  function arrivalView(pid) {
    var p = peak(pid) || H.peaks[0];
    var done = !!S.mySeqs[p.id];
    /* API 的山顶没有 seq；有真实点位就用它的到访数 +1，否则退到本地记录 */
    var realPt = (H.points && H.points.length) ? H.points[0] : null;
    /* 列表接口字段是 visit_count（下划线），详情接口是 visitCount（驼峰）——两种都兼容 */
    var seq = realPt ? ((realPt.visit_count || realPt.visitCount || 0) + 1)
                     : (p.seq || 1) + (done ? 1 : 0);
    var myTime = S.pb[p.id] || '01:42';
    var letter = H.letters[0];
    var slot = new Date().getHours() < 12 ? '今日第 3 名' : '今日第 7 名';
    return (
      '<div class="hero tall">' + U.scene(p.id) +
      '<div class="floating"><a href="#/scan"><span class="pill">‹ 返回</span></a></div>' +
      '<div class="floating right"><span class="pill">' + esc(p.name) + ' · 打卡点</span></div></div>' +
      '<div class="pad">' +
      '<span class="seal">#' + seq + '</span>' +
      '<h2 class="arrive-h">你到了，山友。</h2>' +
      '<p class="arrive-p">你是第 <b>' + seq + '</b> 位在' + esc(p.name) + '留下痕迹的人</p>' +
      '<button class="btn coral" data-act="checkin" data-type="peak" data-id="' + p.id + '">' +
      (done ? '再留一张到访卡' : '留下我的到访卡') + '</button>' +
      '<div class="mini3">' +
      '<div><span>' + (done ? '再次登顶' : '首次登顶') + '</span><b>' + (done ? '×2' : '✓') + '</b></div>' +
      '<div><span>本次用时</span><b>' + myTime + '</b></div>' +
      '<div><span>山径拼图</span><b>' + (done ? '+' + S.visited.length : '+1') + '</b></div></div>' +
      '<div class="boardline soon-block">🏆 本次 <b>' + myTime + '</b>　' + slot +
      '<a class="go" href="#/peaks/' + p.id + '">用时榜 ›</a></div>' +
      '<div class="ltag" style="margin:2px 2px 6px;font-size:12px;font-weight:700;color:var(--ink2)">' +
      '用时榜 · 拆信<span class="soon-tag">待开发</span>' +
      '<span style="font-weight:400;color:var(--ink3);margin-left:6px">没有用时记录表与信件表，下面是示例</span></div>' +
      '<div class="letter soon-block"><span class="stampmark"></span>' +
      '<div class="ltag">有人给你留了一句话</div>' +
      '<div class="line" style="font-size:15px">来自 ' + esc(letter.from) + '　' +
      '<button data-act="letter-open" data-id="' + p.id + '" style="color:var(--violet);font-weight:700">拆开看看 ›</button></div>' +
      '<div class="lsub">' + esc(letter.when) + '，等下一个走到这个点位的人</div></div>' +
      '<div class="sec-head"><h3>' + esc(p.name) + '留言板</h3><span class="more">全部 ›</span></div>' +
      commentsFor(p.id).slice(0, 2).map(commentCard).join('') +
      '<div class="more-fold">' +
      '<button data-act="letter-write" data-id="' + p.id + '">写给未来的自己</button>' +
      '<button data-act="photo-ask" data-id="' + p.id + '">求一张合影</button>' +
      '<button data-act="walk-ask" data-id="' + p.id + '">一起走一段</button></div>' +
      '<button class="btn ghost" data-act="comment-open" data-type="peak" data-id="' + p.id + '">在留言板写一句</button>'
      + '</div>'
    );
  }

  /* ==================== 弹层 ==================== */
  function sheetCheckin(type, id) {
    var place = placeOf(type, id);
    U.openSheet(
      '<h3>留下我的到访卡</h3>' +
      '<div class="sh-sub">' + esc(place.name) + ' · ' + (type === 'peak' ? '山顶打卡点' : '岔路口路书点') + '</div>' +
      '<div class="field"><label>昵称</label><input id="ckName" type="text" value="' + esc(H.me.name) + '"></div>' +
      '<div class="field"><label>这次是</label><div class="tags-pick" id="ckTags">' +
      ['第一次来', '一个人', '和朋友', '带娃', '第 N 次'].map(function (t, i) {
        return '<button data-act="tag" data-val="' + t + '" class="' + (i === 0 && !beenThere(id) ? 'on' : '') + '">' + t + '</button>';
      }).join('') + '</div></div>' +
      (type === 'peak' ? '<div class="field"><label>这次用了多久（可选）</label>' +
        '<input id="ckTime" type="text" value="' + (S.pb[id] || '01:42') + '" placeholder="例如 01:42"></div>' : '') +
      '<button class="btn coral" data-act="submit-checkin" data-type="' + type + '" data-id="' + id + '">确认打卡</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">先不打卡</button>'
    );
  }

  function sheetVisitDone(type, id, visit) {
    var place = placeOf(type, id);
    var tags = visit.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    U.openSheet(
      '<h3 style="text-align:center">到访成功</h3>' +
      '<div class="sh-sub" style="text-align:center">' + esc(place.name) + ' · 你已经留下一张卡</div>' +
      '<div class="visitcard">' +
      '<div class="top">' + U.scene(id) + '<span class="seal">#' + visit.seq + '</span></div>' +
      '<div class="body"><h4>' + esc(H.me.name) + ' · 第 ' + visit.seq + ' 位到访</h4>' +
      '<div class="meta">' + esc(place.name) + (visit.time ? ' · 用时 ' + esc(visit.time) : '') + ' · 刚刚</div>' +
      '<div class="tags">' + tags + '</div></div></div>' +
      '<button class="btn blue" data-act="share">生成分享图</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">收进到访册</button>'
    );
  }

  function sheetDoc() {
    U.openSheet('<h3>关于难度</h3><div class="sh-sub">形状和颜色永远一起出现，色弱也能分辨</div>' +
      H.difficultyDoc.map(function (d) {
        return '<div class="card" style="box-shadow:none;background:#fff;padding:14px;display:flex;gap:14px;align-items:center">' +
          '<span class="shape" style="width:52px;height:52px;flex:0 0 auto">' + U.shapeSVG(d.key) + '</span>' +
          '<div><div style="font-size:14px;font-weight:800;margin-bottom:5px">' + esc(d.title) + '</div>' +
          '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.6">' + esc(d.body) + '</div></div></div>';
      }).join('') +
      '<div class="group-label" style="margin-top:14px">别的地方怎么分级</div>' +
      H.gradeRefs.map(function (r) {
        return '<div class="card" style="box-shadow:none;background:#fff;padding:14px">' +
          '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:4px">' + esc(r.region) + '</div>' +
          '<div style="font-size:14px;font-weight:800;margin-bottom:5px">' + esc(r.name) + '</div>' +
          '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.6">' + esc(r.body) + '</div>' +
          (r.ladder ? '<div class="ladder">' + r.ladder.map(function (s) {
            return '<div><b>' + esc(s.k) + '</b><span>' + esc(s.t) + '</span></div>';
          }).join('') + '</div>' : '') +
          '</div>';
      }).join('') +
      '<div class="group-label">实体标牌上有什么</div>' +
      U.signage({ level: 'mid', alt: '海拔 2303 m', seq: 100 }, { code: 'DLS-100' }) +
      '<div class="hint">标牌 = 难度图形 + CHA 署名 + 海拔 + 可扫二维码。图形用形状区分，不依赖颜色。</div>' +
      '<button class="btn ghost" style="margin-top:6px" data-act="close">知道了</button>');
  }

  function sheetIntel(jid) {
    var j = junction(jid);
    U.openSheet('<h3>上报一条情报</h3><div class="sh-sub">' + esc(j.name) + ' · 让下一个走到这里的人少走错路</div>' +
      '<div class="field"><label>一句话情报</label><input id="inTitle" type="text" placeholder="例如：右边的岔路是作业道，别走"></div>' +
      '<div class="field"><label>补充说明</label><input id="inText" type="text" placeholder="例如：路口有蓝色标牌，跟着标牌走"></div>' +
      '<button class="btn coral" data-act="submit-intel" data-id="' + jid + '">提交，等待核验</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">取消</button>');
  }

  function sheetComment(type, id) {
    var p = placeOf(type, id);
    U.openSheet('<h3>写一句给下一位</h3><div class="sh-sub">会出现在「' + esc(p.name) + '」的留言板上</div>' +
      '<div class="field"><label>留言</label><input id="cmText" type="text" placeholder="例如：上面风大，记得带件外套。"></div>' +
      '<button class="btn coral" data-act="submit-comment" data-type="' + type + '" data-id="' + id + '">发布</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">取消</button>');
  }

  function sheetLetter(id) {
    var p = peak(id) || placeOf('peak', id);
    U.openSheet('<h3>写给未来的自己</h3><div class="sh-sub">到日子或者下次到 ' + esc(p.name) + ' 时解锁</div>' +
      '<div class="field"><label>想说点什么</label><input id="ltText" type="text" placeholder="例如：如果明年还来，希望你还在走。"></div>' +
      '<div class="field"><label>什么时候拆开</label><input id="ltDate" type="date"></div>' +
      '<button class="btn coral" data-act="submit-letter" data-id="' + id + '">封存这封信</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">取消</button>');
  }

  function sheetReadLetter(id) {
    var l = H.letters[Math.floor(Math.random() * H.letters.length)];
    U.openSheet('<div class="letter" style="margin-top:4px"><span class="stampmark"></span>' +
      '<div class="ltag">来自 ' + esc(l.from) + '</div>' +
      '<div class="line">' + esc(l.text) + '</div>' +
      '<div class="lsub">' + esc(l.when) + '</div></div>' +
      '<button class="btn coral" data-act="close">收下这句话</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="letter-write" data-id="' + id + '">我也留一句给下一位</button>');
  }

  function notFound() {
    return '<div class="empty"><span class="big">⛰</span>没有找到这个页面。<br>' +
      '<a href="#/" style="color:var(--blue);font-weight:700">回首页</a></div>';
  }

  /* ==================== 顶部栏与底部导航 ==================== */
  var TAB_TITLE = { trails: '路书', places: '山头与岔路', messages: '消息', me: '我' };
  var TAB_SUB = { trails: 'TRAILBOOK', places: 'PLACES', messages: 'MESSAGES', me: 'MY HIKES' };

  function renderTopbar(r) {
    var el = U.$('#topbar');
    if (r.name === 'home') {
      el.className = 'topbar home';
      el.innerHTML = '<a class="brand-tap" href="#/"><span class="brand"><b>' + H.appName + '</b><em>' + H.brandEn + '</em></span></a>' +
        '<div class="top-actions"><a class="iconbtn" href="#/trails" aria-label="搜索">' + U.icon('search') + '</a></div>';
      return;
    }
    if (r.name.indexOf('me-') === 0) {
      el.className = 'topbar row';
      el.innerHTML = '<a class="back" href="#/me">' + U.icon('back') + '</a>' +
        '<div class="page-title" style="font-size:18px">' + esc(r.title || '') + '</div>';
      return;
    }
    if (r.tab) {
      el.className = 'topbar';
      el.innerHTML = '<div class="row-between">' +
        '<div><a class="brand-tap" href="#/"><span class="brand mini"><b>' + H.appName + '</b></span></a>' +
        '<div class="page-title">' + TAB_TITLE[r.tab] + '</div></div>' +
        '<div class="top-actions">' +
        (r.tab === 'messages' ? '<a class="iconbtn" href="#/messages">' + U.icon('check') + '</a>'
          : r.tab === 'me' ? '<a class="iconbtn" href="#/me/records">' + U.icon('star') + '</a>'
            : '<a class="iconbtn" href="#/scan">' + U.icon('scan') + '</a>') +
        '</div></div>';
      return;
    }
    el.className = 'topbar row';
    el.innerHTML = '<a class="back" href="' + (r.parent || '#/') + '">' + U.icon('back') + '</a>' +
      '<div class="page-title" style="font-size:18px">' + esc(r.title || '') + '</div>';
  }

  function renderTabbar(tab) {
    var el = U.$('#tabbar');
    function cls(k) { return tab === k ? ' class="on"' : ''; }
    el.innerHTML =
      '<a href="#/trails"' + cls('trails') + '>' + U.icon('book') + '路书</a>' +
      '<a href="#/places"' + cls('places') + '>' + U.icon('hill') + '山头·岔路</a>' +
      '<a class="scan" href="#/scan">' + '<span class="scan-btn">' + U.icon('scan') + '</span><em>扫一扫</em></a>' +
      '<a href="#/messages" class="soon' + (tab === 'messages' ? ' on' : '') + '">' +
      U.icon('chat') + '消息</a>' +
      '<a href="#/me"' + cls('me') + '>' + U.icon('me') + '我</a>';
  }

  /* ==================== 路由 ==================== */
  function parse() {
    var h = decodeURIComponent((location.hash || '#/').replace(/^#/, ''));
    var parts = h.split('/').filter(Boolean);
    var r = { name: 'home', parts: parts };
    if (!parts.length) { r.name = 'home'; r.tab = null; return r; }
    switch (parts[0]) {
      case 'trails':
        if (parts[1]) { r.name = 'trail'; r.id = parts[1]; r.tab = 'trails'; r.parent = '#/trails'; }
        else { r.name = 'trails'; r.tab = 'trails'; }
        break;
      case 'places': r.name = 'places'; r.tab = 'places'; break;
      case 'peaks': r.name = 'peak'; r.id = parts[1]; r.tab = 'places'; r.parent = '#/places'; break;
      case 'junctions': r.name = 'junction'; r.id = parts[1]; r.tab = 'places'; r.parent = '#/places/junction'; break;
      case 'messages': r.name = 'messages'; r.tab = 'messages'; break;
      case 'me':
        r.tab = 'me'; r.parent = '#/me';
        if (parts[1]) { r.name = 'me-' + parts[1]; } else { r.name = 'me'; }
        break;
      case 'scan': r.name = 'scan'; break;
      case 'arrive': r.name = 'arrive'; r.id = parts[1] || 'dongling'; r.parent = '#/scan'; break;
      case 'admin':
        r.name = parts[1] === 'p' ? 'admin-p' : 'admin';
        r.id = parts[2] || null;
        r.parent = '#/admin';
        break;
      default: r.name = parts[0]; r.id = parts[2] || parts[1];
    }
    return r;
  }

  var TITLES = {
    scan: '扫一扫', arrive: '到达页', trail: '线路详情', peak: '山头', junction: '岔路',
    'me-visited': '我去过的地方', 'me-want': '我想去的地方', 'me-peak': '我的山头',
    'me-records': '我的纪录', 'me-letters': '山间信箱', 'me-activity': '发起活动',
    admin: '维护台', 'admin-p': '管理点位'
  };

  function render() {
    var r = parse();
    if (r.name === 'peak' || r.name === 'junction' || r.name === 'trail') {
      var p = placeOf(r.name === 'peak' ? 'peak' : r.name === 'junction' ? 'junction' : 'trail', r.id);
      r.title = p ? p.name : '未找到';
    } else if (TITLES[r.name]) {
      r.title = TITLES[r.name] || (window.EXTRA_TITLES && window.EXTRA_TITLES[r.name]);
    }
    renderTopbar(r);
    renderTabbar(r.tab);

    var view = U.$('#view');
    var flush = (r.name === 'peak' || r.name === 'junction' || r.name === 'arrive');
    view.className = 'view' + (flush ? ' flush' : '');

    var html = '';
    switch (r.name) {
      case 'home': html = homeView(); break;
      case 'trails': html = trailListView(); break;
      case 'trail': html = trailDetailView(r.id); break;
      case 'places': html = placesView(); break;
      case 'peak': html = peakView(r.id); break;
      case 'junction': html = junctionView(r.id); break;
      case 'messages': html = messagesView(); break;
      case 'me': html = meView(); break;
      case 'me-visited': html = meVisitedView(); break;
      case 'me-want': html = meWantView(); break;
      case 'me-peak': html = mePeakView(); break;
      case 'me-records': html = meRecordsView(); break;
      case 'me-letters': html = meLettersView(); break;
      case 'me-activity': html = meActivityView(); break;
      case 'scan': html = scanView(); break;
      case 'arrive': html = arrivalView(r.id); break;
      default: html = (window.EXTRA_VIEWS && window.EXTRA_VIEWS[r.name]) ? window.EXTRA_VIEWS[r.name](r) : notFound();
    }
    view.innerHTML = html;

    if (r.name === 'trails') {
      var input = document.getElementById('q');
      if (input) input.addEventListener('input', function () { q = this.value; refreshTrailResults(); });
    }
    if (r.name === 'places') {
      var pi = document.getElementById('pq');
      if (pi) pi.addEventListener('input', function () {
        pq = this.value;
        render();
        var ni = document.getElementById('pq');       /* 重渲染后把焦点和光标放回去 */
        if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
      });
    }
    if (r.name === 'home') homeInit();

    var isTab = !!r.tab && r.name !== 'peak' && r.name !== 'junction' && r.name !== 'trail';
    if (lastRoute !== r.name + (r.id || '')) view.scrollTop = 0;
    lastRoute = r.name + (r.id || '');
  }
  var lastRoute = '';

  /* ==================== 事件 ==================== */
  function on(act, fn) { return { act: act, fn: fn }; }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    var type = t.getAttribute('data-type');
    var val = t.getAttribute('data-val');

    if (act === 'want') {
      e.preventDefault();
      var i = S.want.indexOf(id);
      if (i >= 0) { S.want.splice(i, 1); U.toast('已从想去移除'); }
      else { S.want.unshift(id); U.toast('已收藏到想去'); }
      persist();
      if (parse().name === 'me-want') { render(); } else { repaintWant(); }
      return;
    }
    if (act === 'join') {
      var j = S.joined.indexOf(id);
      if (j >= 0) { S.joined.splice(j, 1); U.toast('已退出活动'); }
      else { S.joined.unshift(id); U.toast('已参加 · 出发前 2 小时会提醒你'); }
      persist(); render(); return;
    }
    if (act === 'clap') {
      if (S.claps[id]) { delete S.claps[id]; } else { S.claps[id] = 1; U.toast('击掌！'); }
      persist(); render(); return;
    }
    if (act === 'checkin') { sheetCheckin(type, id); return; }
    if (act === 'submit-checkin') {
      var place = placeOf(type, id);
      var name = (document.getElementById('ckName') || {}).value || H.me.name;
      var timeEl = document.getElementById('ckTime');
      var time = timeEl ? timeEl.value.trim() : '';
      var tags = U.$$('#ckTags button.on').map(function (b) { return b.getAttribute('data-val'); });
      if (!tags.length) tags = ['第一次来'];
      var already = !!S.mySeqs[id];
      var seq = (place.seq || place.visits || 100) + (already ? 1 : 0);
      S.mySeqs[id] = (S.mySeqs[id] || 0) + 1;
      var wasWant = S.want.indexOf(id);
      if (wasWant >= 0) { S.want.splice(wasWant, 1); U.toast('已从「想去」移到「去过」'); }
      var visit = { id: id, type: type, name: place.name, seq: seq, when: '刚刚', time: time, tags: tags };
      S.visited = S.visited.filter(function (v) { return v.id !== id; });
      S.visited.unshift(visit);
      if (type === 'peak' && time && (!S.pb[id] || time < S.pb[id])) S.pb[id] = time;
      persist();
      sheetVisitDone(type, id, visit);
      return;
    }
    if (act === 'tag') { t.classList.toggle('on'); return; }
    if (act === 'close') { U.closeSheet(); render(); return; }
    if (act === 'share') { U.toast('已生成分享图（演示）'); U.closeSheet(); render(); return; }
    if (act === 'doc') { sheetDoc(); return; }
    if (act === 'intel-up') {
      S.intelUp[id] = !S.intelUp[id];
      persist(); render();
      U.toast(S.intelUp[id] ? '已确认这条情报' : '已取消确认');
      return;
    }
    if (act === 'intel-open') { sheetIntel(id); return; }
    if (act === 'submit-intel') {
      var title = (document.getElementById('inTitle') || {}).value || '';
      var text = (document.getElementById('inText') || {}).value || '';
      if (!title.trim()) { U.toast('先写一句情报'); return; }
      S.myIntel.unshift({ id: 'my' + Date.now(), jid: id, title: title.trim(), text: text.trim() || '—' });
      persist(); U.closeSheet(); render(); U.toast('已提交，等 3 个人确认');
      return;
    }
    if (act === 'comment-open') { sheetComment(type, id); return; }
    if (act === 'submit-comment') {
      var txt = (document.getElementById('cmText') || {}).value || '';
      if (!txt.trim()) { U.toast('先写点什么'); return; }
      S.myComments[id] = (S.myComments[id] || []).concat([{ when: '刚刚', text: txt.trim() }]);
      persist(); U.closeSheet(); render(); U.toast('已发布到留言板');
      return;
    }
    if (act === 'letter-open') { sheetReadLetter(id); return; }
    if (act === 'letter-write') { sheetLetter(id); return; }
    if (act === 'submit-letter') {
      var lt = (document.getElementById('ltText') || {}).value || '';
      var ld = (document.getElementById('ltDate') || {}).value || '';
      if (!lt.trim()) { U.toast('先写一句'); return; }
      var pk = peak(id);
      S.letters.unshift({ text: lt.trim(), date: ld || '明年今天', place: pk ? pk.name : '青山顶' });
      persist(); U.closeSheet(); render(); U.toast('已封存 · 到期会提醒你');
      return;
    }
    if (act === 'photo-ask') { U.toast('已发出合影请求 · 现场 30 分钟有效'); return; }
    if (act === 'walk-ask') { U.toast('已发出同行邀请'); return; }
    if (act === 'friend') {
      S.friends[id] = val; persist(); render();
      U.toast(val === 'acc' ? '已接受' : '已忽略');
      return;
    }
    if (act === 'seg') { seg = val; render(); return; }
    if (act === 'claim') {
      var ck = t.getAttribute('data-key'), cn = t.getAttribute('data-name'),
          ckind = t.getAttribute('data-kind');
      U.openSheet(
        '<h3>占山为王</h3>' +
        '<div class="sh-sub">' + esc(cn) + ' · 认领后你成为这个点位的山头主</div>' +
        '<div class="note" style="margin-bottom:14px;line-height:1.75">' +
        '认领后立刻拿到一个编号和二维码，<b>自己打印贴出去就能用</b>，不用等官方标牌。<br>' +
        '有 ' + 10 + ' 个人扫过之后，可以申领喷漆和二维码打孔卡。</div>' +
        '<div class="field"><label>你的昵称</label>' +
        '<input id="clNick" type="text" value="' + esc(H.me.name) + '"></div>' +
        '<div class="field"><label>联系方式 · 选填（微信号，用于寄物料）</label>' +
        '<input id="clContact" type="text" placeholder="例如 wx: agan"></div>' +
        '<button class="btn coral" data-act="claim-submit" data-key="' + esc(ck) +
        '" data-name="' + esc(cn) + '" data-kind="' + ckind + '">认领并生成二维码</button>' +
        '<button class="btn ghost" style="margin-top:9px" data-act="close">先不认领</button>');
      return;
    }
    if (act === 'claim-submit') {
      var kb = t.getAttribute('data-key'), kn = t.getAttribute('data-name'),
          kk = t.getAttribute('data-kind');
      var nick = (document.getElementById('clNick') || {}).value || H.me.name;
      var ct = (document.getElementById('clContact') || {}).value || null;
      t.disabled = true; t.textContent = '生成中…';
      claimSubmit(kb, kn, kk, nick, ct, t);
      return;
    }
    if (act === 'pfilter') {
      if (val === 'near' && !pgeo) {
        if (!navigator.geolocation) { U.toast('这个浏览器不支持定位'); return; }
        U.toast('正在获取你的位置…');
        navigator.geolocation.getCurrentPosition(function (pos) {
          pgeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          pf = 'near'; render();
        }, function () {
          U.toast('拿不到位置——需要授权，或换个环境试');
        }, { timeout: 8000 });
        return;
      }
      pf = val; render(); return;
    }
    if (act === 'pcity') { pcity = val; render(); return; }
    if (act === 'plv') { plv = val; render(); return; }
    if (act === 'filter') { lv = val; render(); return; }
    if (act === 'filter-grp') { grp = val; render(); return; }
    if (act === 'clear-filter') { q = ''; lv = 'all'; render(); return; }
    if (act === 'meview') { meViewMode = val; render(); return; }
    if (act === 'sim') { U.go(type === 'peak' ? '#/arrive/' + id : '#/junctions/' + id); return; }
    if (act === 'goto-junction') { U.go('#/junctions/' + id); return; }
    if (act === 'sim-code') {
      var code = ((document.getElementById('codeInput') || {}).value || '').trim().toUpperCase();
      var hitJ = H.junctions.filter(function (j) { return j.code.toUpperCase() === code; })[0];
      if (hitJ) { U.go('#/junctions/' + hitJ.id); return; }
      if (code === 'DLS-100' || code === 'DL-100') { U.go('#/arrive/dongling'); return; }
      U.toast('没找到这个编号，试试 HHP-02 或 DLS-100');
      return;
    }
    if (act === 'submit-activity') {
      var title = (document.getElementById('actTitle') || {}).value || '';
      var date = (document.getElementById('actDate') || {}).value || '';
      var tm = (document.getElementById('actTime') || {}).value || '';
      var tr = (document.getElementById('actTrail') || {}).value || 'sanfeng';
      var note = (document.getElementById('actNote') || {}).value || '';
      if (!title.trim()) { U.toast('先起个标题'); return; }
      var d = date ? new Date(date) : new Date(Date.now() + 6 * 864e5);
      var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      var t2 = trail(tr);
      S.myActs.unshift({ id: 'my' + Date.now(), day: String(d.getDate()), week: week, title: title.trim(),
        time: tm.trim() || '集合时间待定', level: t2.level, hours: t2.hours, host: 'me',
        note: note.trim() || '欢迎一起走', joined: 1, capacity: 10, trailId: tr });
      persist(); render(); U.toast('活动已发布 · 会出现在首页');
      return;
    }
    if (act === 'del-act') {
      S.myActs = S.myActs.filter(function (a) { return a.id !== id; });
      persist(); render(); U.toast('已删除');
      return;
    }
    if (act === 'segfb') {
      var skey = t.getAttribute('data-key');
      var prev = S.mySegFb[skey];
      var fb = S.segFb[skey] || { walk: 0, hands: 0, pro: 0 };
      if (prev) fb[prev] = Math.max(0, fb[prev] - 1);
      if (prev === val) { delete S.mySegFb[skey]; }
      else { fb[val] = (fb[val] || 0) + 1; S.mySegFb[skey] = val; }
      S.segFb[skey] = fb;
      persist(); render();
      U.toast(prev === val ? '已取消' : '谢谢，已记在这一段上');
      return;
    }
    if (window.EXTRA_ACTIONS && window.EXTRA_ACTIONS[act]) {
      window.EXTRA_ACTIONS[act](t, { id: id, type: type, val: val });
      return;
    }
    if (act === 'reset') {
      ['visited', 'want', 'joined', 'claps', 'myComments', 'myIntel', 'intelUp',
        'letters', 'friends', 'pb', 'mySeqs', 'myActs', 'pointEdits', 'myPoints'].forEach(function (k) {
          try { localStorage.removeItem('hikes.v1.' + k); } catch (e) { }
        });
      U.toast('已恢复初始演示数据'); setTimeout(function () { location.reload(); }, 600);
      return;
    }
  });

  /* 认领：拿开发 token 调接口，成功后把二维码和进度摆出来 */
  function claimSubmit(key, name, kind, nick, contact, btn) {
    fetch('/api/auth/dev-login?user_id=1', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (tk) {
        return fetch('/api/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
                     'Authorization': 'Bearer ' + tk.token },
          body: JSON.stringify({ target_key: key, target_name: name, kind: kind,
                                 nickname: nick, contact: contact })
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
      })
      .then(function (x) {
        if (!x.ok) {
          var msg = (x.d.detail && x.d.detail.error && x.d.detail.error.message) || '认领失败';
          if (btn) { btn.disabled = false; btn.textContent = '认领并生成二维码'; }
          U.toast(msg);
          return;
        }
        var c = x.d;
        U.openSheet(
          '<h3>你是这个山头的王了</h3>' +
          '<div class="sh-sub">' + esc(c.target_name) + ' · 编号 <b>' + esc(c.code) + '</b></div>' +
          '<div style="text-align:center;padding:8px 0 4px">' +
          '<img src="' + c.qrUrl + '" alt="二维码" style="width:190px;height:190px;' +
          'border:1px solid var(--line);border-radius:14px;background:#fff;padding:8px"></div>' +
          '<div class="note" style="text-align:center;margin-bottom:14px">' +
          '印出来贴在山上就能用 · 短链 <b>' + esc(c.shortLink) + '</b></div>' +
          '<a class="btn coral" href="' + c.qrUrl + '" download="' + c.code + '.svg">下载二维码</a>' +
          '<div class="card" style="margin-top:14px;background:var(--blue-bg);box-shadow:none">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0">' +
          '<span style="color:var(--blue-deep)">已被扫码</span><b>' + c.scanCount + ' 次</b></div>' +
          '<div class="progress" style="margin:8px 0 6px"><i style="width:' +
          Math.min(100, c.scanCount / 10 * 100) + '%"></i></div>' +
          '<div class="note" style="color:var(--blue-deep)">' +
          (c.canClaimKit ? '已满 10 次，可以申领<b>喷漆和二维码打孔卡</b>了'
                         : '再被扫 ' + c.needForKit + ' 次，可申领喷漆和二维码打孔卡') +
          '</div></div>' +
          '<button class="btn ghost" style="margin-top:9px" data-act="close">知道了</button>');
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = '认领并生成二维码'; }
        U.toast('认领失败：' + e.message);
      });
  }

  function repaintWant() {
    U.$$('[data-act="want"]').forEach(function (b) {
      var on = isWant(b.getAttribute('data-id'));
      var onTxt = b.getAttribute('data-on'), offTxt = b.getAttribute('data-off');
      if (onTxt) b.textContent = on ? onTxt : offTxt;
      if (b.classList.contains('favbtn')) b.style.color = 'var(--coral)';
      else if (b.classList.contains('wanticon')) b.style.color = on ? 'var(--coral)' : '#C9C3B4';
      b.classList.toggle('on', on);
    });
  }

  $('#mask').addEventListener('click', function (e) {
    if (e.target.id === 'mask' || e.target.closest('[data-act="close-mask"]')) U.closeSheet();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') U.closeSheet(); });

  function $(s) { return document.querySelector(s); }

  /* 等后端数据灌进 HIKES 之后再渲染（见 js/api.js） */
  function boot() {
    var p = (window.API && window.API.ready) ? window.API.ready : Promise.resolve();
    p.then(function () {
      if (window.API && window.API.error) {
        document.getElementById('view').innerHTML =
          '<div class="empty"><span class="big">⛰</span>后端没连上<br>' +
          '<span style="font-size:12.5px">从 http://localhost:8000/app/index.html 打开，' +
          '不要直接双击文件</span></div>';
        return;
      }
      render();
    });
  }
  window.addEventListener('hashchange', render);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
