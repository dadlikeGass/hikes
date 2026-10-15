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
    myActs: U.load('myActs', [])
  };
  function persist() {
    ['visited', 'want', 'joined', 'claps', 'myComments', 'myIntel', 'intelUp',
      'letters', 'friends', 'pb', 'mySeqs', 'myActs'].forEach(function (k) { U.save(k, S[k]); });
  }
  window.APP_S = S;          /* 让 api.js 把后端数据灌进来 */

  /* 列表只渲染当前页；本次浏览里第 4 次点「下一页」时提醒游客注册。 */
  var PAGE_SIZE = 5, CAROUSEL_PAGE = 6;
  var pages = { home: 0, trailHot: 0, trails: 0, peaks: 0, peakHot: 0, junctions: 0 };
  var nextPageClicks = 0, browseSignupShown = false;
  function pageCount(total, size) { return Math.max(1, Math.ceil(total / size)); }
  function pageSlice(rows, key, size) {
    pages[key] = Math.min(pages[key] || 0, pageCount(rows.length, size) - 1);
    return rows.slice(pages[key] * size, (pages[key] + 1) * size);
  }
  function pager(key, total, size) {
    var count = pageCount(total, size), p = Math.min(pages[key] || 0, count - 1);
    if (count < 2) return '';
    return '<nav class="list-pager" aria-label="列表分页">' +
      '<button data-act="page-prev" data-val="' + key + '"' + (p === 0 ? ' disabled' : '') + '>‹ 上一页</button>' +
      '<span>第 ' + (p + 1) + ' / ' + count + ' 页</span>' +
      '<button data-act="page-next" data-val="' + key + '"' + (p >= count - 1 ? ' disabled' : '') + '>下一页 ›</button>' +
      '</nav>';
  }
  function resetPages() { pages.trails = pages.peaks = pages.peakHot = pages.junctions = 0; }

  /* ---------- 关注要落库 ----------
     「想去 / 收藏」不能只躺在 localStorage 里：热门登顶榜的"用户关注度"
     数的是服务端那张 wants 表。只在浏览器里点，服务端永远算不出来。 */
  var _tk = null;
  var _collaborationAfterAuth = null;
  function apiToken() {
    if (_tk) return Promise.resolve(_tk);
    try { _tk = localStorage.getItem('hikes.auth.token'); } catch (e) { _tk = null; }
    return Promise.resolve(_tk);
  }
  function wantKindOf(id) {
    if ((H.trails || []).some(function (t) { return t.id === id; })) return 'trail';
    if ((H.peaks || []).some(function (p) { return p.id === id; })) return 'peak';
    return null;      /* 岔路还是本地 mock id，不上报，免得往表里写脏 key */
  }
  function syncWant(id, on) {
    var kind = wantKindOf(id);
    if (!kind) return;
    apiToken().then(function (tk) {
      if (!tk) return;
      var url = '/api/wants';
      var opt = { method: on ? 'POST' : 'DELETE',
                  headers: { Authorization: 'Bearer ' + tk } };
      if (on) {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify({ kind: kind, target_key: id });
      } else {
        url += '?kind=' + kind + '&target_key=' + encodeURIComponent(id);
      }
      /* 静默失败：本地那份是即时反馈的来源，服务端只用来算关注度 */
      return fetch(url, opt).catch(function () {});
    });
  }

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

  /* 留言 / 情报的作者有两种写法，得都认：
     演示数据和关系表里存的是人物 key（chuan / yu / zhou…），
     服务端返回的是用户自己写的**昵称**（点位的第一条留言就是创建人昵称）。
     以前只查 H.people[who]，第二种会取到 undefined，
     esc(person.name) 直接抛错——用户点位的详情页整页空白。
     顺序不能反：先按 key 查，查不到再按名字查。 */
  function personOf(who) {
    if (who === 'me' || who === '你' || who === '我') return H.me;
    return H.people[who] || personByName(who);
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
    return '<a class="trailcard" href="#/trails/' + t.id + '">' +
      '<div class="tc-top">' +
      '<span class="tc-name">' + esc(t.name) + '</span>' +
      '<button class="favbtn flat" data-act="want" data-id="' + t.id + '" data-on="♥" data-off="♡">' +
      (isWant(t.id) ? '♥' : '♡') + '</button></div>' +
      '<div class="tc-mid">' + U.trackBox(t.id, 'trk-tc') +
      '<div class="tc-stats">' +
      '<div class="tcs"><span>长度</span><b>' + t.km + ' km</b></div>' +
      '<div class="tcs"><span>累计爬升</span><b class="hi">' + t.up + ' m</b></div>' +
      '<div class="tcs"><span>参考用时</span><b class="who">' + esc(t.hours) + '</b></div>' +
      '</div></div>' +
      '<div class="tc-bot"><span class="tc-dim">' + t.km + ' km · ↗ ' + t.up + ' m</span>' +
      '<span class="tc-dim">参考用时 ' + esc(t.hours) + '</span></div>' +
      '</a>';
  }

  function compactRow(o) {
    var inner =
      (o.pos != null ? '<span class="pos">' + o.pos + '</span>' : '') +
      (o.thumb ? U.trackBox(o.thumb, 'trk-xs') : '') +
      '<span class="nm"><b>' + esc(o.title) + '</b><em>' + esc(o.sub) + '</em></span>' +
      '<span class="tm" style="font-size:12px">' + (o.level ? U.levelBadge(o.level) : esc(o.right)) + '</span>';
    /* 有 href 就整行可点：详情页是每条线路都该有的入口，
       不能只有热门轮播那几张卡点得进去 */
    return o.href
      ? '<a class="rank" href="' + o.href + '">' + inner + '</a>'
      : '<div class="rank">' + inner + '</div>';
  }

  function intelCard(i, jid) {
    var up = !!S.intelUp[i.id];
    var person = personOf(i.who);
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
    if (c.real) return '<div class="comment"><div class="ph">' +
      U.avatar({ av: (c.who || '山').slice(0, 1), name: c.who || '山友' }) +
      esc(c.who || '山友') + ' · ' + esc(c.when) + '</div><p>' + esc(c.text) + '</p></div>';
    var person = personOf(c.who);
    return '<div class="comment"><div class="ph">' + U.avatar(person, c.who === 'me' ? 'a1' : null) +
      esc(person.name) + ' · ' + esc(c.when) + (c.mine ? ' · 我发的' : '') + '</div>' +
      '<p>' + esc(c.text) + '</p></div>';
  }

  /* ==================== 广告位 ====================
     每个山头一个轮播广告位，能挂几条由维护人等级决定；首页和路书页各有一个
     全站广告轮播位。所有卡片都明标「广告」，不做原生混排——这是产品信誉的事。 */
  function adCard(a) {
    /* 山头详情的路由 id 是 p-{编号}（H.peaks 的 id），不是数据库里的数字 id */
    var href = a.link || ('#/peaks/p-' + a.pointCode);
    return '<a class="slide" href="' + href + '">' +
      '<div class="ph">' + U.scene('ad-' + a.id) + '<div class="scrim"></div>' +
      '<div class="ovl tl"><h4>' + esc(a.title) + '</h4>' +
      (a.body ? '<div class="st">' + esc(a.body) + '</div>' : '') +
      '<div class="st" style="opacity:.7">广告 · ' + esc(a.peakName || a.pointCode || '') + '</div>' +
      '</div></div></a>';
  }

  function adCarousel(list, title) {
    if (!list || !list.length) return '';
    return '<div class="sec-head" style="margin-top:14px"><h3>' + esc(title || '山友的推荐') +
      '</h3><span class="more">广告 · ' + list.length + ' 条</span></div>' +
      '<div class="carousel">' + list.map(adCard).join('') + '</div>';
  }

  /* 这个山头是不是我负责的（维护人 / 山大王），广告入口只给这两种人看 */
  function myPeakRole(code) {
    var m = (H.mySummits || []).filter(function (x) {
      return x.code === code || (x.boardPointCodes || []).indexOf(code) >= 0;
    })[0];
    return m ? m.role : null;
  }

  function maintainerAdEntry(p) {
    var ads = adsOf(p.code);
    var n = ads.first.length + ads.board.length;      /* 在架 = 首屏 + 留言区 */
    return '<button class="rowlink" style="width:100%;text-align:left;margin:0 0 12px" ' +
      'data-act="ad-panel" data-code="' + esc(p.code) + '">' +
      '<span class="em">📣</span><div class="tx"><b>你是这座山的维护人 · 管理广告位</b>' +
      '<span>当前在架 ' + n + ' 条 · 投放新广告 / 看待审状态</span></div>' +
      '<span class="ar">›</span></button>';
  }

  /* 某个点位（山头 / 岔路口）的广告位怎么摆：
     **默认全部在留言区最上面（第一屏之外）**；
     只有审核时被"放第一屏"的那几条才提到首屏。 */
  function adsOf(code) {
    var point = (H.peaks || []).filter(function (p) { return p.code === code; })[0];
    var codes = point && point.boardPointCodes || [code];
    var all = point && point.boardAds || (H.ads || []).filter(function (a) {
      return codes.indexOf(a.pointCode) >= 0;
    });
    return {
      first: all.filter(function (a) { return a.promoted; }),
      board: all.filter(function (a) { return !a.promoted; })
    };
  }

  /* 维护人的广告面板：单板展示位、我提交的版本与投放表单 */
  var adPanelItems = [];
  function sheetAdPanel(code) {
    U.openSheet('<h3>广告位 · 维护人</h3><div class="sh-sub">正在加载…</div>');
    window.API.ja('/api/points/' + code + '/ads').then(function (d) {
      var el = document.getElementById('sheet');
      if (!el) return;
      adPanelItems = d.mine || [];
      var q = d.quota || { level: 1, levelName: '每板一位', used: 0, total: 1 };
      var st = { draft: '草稿', pending: '待审', approved: '已上架', expired: '已过期' };
      el.innerHTML = '<h3>广告位 · 维护人</h3>' +
        '<div class="sh-sub">每块留言板一个广告位 · 当前展示 ' + q.used + ' / ' + q.total + '</div>' +
        ((d.mine || []).length
          ? '<div class="card tight">' + d.mine.map(function (a) {
              return '<div style="padding:9px 0;border-bottom:1px solid var(--hair)">' +
                '<b style="font-size:13.5px">' + esc(a.title) + '</b>' +
                '<em style="font-style:normal;display:block;font-size:11.5px;color:var(--ink3)">' +
                (a.status === 'rejected' ? '被拒：' + esc(a.rejectReason || '不符合投放规范')
                                         : (st[a.status] || a.status)) +
                ' · 到 ' + String(a.endsAt).slice(0, 10) + '</em>' +
                ((a.status === 'draft' || a.status === 'rejected')
                  ? '<button class="btn ghost mini" data-act="ad-edit" data-id="' + a.id + '">编辑并重提</button>' : '') +
                '</div>';
            }).join('') + '</div>'
          : '<div class="empty">还没投过广告。</div>') +
        '<input id="adEditId" type="hidden" value="">' +
        '<div class="fld"><label>主标题</label><input id="adTitle" placeholder="例：大觉寺 · 免费热水"></div>' +
            '<div class="fld"><label>一行说明</label><input id="adBody" placeholder="例：凭号码布免费灌热水"></div>' +
            '<div class="fld"><label>点进去去哪（可留空）</label><input id="adLink" placeholder="#/places 或 https://…"></div>' +
            '<div class="fld"><label>投放天数</label><input id="adDays" type="number" value="30" min="1" max="30"></div>' +
            '<button class="btn ghost" data-act="ad-save-draft" data-code="' + esc(code) + '">保存草稿</button>' +
            '<button class="btn coral" style="margin-top:9px" data-act="ad-submit" data-code="' + esc(code) + '">提交审核</button>' +
        '<div class="hint">新素材通过审核后替换当前展示，不会增加广告位。</div>' +
        '<button class="btn ghost" style="margin-top:9px" data-act="close">关闭</button>';
    }).catch(function () {
      var el = document.getElementById('sheet');
      if (el) el.innerHTML = '<h3>广告位 · 维护人</h3><div class="empty">没加载出来，重新加载页面试试。</div>' +
        '<button class="btn ghost" data-act="close">关闭</button>';
    });
  }

  /* ==================== 首页 ==================== */
  function homeView() {
    /* 先按热度排序，再每次只渲染 6 张；避免把全量路线铺进首屏。 */
    var hot = H.trails.slice().sort(function (a, b) {
      return (b.visits7 || 0) - (a.visits7 || 0) ||
             (b.visitCount || 0) - (a.visitCount || 0);
    });
    var homeHot = pageSlice(hot, 'home', CAROUSEL_PAGE);
    var recent = H.recentBoards || [];
    var labels = { summit: '山顶留言', junction: '岔路情报', segment: '路段描述' };

    return (
      '<a class="scanstrip" href="#/scan">' + U.icon('scan') +
      '<span class="lbl">扫码，<b>' + esc(H.me.name) + '</b>到此一游</span><span>→</span></a>' +

      '<div class="carousel" id="carousel">' + homeHot.map(function (t) {
        /* 整张卡可点 = 进详情页。卡片里的收藏按钮带自己的 data-act，
           closest 会先命中它，所以点♥不会跳走。 */
        return '<div class="slide" data-act="goto-trail" data-id="' + t.id + '" style="cursor:pointer">' +
          '<div class="ph">' + U.scene(t.id) +
          '<div class="scrim"></div>' +
          '<div class="ovl tl"><h4>' + esc(t.name) + '</h4>' +
          /* 左上角：名称下面是 总长 / 总爬升 / 用时 / 卡路里 */
          '<div class="st">' + t.km + ' km · ↗ ' + t.up + ' m</div>' +
          '<div class="st">参考 ' + esc(t.hours) + ' · ' + (t.kcal || '—') + ' kcal</div></div>' +
          '<button class="favbtn" data-act="want" data-id="' + t.id + '" data-on="♥" data-off="♡">' + (isWant(t.id) ? '♥' : '♡') + '</button>' +
          '</div>' +
          '<a href="#/trails/' + t.id + '"><div class="sb">' + U.trackBox(t.id, 'trk-mini') +
          '<div class="sbtx">' +
          '<div class="sline"><span>长度</span><b>' + t.km + ' km</b></div>' +
          '<div class="sline"><span>累计爬升</span><b class="hi">' + t.up + ' m</b></div>' +
          '<div class="sline"><span>参考用时</span><b class="who">' + esc(t.hours) + '</b></div>' +
          '</div></div></a>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="dots" id="dots">' + homeHot.map(function (_, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      pager('home', hot.length, CAROUSEL_PAGE) +

      /* 广告轮播位沿用原设计；近期社区内容只展示数据库记录。 */
      adCarousel(H.ads, '山友的推荐') +
      '<div class="sec-head" style="margin-top:14px"><h3>山里的近期留言与路况</h3></div>' +
      (recent.length ? '<div class="card tight">' + recent.map(function (item) {
        return '<a class="rank" href="' + esc(item.target) + '">' +
          '<span class="nm"><b>' + labels[item.kind] + ' · ' + esc(item.name) + '</b>' +
          '<em>' + esc(item.text) + '</em></span><span class="tm">›</span></a>';
      }).join('') + '</div>' : '<div class="empty">还没有现场留言。</div>') +
      '<a class="rowlink" href="#/places" style="margin-top:14px"><span class="em">＋</span>' +
      '<div class="tx"><b>一起维护山里的信息</b><span>查看山头与岔路</span></div>' +
      '<span class="ar">›</span></a>'
    );
  }

  var homeTimer = null;
  function homeInit() {
    if (homeTimer) { clearInterval(homeTimer); homeTimer = null; }
    var c = document.getElementById('carousel'), dots = document.getElementById('dots');
    if (!c) return;
    var idx = 0, stopped = false;
    var n = c.children.length;                 /* 卡片数 = 线路数，别再写死 */
    function paint() {
      if (!dots) return;
      var i = Math.round(c.scrollLeft / 264);
      Array.prototype.forEach.call(dots.children, function (d, k) { d.className = k === i ? 'on' : ''; });
    }
    function start() {
      stop();
      homeTimer = setInterval(function () {
        if (stopped) return;
        idx = (idx + 1) % (n || 1);
        var card = c.firstElementChild;
        var step = card ? card.getBoundingClientRect().width + 12 : 264;
        c.scrollTo({ left: idx * step, behavior: 'smooth' });
      }, 5000);
    }
    function stop() { if (homeTimer) { clearInterval(homeTimer); homeTimer = null; } }
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) {
      c.addEventListener(ev, function () { stopped = true; stop(); }, { passive: true });
    });
    c.addEventListener('scroll', function () { paint(); }, { passive: true });
    start();
    paint();
  }

  /* ==================== 路书 ==================== */
  var q = '', lv = 'all', kb = 'all', rg = 'all', ru = 'all';

  /* 区域取自线路的 city（"浙江 · 杭州 · 西湖区"→浙江）。库里写法不统一，
     有"四川省"也有"四川"，统一去掉后缀，别让筛选卡里冒出两个四川。 */
  function regionOf(t) {
    var head = String((t && t.city) || '').split('·')[0].trim();
    return head.replace(/(省|市|自治区|特别行政区)$/, '') || '其他';
  }

  /* 搜索与筛选摘要固定在列表上方，详细条件放到底部面板。 */
  function trailFilterBar() {
    return '<div class="searchbar">' + U.icon('search') +
      '<input id="q" type="text" placeholder="搜索线路名称或地区" value="' + esc(q) + '"></div>' +
      filterTrigger('trails');
  }

  function trailListResults() {
    var all = H.trails;
    var kw = q.trim();
    var list = all.filter(function (t) {
      var okRg = rg === 'all' || regionOf(t) === rg;
      var okKb = kb === 'all' ||
        (kb === 's' && t.km < 10) ||
        (kb === 'm' && t.km >= 10 && t.km < 30) ||
        (kb === 'l' && t.km >= 30 && t.km < 60) ||
        (kb === 'xl' && t.km >= 60);
      var okRu = ru === 'all' || (ru === 'low' && t.up < 500) ||
        (ru === 'mid' && t.up >= 500 && t.up < 1500) || (ru === 'high' && t.up >= 1500);
      var okQ = !kw || (t.name + ' ' + (t.sub || '') + ' ' + (t.city || '')).indexOf(kw) >= 0;
      return okKb && okRg && okRu && okQ;
    }).sort(function (a, b) { return a.km - b.km; });
    var fresh = all.filter(function (t) { return t.newest; });
    var shown = pageSlice(list, 'trails', CAROUSEL_PAGE);
    var dirty = !!kw || kb !== 'all' || rg !== 'all' || ru !== 'all';

    return (
      '<div class="sec-head"><h3>全部路线</h3><span class="more">' +
      list.length + ' / ' + all.length + ' 条' +
      (dirty
        ? ' · <button class="more" data-act="clear-filter" style="font:inherit">清除筛选</button>' : '') +
      '</span></div>' +
      (list.length
        ? '<div class="card tight">' + shown.map(function (t) {
            return compactRow({
              href: '#/trails/' + t.id, thumb: t.id, title: t.name,
              sub: t.km + ' km · ↗ ' + t.up + ' m · 参考 ' + t.hours +
                (t.city ? ' · ' + t.city : '')
            });
          }).join('') + '</div>' +
          pager('trails', list.length, CAROUSEL_PAGE)
        : '<div class="empty"><span class="big">⛰</span>没有匹配的线路，换个词或地区试试。</div>') +

      '<a class="rowlink" href="#/me/activity" style="margin-top:14px"><span class="em">＋</span>' +
      '<div class="tx"><b>本周新增路线 ' + fresh.length + ' 条</b><span>由 ' + (fresh.length * 2) + ' 位山友共建 · 发起你自己的线路</span></div>' +
      '<span class="ar">›</span></a>' +
      '<button class="rowlink" style="width:100%;text-align:left" data-act="doc">' +
      '<span class="em">?</span><div class="tx"><b>关于难度</b>' +
      '<span>单段四档 ● ▲ ◆ ⬢ · 线路综合看用时 · 中美瑞对照</span></div>' +
      '<span class="ar">›</span></button>'
    );
  }

  function trailListView() {
    /* 顺序：热门线路置顶 → 筛选条件 → 全部路线（默认 10 条，其余折叠） */
    var hot = H.trails.slice().sort(function (a, b) { return b.visits7 - a.visits7; });
    var hotPage = pageSlice(hot, 'trailHot', CAROUSEL_PAGE);
    return '<div class="sec-head" id="page-trailHot"><h3>热门线路</h3><span class="more">按本周打卡 ›</span></div>' +
      '<div class="carousel">' + hotPage.map(trailCard).join('') + '</div>' +
      pager('trailHot', hot.length, CAROUSEL_PAGE) +
      '<div class="card" style="background:var(--blue-bg);box-shadow:none;padding:13px 15px;font-size:12.5px;color:var(--blue-deep);margin-top:10px">' +
      '<b>口径</b>　完整线路展示行程数据；难度与个人用时只在明确方向和起终点的路段上比较。</div>' +
      /* 广告轮播位：夹在「热门线路轮播」和「全部路线」之间 */
      adCarousel(H.ads, '山友的推荐') +
      trailFilterBar() +
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
      return '<div class="rank">' +
        '<span class="pos" style="color:#C9C3B4">' + s.no + '</span>' +
        '<span class="nm"><b>' + esc(s.name) + '</b><em>' + esc(s.tip) + '</em></span>' +
        '<span class="tm" style="font-size:12px;color:var(--ink3)">待核验</span></div>';
    }).join('') : '<div class="note" style="padding:12px 2px">这条线路是环线/单点轨迹，还没有分段扫码点，' +
      '先看上面的轨迹与坡度分析。</div>';
    var cs = [];
    H.posts.forEach(function (p) { if (p.place.id === t.id) cs.push({ who: p.who, when: p.when, text: p.text }); });
    return (
      '<div class="hero tall">' + U.scene(t.id) +
      '<div class="cap">' + esc(t.name) + '</div></div>' +
      '<div class="hint" style="margin:0 2px 14px">' + t.km + ' km · ↗ ' + t.up + ' m · ' + esc(t.hours) +
      ' · 六只脚人气 ' + t.visits7 + '</div>' +
      '<p class="muted" style="font-size:13.5px">' + esc(t.desc) + '</p>' +
      (t.group === 'park' ? runCard(t) : '') +
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

      /* 打卡点：组委会 GPX 里的 <wpt>，我们贴回轨迹算出里程与海拔。
         顺便把附近的顶带上——赛道上的顶大多就在补给点旁边，
         这样"名称待定"的顶至少能说清"在 CP3 东坪 旁边 400 m"。 */
      ((t.checkpoints || []).length
        ? '<div class="sec-head"><h3>打卡点</h3>' +
          '<span class="more">组委会公布 ' + t.checkpoints.length + ' 个 ›</span></div>' +
          '<div class="card tight">' + t.checkpoints.map(function (cp) {
            var near = (t.peakList || []).filter(function (pk) {
              return Math.abs(pk.km - cp.km) * 1000 <= 500;
            }).sort(function (a, b) {
              return Math.abs(a.km - cp.km) - Math.abs(b.km - cp.km);
            }).slice(0, 2);
            return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--hair)">' +
              '<span style="flex:0 0 auto;width:22px;height:22px;border-radius:7px;background:var(--blue);' +
              'color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center">' +
              cp.no + '</span><span style="flex:1;min-width:0">' +
              '<b style="font-size:13.5px">' + esc(cp.name) + '</b>' +
              '<em style="font-style:normal;display:block;font-size:11.5px;color:var(--ink3)">' +
              cp.km + ' km' + (cp.altitude ? ' · 海拔 ' + cp.altitude + ' m' : '') +
              (cp.off_track_m > 150 ? ' · 离轨迹 ' + cp.off_track_m + ' m' : '') + '</em>' +
              (near.length
                ? '<em style="font-style:normal;display:block;font-size:11.5px;color:var(--ink3)">' +
                  '附近山顶：' + near.map(function (pk) {
                    return pk.altitude + ' m（' + Math.round(Math.abs(pk.km - cp.km) * 1000) + ' m）';
                  }).join('、') + '</em>'
                : '') + '</span></div>';
          }).join('') + '</div>'
        : '') +

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
    /* 打卡点：组委会给的点名，蓝色方块 + 序号（山顶是黑圆点 + 海拔，两套记号不混） */
    (t.checkpoints || []).forEach(function (cp) {
      var q = P(Math.round(cp.km / t.km * n));
      o += '<rect x="' + (q[0] - 4.5).toFixed(1) + '" y="' + (q[1] - 4.5).toFixed(1) +
        '" width="9" height="9" rx="2.5" fill="#3455F5" stroke="#fff" stroke-width="1.4"/>' +
        '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 3.2).toFixed(1) +
        '" text-anchor="middle" font-size="6.6" font-weight="800" fill="#fff">' + cp.no + '</text>';
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
    /* 打卡点在剖面上的位置：一条虚线，一眼看出补给点落在上坡还是下坡 */
    (t.checkpoints || []).forEach(function (cp) {
      var x = pad + (cp.km / t.km) * (W - pad * 2);
      o += '<line x1="' + x.toFixed(1) + '" y1="6" x2="' + x.toFixed(1) + '" y2="' + (H - 11) +
        '" stroke="#3455F5" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
    });
    return o + '</svg>';
  }

  /* ③ 分段表：每段一行 */
  function apiSegTable(t) {
    if (!t.segments || !t.segments.length) return '';
    return t.segments.map(function (s) {
      /* 每一段可点：进去看别人对这一段的留言，也留一句 */
      return '<div data-act="seg-comments" data-id="' + s.id + '" data-no="' + s.no + '" ' +
        'style="display:flex;align-items:center;gap:9px;padding:11px 0;cursor:pointer;' +
        'border-bottom:1px solid var(--hair);font-size:12.5px">' +
        '<span style="width:10px;height:10px;border-radius:3px;flex:0 0 auto;background:' +
        (LV_C[s.level] || '#999') + '"></span>' +
        '<span style="font-weight:800;flex:0 0 56px">' + s.no + '. ' + KND[s.kind] + '</span>' +
        '<span style="color:var(--ink2);flex:0 0 96px">' + s.from_km + '–' + s.to_km + ' km</span>' +
        '<span style="flex:1;color:var(--ink2)">' + (s.rise > 0 ? '+' : '') + s.rise + ' m · ' +
        (s.pct > 0 ? '+' : '') + s.pct + '%</span>' +
        U.levelBadge(s.level) +
        '<span style="color:#C9C3B4;font-size:14px;margin-left:4px">›</span></div>';
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

  /* ==================== 山头 · 岔路 ==================== */
  var seg = 'peak';
  /* 山头页只留三组筛选：距离 / 海拔 / 登顶难度。系列、城市、离我最近都撤了。 */
  var pq = '', pd = 'all', pf = 'all', plv = 'all';
  /* 山头、登顶和岔路榜单各自分页，但共用筛选状态。 */

  /* 「城市」筛选：跟路书页的「区域」一个做法——按数据里真实存在的地区出卡。
     不再用"本市 / 本省 / 本国 / 海外"那种相对口径：没有账号级位置，
     那四档只能拿北京硬顶，"本省"和"本市"在北京还会变成同一批。

     山头榜里有 69 座名山，摊开是 26 个国家 + 33 个省级区，铺 60 张卡没法用，
     所以国内按省出卡、海外收成一档（想找具体国家用搜索框，峰名里带国名）。 */
  function peakRegion(p) {
    var prov = String(p.province || '').trim().replace(/(省|市|自治区|特别行政区)$/, '');
    if (prov) return prov;
    var co = String(p.country || '').trim();
    if (co && co !== '中国') return '海外';
    return '其他';        /* 没地区的（用户自建点位）只在"全部城市"里出现，不硬塞进某一档 */
  }

  function regionOptions(kind) {
    var cnt = {};
    (kind === 'trails' ? H.trails : H.peaks).forEach(function (item) {
      var r = kind === 'trails' ? regionOf(item) : peakRegion(item);
      if (r !== '其他') cnt[r] = (cnt[r] || 0) + 1;
    });
    var regions = Object.keys(cnt).sort(function (a, b) {
      if ((a === '海外') !== (b === '海外')) return a === '海外' ? 1 : -1;
      return cnt[b] - cnt[a] || a.localeCompare(b);
    });
    return [['all', '全部地区']].concat(regions.map(function (r) { return [r, r + ' ' + cnt[r]]; }));
  }

  var filterDraft = null, filterKind = '';
  function filterGroups(kind) {
    if (kind === 'trails') return [
      ['距离', 'kb', [['all','不限'],['s','10 km 以内'],['m','10–30 km'],['l','30–60 km'],['xl','60 km 以上']]],
      ['爬升', 'ru', [['all','不限'],['low','500 m 以下'],['mid','500–1500 m'],['high','1500 m 以上']]],
      ['地区', 'rg', regionOptions('trails')]
    ];
    if (kind === 'peaks') return [
      ['海拔', 'pf', [['all','不限'],['h8000','8000 m 以上'],['m3000','3000–8000 m'],['m1000','1000–3000 m'],['l1000','1000 m 以下']]],
      ['地区', 'pd', regionOptions('peaks')],
      ['登顶难度', 'plv', [['all','不限'],['easy','简单'],['mid','中等'],['hard','困难'],['hidden','隐藏']]]
    ];
    return [['核验状态', 'pf', [['all','全部'],['ok','已核验'],['wait','待核验']]]];
  }
  function currentFilter(kind) {
    return kind === 'trails' ? { kb:kb, ru:ru, rg:rg } :
      kind === 'peaks' ? { pf:pf, pd:pd, plv:plv } : { pf:pf };
  }
  function filterTrigger(kind) {
    var current = currentFilter(kind), active = [];
    filterGroups(kind).forEach(function (g) {
      if (current[g[1]] === 'all') return;
      var choice = g[2].filter(function (c) { return c[0] === current[g[1]]; })[0];
      if (choice) active.push(g[0] + '：' + choice[1].replace(/ \d+$/, ''));
    });
    return '<button class="filter-trigger ' + (kind === 'trails' ? 'trail' : kind === 'peaks' ? 'peak' : 'junction') +
      '" data-act="filter-open" data-val="' + kind + '"><span>' +
      (active.length ? active.map(esc).join(' · ') : '按条件查找') +
      '</span><b>筛选' + (active.length ? ' ' + active.length : '') + ' ›</b></button>';
  }
  function filterResultCount(kind, d) {
    if (kind === 'trails') return H.trails.filter(function (t) {
      return (d.rg === 'all' || regionOf(t) === d.rg) &&
        (d.kb === 'all' || d.kb === 's' && t.km < 10 || d.kb === 'm' && t.km >= 10 && t.km < 30 ||
         d.kb === 'l' && t.km >= 30 && t.km < 60 || d.kb === 'xl' && t.km >= 60) &&
        (d.ru === 'all' || d.ru === 'low' && t.up < 500 || d.ru === 'mid' && t.up >= 500 && t.up < 1500 ||
         d.ru === 'high' && t.up >= 1500) &&
        (!q.trim() || (t.name + ' ' + (t.sub || '') + ' ' + (t.city || '')).indexOf(q.trim()) >= 0);
    }).length;
    if (kind === 'peaks') return H.peaks.filter(function (p) {
      return (d.pd === 'all' || peakRegion(p) === d.pd) && (d.plv === 'all' || p.level === d.plv) &&
        (d.pf === 'all' || d.pf === 'h8000' && p.alt >= 8000 || d.pf === 'm3000' && p.alt >= 3000 && p.alt < 8000 ||
         d.pf === 'm1000' && p.alt >= 1000 && p.alt < 3000 || d.pf === 'l1000' && p.alt < 1000) &&
        (!pq.trim() || ((p.name || '') + ' ' + (p.trailName || '')).indexOf(pq.trim()) >= 0);
    }).length;
    var count = 0;
    H.junctions.forEach(function (j) { intelFor(j).forEach(function (i) {
      if ((d.pf === 'all' || d.pf === 'ok' && i.ok || d.pf === 'wait' && !i.ok) &&
          (!pq.trim() || ((j.name || '') + ' ' + (i.title || '') + ' ' + (i.text || '')).indexOf(pq.trim()) >= 0)) count++;
    }); });
    return count;
  }
  function drawFilterSheet() {
    var groups = filterGroups(filterKind);
    var oldBody = document.querySelector('.filter-sheet-body');
    var oldScroll = oldBody ? oldBody.scrollTop : 0;
    U.openSheet('<h3>筛选' + (filterKind === 'trails' ? '路线' : filterKind === 'peaks' ? '山头' : '岔路情报') + '</h3>' +
      '<div class="sh-sub">每组选择一项，可组合查找。</div><div class="filter-sheet-body">' +
      groups.map(function (g) { return '<section class="filter-group"><h4>' + g[0] + '</h4><div class="filter-options">' +
        g[2].map(function (o) { return '<button class="filter-option' + (filterDraft[g[1]] === o[0] ? ' on' : '') +
          '" data-act="filter-opt" data-key="' + g[1] + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') +
        '</div></section>'; }).join('') + '</div><div class="filter-sheet-actions">' +
      '<button class="btn ghost" data-act="filter-reset">重置</button>' +
      '<button class="btn coral" data-act="filter-apply">查看 ' + filterResultCount(filterKind, filterDraft) + ' 条结果</button></div>');
    var newBody = document.querySelector('.filter-sheet-body');
    if (newBody) newBody.scrollTop = oldScroll;
  }

  function placesView() {
    var head = '<div class="seg">' +
      '<button class="' + (seg === 'peak' ? 'on' : '') + '" data-act="seg" data-val="peak">山头</button>' +
      '<button class="' + (seg === 'junction' ? 'on' : '') + '" data-act="seg" data-val="junction">岔路</button></div>';

    /* 搜索栏 + 筛选：两段共用，选项随分段变 */
    /* 海拔档位跟着数据走：以前榜上只有京郊 300–2300 m，用 1500/2000 分档还行；
       现在顶上有 8849 m 的珠峰，2000 m 以上等于"全部"——按登山界的分法重切。 */
    var FILTERS = seg === 'peak'
      ? [['all', '全部海拔'], ['h8000', '8000 m 以上'],
         ['m3000', '3000–8000 m'], ['m1000', '1000–3000 m'], ['l1000', '1000 m 以下']]
      : [['all', '全部'], ['ok', '已核验'], ['wait', '待核验']];
    if (FILTERS.every(function (f) { return f[0] !== pf; })) pf = 'all';
    var bar =
      '<div class="searchbar">🔍<input id="pq" placeholder="' +
      (seg === 'peak' ? '搜索山头名称或所属线路' : '搜索岔路名称或情报内容') +
      '" value="' + esc(pq) + '"></div>' +
      filterTrigger(seg === 'peak' ? 'peaks' : 'junctions');

    if (seg === 'peak') {
      var board = H.peaks.slice().sort(function (a, b) {
          return b.alt - a.alt;
        })
        .filter(function (p) {
          var kw = pq.trim();
          var okQ = !kw || (p.name || '').indexOf(kw) >= 0 || (p.trailName || '').indexOf(kw) >= 0;
          var okF = pf === 'all' ||
            (pf === 'h8000' && p.alt >= 8000) ||
            (pf === 'm3000' && p.alt >= 3000 && p.alt < 8000) ||
            (pf === 'm1000' && p.alt >= 1000 && p.alt < 3000) ||
            (pf === 'l1000' && p.alt < 1000);
          return okQ && okF && (seg !== 'peak' || pd === 'all' || peakRegion(p) === pd) &&
            (plv === 'all' || p.level === plv);
        });
      return head + newKingEntry('peak') + bar +
        '<div class="sec-head" id="page-peaks" style="margin-top:4px"><h3>热门山头榜</h3>' +
        '<span class="more">' + (pq || pf !== 'all' || pd !== 'all'
          ? board.length + ' 个结果' : '按海拔 ›') + '</span></div>' +
        (board.length ? pageSlice(board, 'peaks', PAGE_SIZE).map(function (p, i) {
          return locCard({
            href: '#/peaks/' + p.id,
            scene: U.scene(p.id),
            /* 标题是**主峰名**。没采到就写「名称待定」——绝不拿线路名冒充峰名，
               线路只在下面那行 @ 出来。 */
            title: p.name ? esc(p.name) : '<span class="tbd">名称待定</span>',
            sub: '海拔 ' + p.alt + ' m' + (p.city ? ' · ' + esc(p.city) : '') +
                 (p.rise && p.km ? ' · 最难一段 +' + p.rise + ' m / ' + p.km + ' km' : ''),
            route: p.routeSlug ? { slug: p.routeSlug, name: p.trailName } : null,
            heat: p.visits30 || 0,
            footTitle: p.origin === 'user' ? '还没有人留言' : '山顶留言',
            /* 自建点位不套用示例留言——那是编的，用户自己的点位里一眼就能看出来 */
            foots: p.origin === 'user'
              ? [{ plain: true, who: p.code || '待激活',
                   text: '刚建好的点位。把二维码贴到山上，第一个扫码的人会写下第一句。' }]
              : [
                  { who: '小鱼', text: '风很大，但看到日出那一刻觉得都值了。' },
                  { who: '阿川', text: '登顶打卡第 100 位，是我！' },
                  { who: '阿楠', text: '石阶结露，慢慢走，别赶。' }
                ]
          });
        }).join('') : '<div class="empty">没有匹配的山头</div>') +
        pager('peaks', board.length, PAGE_SIZE) +
        '<div class="hint" style="text-align:center;margin-top:10px">共 ' + H.peaks.length +
        ' 座山头 · 一座山头一个主峰、一个二维码 · 峰名待实地采集</div>' +
        /* 热门登顶榜：按"本周打卡热度 + 用户关注度"排，跟上面的海拔榜是两个口径。
           口径写在榜单下面，免得用户以为是同一个榜。 */
        hotBoard();
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
    return head + newKingEntry('junction') + bar +
      '<div class="sec-head" id="page-junctions" style="margin-top:4px"><h3>岔路情报 · 最新</h3><span class="more">共 ' + all.length + ' 条</span></div>' +
      '<div class="hint" style="margin-top:-6px">岔路的留言不是情绪，是情报：往哪走、能不能过。</div>' +
      (all.length ? pageSlice(all, 'junctions', CAROUSEL_PAGE).map(function (x) {
        var person = personOf(x.i.who);
        return '<div data-act="goto-junction" data-id="' + x.j.id + '">' + locCard({
          scene: U.scene(x.j.id),
          title: esc(person.name) + ' 上报 <span class="soon-tag">示例</span>',
          sub: '第 ' + (x.j.index || 1) + ' 个点位 · ' + (x.i.ok ? '已核验' : '待核验'),
          heat: 0,
          footTitle: '岔路情报',
          foots: [
            { who: person.name, text: esc(x.i.title) },
            { who: '维护人', text: esc(x.i.text) },
            { who: '路况', text: x.i.ok ? '已核验，可以放心走。' : '还没人核验，走过去留意一下。' }
          ]
        }) + '</div>';
      }).join('') : '<div class="empty">没有匹配的岔路情报</div>') +
      pager('junctions', all.length, CAROUSEL_PAGE) +
      '<div class="hint" style="text-align:center;margin-top:6px">共 ' + all.length + ' 条情报 · 来自 ' +
      H.junctions.length + ' 个岔路点位</div>';
  }

  /* 山头 / 岔路 共用卡片：
     上半 = 图 + 名称 + 定位 + 热度 +「我到过」；下半 = 留言 / 情报。
     两张卡片大小一致。 */
  /* 热门登顶榜 · 一张卡一座山
     左：主峰名 + 地点（大字），下面 单段爬升 / 单段距离 / 打卡人数
     右：登顶最快用时 / 记录保持 */
  function hotCard(h, i) {
    var href = h.kind === 'peak' ? '#/peaks/' + h.target_key : '#/trails/' + h.target_key;
    return '<div class="hotcard">' +
      '<a class="hc-main" href="' + href + '">' +
      '<span class="no' + (i < 3 ? ' top' : '') + '">' + h.rank + '</span>' +
      '<span class="l">' +
        /* 大字是主峰名。没采到就写「名称待定」，线路只在小字里 @ 出来 */
        '<b>' + (h.name ? esc(h.name) : '<span class="tbd">名称待定</span>') + '</b>' +
        '<span class="st2">海拔 ' + h.altitude + ' m' +
        (h.city ? ' · ' + esc(h.city) : '') + '</span>' +
        '<span class="st"><span>单段爬升 <i>' + h.seg_rise + ' m</i></span>' +
        '<s>·</s><span>单段距离 <i>' + h.seg_km + ' km</i></span>' +
        '<s>·</s><span>打卡 <i>' + h.visitors + ' 人</i></span></span>' +
      '</span>' +
      '<span class="r">' +
        '<span class="rb">' + (h.fastest_time || '—') + '</span><i>登顶最快</i>' +
        '<span class="rh">' + esc(h.fastest_holder || '还没人记录') + '</span><i>记录保持</i>' +
      '</span></a>' +
      (h.route_slug ? '<a class="hc-route" href="#/trails/' + h.route_slug + '">@' +
        esc(h.route_name) + ' · 看整条路书 ›</a>' : '') +
      '</div>';
  }

  /* 热门登顶榜和上面的山头榜共用同一套筛选（城市 / 海拔 / 登顶难度）。
     它的字段是接口原始形状（altitude / level / province…），所以单独判一遍。 */
  function hotPass(h) {
    var alt = h.altitude || 0;
    var okF = pf === 'all' ||
      (pf === 'h8000' && alt >= 8000) ||
      (pf === 'm3000' && alt >= 3000 && alt < 8000) ||
      (pf === 'm1000' && alt >= 1000 && alt < 3000) ||
      (pf === 'l1000' && alt < 1000);
    return okF && (pd === 'all' || peakRegion(h) === pd) &&
      (plv === 'all' || !h.level || h.level === plv);
  }

  function hotBoard() {
    var all = H.hotPeaks || [];
    var rows = all.filter(hotPass);
    if (!rows.length) {
      if (all.length) {
        return '<div class="sec-head"><h3>热门登顶榜</h3>' +
          '<span class="more">0 / ' + all.length + ' 座 ›</span></div>' +
          '<div class="empty"><span class="big">🔍</span>当前筛选条件下，这个榜里没有山头，' +
          '换个城市或海拔档试试。</div>';
      }
      var why = (window.API && window.API.hotError)
        ? '接口 /api/peaks/hot 报错：' + esc(window.API.hotError)
        : '接口返回了空列表';
      return '<div class="sec-head"><h3>热门登顶榜</h3>' +
        '<span class="more">本周打卡 + 关注 ›</span></div>' +
        '<div class="empty"><span class="big">📡</span>' + why + '<br>' +
        '<span style="font-size:12.5px">如果刚才还好好的，多半是页面还是旧的——' +
        '重新加载一次就好</span><br>' +
        '<button class="btn ghost" style="margin-top:12px" data-act="reload">重新加载</button></div>';
    }
    return '<div class="sec-head" id="page-peakHot"><h3>热门登顶榜</h3>' +
      '<span class="more">' + rows.length + ' 座 · 本周打卡 + 关注</span></div>' +
      pageSlice(rows, 'peakHot', PAGE_SIZE).map(function (h, i) { return hotCard(h, i); }).join('') +
      pager('peakHot', rows.length, PAGE_SIZE) +
      '<div class="hint" style="text-align:center;margin-top:-4px">' +
      '排名 = 本周打卡 ×3 + 近 30 天打卡 + 关注 ×2</div>';
  }

  /* 成为版主：认领一个已经存在的山头 / 岔路（不是新建） */
  /* ==================== 游客模式 ====================
     规则：游客能**看**（路书 / 山头 / 留言）+ **打卡**（带时间戳的到此一游凭证）；
     想留言、想起个称呼，一律走注册流程 —— 所以游客只有一个写入口：打卡。
     没有匿名 UGC，也就没有匿名内容要审。 */

  function fmtLocal(iso) {
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 到访卡：打卡结果先给足（时间戳、第几位、海拔、线路位置），再提注册。
     三件事里两件要注册，所以这张卡同时也是转化点——但顺序不能反。 */
  function sheetGuestCard(v) {
    var loggedIn = !!localStorage.getItem('hikes.auth.token');
    U.openSheet(
      '<h3>你到了，山友。</h3>' +
      '<div class="sh-sub">' + fmtLocal(v.visitedAt) + ' · 到此一游</div>' +
      '<div class="card" style="text-align:center;padding:18px 14px">' +
      '<span class="seal">#' + v.seq + '</span>' +
      '<div style="font-size:14px;font-weight:800;margin-top:9px">' +
      esc(v.peakName || ('海拔 ' + (v.altitude || '—') + ' m')) + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink3);margin-top:5px">' +
      (v.routeName ? esc(v.routeName) + ' 第 ' + v.idxInRoute + '/' + v.totalInRoute + ' 个点位 · ' : '') +
      '第 ' + v.seq + ' 位在这里留下痕迹的人</div>' +
      '<div style="font-size:12px;color:var(--ink3);margin-top:7px">' +
      (v.altitude ? '海拔 ' + v.altitude + ' m · ' : '') + '编号 ' + esc(v.pointCode) + '</div>' +
      '</div>' +
      '<div class="hint" style="text-align:center">截图就是你的到此一游凭证</div>' +
      '<button class="btn ghost" data-act="arrival-draft" data-code="' + esc(v.pointCode) + '">留一句给下一位</button>' +
      (loggedIn ? '<div class="hint" style="text-align:center;margin-top:10px">已存到你的账号。</div>' :
        '<button class="btn ghost" style="margin-top:9px" data-act="signup" data-why="nickname">' +
        '起个称呼，让下一位知道是谁</button>' +
        '<div class="hint" style="text-align:center;margin-top:10px">' +
        '纪念和留言草稿可先保存；公开发布和署名需要账号。</div>' +
        '<button class="btn coral" style="margin-top:10px" data-act="signup" data-why="save">' +
        '存到我名下（换手机也不丢）</button>') +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">先这样</button>'
    );
  }

  /* 注册引导：先说清"为什么要注册"，不跳走、不打断已经拿到的凭证 */
  function sheetSignup(why) {
    var reason = {
      comment: '留言需要一个身份——它会被挂在你的名字下面',
      nickname: '称呼是署名的一种，所以得先有账号',
      save: '把这条到此一游记录存到你名下，换手机也不丢',
      claim: '认领山头并维护留言板需要一个账号',
      collaboration: '申请协助维护这块山顶留言板需要一个账号',
      browse: '注册后可保存你走过和关注的线路，继续探索时也能找回'
    }[why] || '这部分需要登录后才能用';
    U.openSheet(
      '<h3>注册或登录</h3><div class="sh-sub">' + esc(reason) + '。</div>' +
      '<div class="field"><label>用户名</label><input id="arrivalUser" autocomplete="username" maxlength="32"></div>' +
      '<div class="field"><label>密码</label><input id="arrivalPassword" type="password" autocomplete="current-password" maxlength="128"></div>' +
      '<div class="hint">新账号密码至少 12 位；登录后当前到访与草稿会并入账号。</div>' +
      '<div id="arrivalAuthError" class="hint" role="status"></div>' +
      '<button class="btn coral" data-act="arrival-auth" data-mode="register">' +
      (why === 'browse' ? '注册并继续探索' : '注册并保存') + '</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="arrival-auth" data-mode="login">已有账号，登录</button>' +
      '<div class="hint">注册即表示你同意 <a href="/terms.html" target="_blank">《用户协议》</a>，' +
      '并已知悉 <a href="/privacy.html" target="_blank">《隐私政策》</a>；' +
      '留言请遵守 <a href="/rules.html" target="_blank">《留言规范》</a>。</div>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">先不注册</button>'
    );
  }

  function arrivalCode() {
    var r = parse(), p = peak(r.id);
    return p && p.code;
  }

  function arrivalRequest(url, method, body, guest) {
    return (guest ? window.API.guestToken() : window.API.token()).then(function (tk) {
      if (!tk) throw new Error('身份不可用，请稍后重试');
      return window.API.timedFetch(url, { method: method, headers: {
        'Content-Type': 'application/json',
        [guest ? 'X-Guest-Token' : 'Authorization']: guest ? tk : 'Bearer ' + tk
      }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            var error = new Error(d.message || d.detail && d.detail.message || '请求失败，请稍后重试');
            error.status = r.status;
            throw error;
          }
          return d;
        });
      });
    });
  }

  function arrivalDraftOwner() {
    try {
      var token = localStorage.getItem('hikes.auth.token');
      if (token) {
        var uid = localStorage.getItem('hikes.auth.userId');
        if (!uid) uid = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
        return 'u:' + uid;
      }
      var guest = localStorage.getItem('hikes.guest.token');
      return guest ? 'g:' + guest : null;
    } catch (e) { return null; }
  }

  function arrivalDraftKey(code, owner) {
    return 'hikes.arrival.draft.' + owner + ':' + code;
  }

  function localArrivalDraft(code, owner) {
    try {
      var draft = JSON.parse(localStorage.getItem(arrivalDraftKey(code, owner || arrivalDraftOwner())) || 'null');
      return draft && (draft.privateNote || draft.publicCommentDraft) ? draft : null;
    }
    catch (e) { return null; }
  }

  function rememberArrivalDraft(code, note, comment) {
    var owner = arrivalDraftOwner();
    if (!owner) return;
    try {
      if (!note && !comment) {
        localStorage.removeItem(arrivalDraftKey(code, owner));
        return;
      }
      localStorage.setItem(arrivalDraftKey(code, owner), JSON.stringify({
        privateNote: note, publicCommentDraft: comment
      }));
    } catch (e) { /* Storage unavailable; server save remains available. */ }
  }

  function moveGuestDraftsToAccount(guestToken, userId) {
    if (!guestToken) return Promise.resolve([]);
    var prefix = 'hikes.arrival.draft.g:' + guestToken + ':';
    var pending = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(prefix) === 0) {
          var code = key.slice(prefix.length), draft = JSON.parse(localStorage.getItem(key));
          if (!draft || (!draft.privateNote && !draft.publicCommentDraft)) continue;
          localStorage.setItem(arrivalDraftKey(code, 'u:' + userId), JSON.stringify(draft));
          pending.push({ key: key, code: code, draft: draft });
        }
      }
    } catch (e) { return Promise.resolve([]); }
    return Promise.all(pending.map(function (item) {
      return arrivalRequest('/api/me/arrival-drafts', 'PUT', {
        code: item.code, privateNote: item.draft.privateNote,
        publicCommentDraft: item.draft.publicCommentDraft
      }).then(function () { localStorage.removeItem(item.key); return true; })
        .catch(function () { return false; });
    }));
  }

  function sheetArrivalDraft(code) {
    if (!code) return;
    if (!localStorage.getItem('hikes.auth.token')) window.API.guestToken();
    var local = localArrivalDraft(code);
    U.openSheet('<h3>这次到访</h3><div class="sh-sub">' + esc(code) + '</div>' +
      '<div class="field"><label>私人纪念（只有自己可见）</label><textarea id="arrivalPrivate" maxlength="500"></textarea></div>' +
      '<div class="field"><label>给山友的留言草稿</label><textarea id="arrivalPublic" maxlength="200"></textarea></div>' +
      '<div id="arrivalDraftError" class="hint" role="status">正在读取已有草稿…</div>' +
      '<button class="btn coral" data-act="arrival-draft-save" data-code="' + esc(code) + '">保存草稿</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="arrival-draft-publish" data-code="' + esc(code) + '">署名发布留言</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">返回</button>');
    if (local) {
      document.getElementById('arrivalPrivate').value = local.privateNote || '';
      document.getElementById('arrivalPublic').value = local.publicCommentDraft || '';
      document.getElementById('arrivalDraftError').textContent = '草稿已从本机恢复。';
    }
    window.API.token().then(function (tk) {
      return tk ? arrivalRequest('/api/me/arrival-drafts', 'GET').then(function (rows) {
        return rows.filter(function (d) { return d.code === code; })[0] || {};
      }) : arrivalRequest('/api/guest/arrival-draft?code=' + encodeURIComponent(code), 'GET', null, true);
    }).then(function (d) {
      if (document.getElementById('arrivalPrivate') && !local &&
          !document.getElementById('arrivalPrivate').value &&
          !document.getElementById('arrivalPublic').value) {
        document.getElementById('arrivalPrivate').value = d.privateNote || '';
        document.getElementById('arrivalPublic').value = d.publicCommentDraft || '';
        document.getElementById('arrivalDraftError').textContent = '';
      }
    }).catch(function (e) {
      var el = document.getElementById('arrivalDraftError');
      if (el) el.textContent = e.message;
    });
  }

  function sheetBecomeMaster() {
    /* 一条线路上的 5 个顶名字都一样（都没采到真名），逐个列出来就是刷屏。
       按线路去重，一座山一行——认领本来就是认领整座山。 */
    var nOf = {};
    (H.peaks || []).forEach(function (p) {
      var k = p.routeSlug || p.id;
      nOf[k] = (nOf[k] || 0) + 1;
    });
    var seen = {};
    var cand = (H.peaks || []).slice().sort(function (a, b) {
      return (b.visits30 || 0) - (a.visits30 || 0) || b.alt - a.alt;
    }).filter(function (p) {
      var k = p.routeSlug || p.id;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).slice(0, 8);
    U.openSheet(
      '<h3>成为版主</h3>' +
      '<div class="sh-sub">选一个已经立好的山头或岔路，你来做它的维护人</div>' +
      '<div class="card" style="box-shadow:none;background:var(--blue-bg);padding:14px;margin-bottom:12px">' +
      '<div style="font-size:12.5px;color:#2B3568;line-height:1.75">' +
      '版主干什么：<b>认领这个点位</b>，管它的留言板，核验岔路情报，' +
      '缺东西就补——上线后会给你一个编号和二维码，你也能自己印。<br>' +
      '不用上传 GPX，因为轨迹已经在了。</div></div>' +
      '<div class="group-label">可以认领的点位</div>' +
      '<div class="card tight">' + cand.map(function (p) {
        return '<button class="hotrow" style="width:100%;text-align:left;background:none" ' +
          'data-act="master-claim" data-code="' + esc(p.code) + '" ' +
          'data-name="' + esc(p.name || p.trailName || '名称待定') + '">' +
          '<span class="no">' + (p.alt || '') + '</span>' +
          '<span class="nm"><b>' + (p.name ? esc(p.name) : '<span class="tbd">名称待定</span>') + '</b>' +
          '<em>' + (p.city ? esc(p.city) + ' · ' : '') + '最高 ' + p.alt + ' m' +
          (nOf[p.routeSlug || p.id] > 1 ? ' · ' + nOf[p.routeSlug || p.id] + ' 个顶' : '') +
          ' · 本周热度 ' + (p.visits30 || 0) + '</em></span>' +
          '<span class="mt" style="color:var(--coral)">我来维护</span></button>';
      }).join('') + '</div>' +
      '<button class="btn ghost" style="margin-top:12px" data-act="close">先算了</button>');
  }

  /* 点「所有」：这一周的打卡记录 + 打卡人数最多的 5 座主峰 */
  function sheetHotAll() {
    U.openSheet('<h3>本周打卡</h3><div class="sh-sub">正在加载…</div>');
    var hot = (H.hotPeaks || []).slice(0, 5);
    fetch('/api/visits/recent?days=7&limit=40')
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (feed) {
        var el = document.getElementById('sheet');
        if (!el) return;
        el.innerHTML =
          '<h3>本周打卡</h3>' +
          '<div class="sh-sub">最近 7 天，谁在哪座山上留了痕</div>' +

          '<div class="group-label">打卡人数最多的 5 座主峰</div>' +
          hot.map(function (h, i) { return hotCard(h, i); }).join('') +

          '<div class="group-label" style="margin-top:16px">最近一周的打卡记录</div>' +
          (feed.length
            ? '<div class="card tight">' + feed.map(function (f) {
                return '<a class="hotrow" href="' + f.href + '">' +
                  '<span class="no">' + esc(String(f.who).slice(0, 1)) + '</span>' +
                  '<span class="nm"><b>' + esc(f.who) + ' · ' + esc(f.place || '') + '</b>' +
                  '<em>' + whenAgo(f.at) + (f.time ? ' · 用时 ' + f.time : '') + '</em></span>' +
                  '<span class="mt">›</span></a>';
              }).join('') + '</div>'
            : '<div class="empty">这一周还没有人打卡。<br>' +
              '<span style="font-size:12.5px">第一个扫码的人会出现在这里</span></div>') +

          '<button class="btn ghost" style="margin-top:14px" data-act="close">' +
          '查看更多 · 先收起</button>';
      });
  }

  /* ISO 时间 → "3 小时前" */
  function whenAgo(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.round(h / 24) + ' 天前';
  }

  /* 占山为王 / 我是NPC指路人：页首那张入口卡。
     同一条卡片两个说法，跟着分段走——岔路口不是山头，站在那里的人是"指路人"，
     不是"山大王"：山上的人找的是风景和留言板，岔路口的人只想知道往哪走。
     data-kind 一并带出去，点进去建的就是对应类型的点位（后端 /api/points 认 kind）。 */
  function newKingEntry(kind) {
    var jc = kind === 'junction';
    return '<button class="kingcard' + (jc ? ' npc' : '') + '" data-act="king-new" ' +
      'data-kind="' + (jc ? 'junction' : 'peak') + '">' +
      '<span class="kk-ridge">' +
      '<svg viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 80 L0 54 L44 27 L84 51 L128 21 L172 55 L212 35 L256 59 ' +
      'L300 31 L342 55 L400 27 L400 80 Z" fill="#5A1200" opacity=".17"/></svg>' +
      '</span>' +
      '<span class="kk-tx">' +
      '<b class="kk-big">' + (jc ? '<span class="kk-line">我是 <em>NPC</em></span><span class="kk-line kk-line-big">指路人</span>' : '占山为王') + '</b>' +
      '<span class="kk-sub">' + (jc ? '站在岔路口，给后来的人指条明路'
        : '做一个游戏人间的山大王～') + '</span>' +
      '<span class="kk-sub">' + (jc ? '立一个岔路点位，写清往哪走、能不能过'
        : '为你热爱的山峰做一个更大的留言板') + '</span>' +
      '</span>' +
      '<span class="kk-imp">' +
      '<span class="kk-say">' + (jc ? '前面左转上山' : '大王叫我来巡山') + '</span>' +
      '<img class="kk-mascot" src="images/mascots/' + (jc ? 'guide.png' : 'patrol.png') +
      '" alt="" width="108" height="114">' +
      '<span class="kk-go">点卡片开始<i>›</i></span>' +
      '</span></button>';
  }

  var npGeo = { lat: null, lng: null };
  var npGpx = null;      /* 选中的 GPX 原文 */
  var npKind = 'peak';   /* 这次建的是山头还是岔路口——决定表单和建成后的文案 */
  function newPointSheet(kind) {
    npGeo = { lat: null, lng: null };
    npGpx = null;
    npKind = kind === 'junction' ? 'junction' : 'peak';
    var jc = npKind === 'junction';
    U.openSheet(
      '<h3>' + (jc ? '我是NPC指路人' : '我要成为山大王') + '</h3>' +
      '<div class="sh-sub">' + (jc
        ? '立在岔路口，给路过的人指条明路；编号和二维码一样当场就发'
        : '建好立刻拿到编号和二维码，印出来贴上去就能用') + '</div>' +
      '<div class="field"><label>' + (jc ? '这个岔路口叫什么' : '这座山叫什么') + '</label>' +
      '<input id="npName" type="text" maxlength="30" placeholder="' + (jc
        ? '没名字也行，比如「林道岔口」' : '没名字也行，比如「老鹰嘴」') + '"></div>' +
      '<div class="field"><label>一句话介绍 · 必填</label>' +
      '<input id="npIntro" type="text" maxlength="200" ' +
      'placeholder="' + (jc ? '往哪走、能不能过。这句话会成为第一条情报'
        : '怎么走、什么样。这句话会成为第一条留言') + '"></div>' +
      '<div class="field"><label>GPX 轨迹 · 必填</label>' +
      '<input id="npGpx" type="file" accept=".gpx,.xml,application/gpx+xml" ' +
      'style="padding:10px;border:1.5px dashed var(--line);border-radius:12px;width:100%;' +
      'font-size:12.5px;background:#fff">' +
      '<div class="note" id="npGpxMsg" style="margin-top:6px">' +
      '从六只脚 / 两步路 / 手表导出的 .gpx。有轨迹才能建点位——它证明你真的走过。</div></div>' +
      '<div class="field"><label>位置</label>' +
      '<button class="btn ghost" id="npGeo" style="font-size:13px;padding:10px">取当前位置</button>' +
      '<div class="note" id="npGeoMsg" style="margin-top:8px">取不到定位就填个大致位置：</div>' +
      '<input id="npArea" type="text" maxlength="40" placeholder="例如 门头沟 妙峰山附近"></div>' +
      '<div class="field"><label>海拔 · 选填</label>' +
      '<input id="npAlt" type="text" placeholder="例如 1180"></div>' +
      '<div class="field"><label>你的昵称</label>' +
      '<input id="npNick" type="text" maxlength="20" value="' + esc(H.me.name) + '"></div>' +
      '<div class="field"><label>微信号 · 选填（将来寄物料用）</label>' +
      '<input id="npContact" type="text" maxlength="60" placeholder="例如 wx: agan"></div>' +
      /* 两条路：自己开一座山，或者去维护别人已经立好的点位 */
      '<button class="btn coral" data-act="new-point-submit" data-kind="' + kind + '">' +
      (jc ? '成为NPC指路人<em class="btn-note">给后来的人指路</em>'
          : '成为山大王<em class="btn-note">让大家扫码打卡</em>') + '</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="become-master">' +
      '成为版主<em class="btn-note">建立留言板</em></button>');
    var fi = document.getElementById('npGpx');
    fi.onchange = function () {
      var f = this.files && this.files[0];
      var msg = document.getElementById('npGpxMsg');
      if (!f) { npGpx = null; return; }
      if (f.size > 8 * 1024 * 1024) {
        npGpx = null; msg.innerHTML = '<b style="color:var(--coral)">文件超过 8MB，换一个</b>'; return;
      }
      var rd = new FileReader();
      rd.onload = function () {
        npGpx = String(rd.result);
        var n = (npGpx.match(/<trkpt/g) || []).length;
        var e = (npGpx.match(/<ele>/g) || []).length;
        msg.innerHTML = '✓ ' + f.name + ' · ' + n + ' 个轨迹点' +
          (n < 10 ? '<b style="color:var(--coral)">（点太少，至少要 10 个）</b>' : '') +
          (e ? ' · 带海拔' : ' · <b style="color:var(--coral)">没有海拔，算不出爬升</b>');
      };
      rd.readAsText(f);
    };
    document.getElementById('npGeo').onclick = function () {
      var m = document.getElementById('npGeoMsg');
      if (!navigator.geolocation) { m.textContent = '这个浏览器不支持定位，填大致位置吧'; return; }
      m.textContent = '正在取位置…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        npGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        m.textContent = '✓ 已取到 ' + npGeo.lat.toFixed(5) + ', ' + npGeo.lng.toFixed(5);
      }, function () { m.textContent = '拿不到位置，填个大致位置也一样'; }, { timeout: 8000 });
    };
  }

  function newPointSend(kind, btn) {
    npKind = kind === 'junction' ? 'junction' : 'peak';
    var v = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    if (!npGpx) { U.toast('必须选择 GPX 轨迹文件——有轨迹才能建点位'); return; }
    var body = {
      gpx: npGpx,
      name: v('npName'), intro: v('npIntro'), nickname: v('npNick') || H.me.name,
      kind: kind, lat: npGeo.lat, lng: npGeo.lng,
      area: v('npArea') || null,
      altitude: v('npAlt') ? parseInt(v('npAlt'), 10) : null,
      contact: v('npContact') || null
    };
    if (!body.name) { U.toast('先起个名字'); return; }
    if (body.intro.length < 4) { U.toast('写一句怎么走、什么样（至少 4 个字）'); return; }
    btn.disabled = true; btn.textContent = '创建中…';
    apiToken().then(function (tk) {
        if (!tk) throw new Error('请先注册或登录，再创建点位');
        return fetch('/api/points', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify(body)
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
      })
      .then(function (x) {
        btn.disabled = false; btn.textContent = '建好并生成二维码';
        if (!x.ok) {
          U.toast((x.d.detail && x.d.detail.error && x.d.detail.error.message) || '创建失败');
          return;
        }
        showQrSheet(x.d);
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = '建好并生成二维码'; U.toast('创建失败：' + e.message); });
  }

  /* 建好之后：编号 + 二维码 + 试用期考核进度。
     首周不足 3 人 → 冻结；冻结不作废，有人重新扫就复活，只是不能申领物料。 */
  function showQrSheet(c) {
    var people = c.trialPeople || 0;
    var said = c.state === 'frozen'
      ? '已经冻结：试用期内没有 3 个不同的人扫码。二维码不作废，贴出去有人扫' +
        '（近 7 天 ≥3 人）就会自动复活；冻结期间不能申领喷漆和打孔卡。'
      : '试用期还剩 ' + (c.trialDaysLeft || 7) + ' 天，要有 3 个不同的人扫码才算站住。' +
        '满月累计到 ' + (c.monthNeed || 30) + ' 人是底线，到 100 人就能申领物料。';
    U.openSheet(
      '<h3>' + (npKind === 'junction' ? '你是这个岔路口的 NPC 指路人了'
                                       : '你是这座山头的王了') + '</h3>' +
      '<div class="sh-sub">' + esc(c.target_name) + ' · 编号 <b>' + esc(c.code) + '</b></div>' +
      '<div style="text-align:center;padding:8px 0 4px">' +
      '<img src="' + c.qrUrl + '" alt="二维码" style="width:190px;height:190px;' +
      'border:1px solid var(--line);border-radius:14px;background:#fff;padding:8px"></div>' +
      '<div class="note" style="text-align:center;margin-bottom:12px">' +
      '短链 <b>' + esc(c.shortLink) + '</b> · 二维码里印的就是它</div>' +
      '<a class="btn coral" href="' + c.qrUrl + '" download="' + c.code + '.svg">下载二维码（SVG，打印不糊）</a>' +
      /* 建完不是结束，是开始——不提醒他贴出去，这个点位就是死的 */
      '<div class="card" style="margin-top:14px;background:var(--coral-bg);box-shadow:none">' +
      '<b style="font-size:13.5px;color:#C0391C">下一步：把二维码贴出去</b>' +
      '<div style="font-size:12.5px;color:#7A3B27;line-height:1.9;margin-top:7px">' +
      '① 打印出来（A4 一张能印 12 个）<br>' +
      (npKind === 'junction'
        ? '② 贴在岔路口看得见的地方：树上、标牌上、石头正面<br>'
        : '② 贴到你那座山头的起点、岔路口、山顶<br>') +
      '③ 有人扫码，这里就会长出留言和到访记录<br>' +
      '<b>没人扫，这个点位就一直是空的。</b></div></div>' +
      '<div class="card" style="margin-top:14px;background:var(--blue-bg);box-shadow:none">' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0">' +
      '<span style="color:var(--blue-deep)">已有多少人扫过</span><b>' + people + ' 人</b></div>' +
      '<div class="progress" style="margin:8px 0 6px"><i style="width:' +
      Math.min(100, people / 3 * 100) + '%"></i></div>' +
      '<div class="note" style="color:var(--blue-deep)">' + said + '</div></div>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">知道了</button>');
  }

  function footInner(label, list, i) {
    var m = list[i] || { who: '', text: '' };
    var dots = list.length > 1
      ? '<span style="margin-left:6px">' + list.map(function (_, k) {
          return '<i style="display:inline-block;width:4px;height:4px;border-radius:2px;' +
            'margin-left:3px;background:' + (k === i ? 'var(--coral)' : '#D6D0C1') + '"></i>';
        }).join('') + '</span>' : '';
    return '<div style="display:flex;align-items:baseline;gap:8px">' +
      '<span style="font-size:10.5px;color:var(--ink3)">' + esc(label) +
      /* 空态（plain）不报条数，否则会写成"还没有人留言 · 1 条" */
      (m.plain ? '' : ' · ' + list.length + ' 条' + dots) + '</span>' +
      '<span style="margin-left:auto;font-size:11px;font-weight:700;color:var(--ink2)">' +
      esc(m.who) + '</span></div>' +
      '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.55;margin-top:4px;' +
      'min-height:38px">' + m.text + '</div>';
  }

  /* 每 5 秒换下一条留言。换页时先清旧定时器，否则会越积越多 */
  var footTimer = null;
  function startFootRotate() {
    if (footTimer) { clearInterval(footTimer); footTimer = null; }
    if (!document.querySelectorAll('.footbox').length) return;
    footTimer = setInterval(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.footbox'), function (el) {
        var list;
        try { list = JSON.parse(el.getAttribute('data-foot')); } catch (e) { return; }
        if (!list || list.length < 2) return;
        var i = (parseInt(el.getAttribute('data-i'), 10) + 1) % list.length;
        el.setAttribute('data-i', i);
        el.style.transition = 'opacity .3s';
        el.style.opacity = '.2';
        setTimeout(function () {
          el.innerHTML = footInner(el.getAttribute('data-label'), list, i);
          el.style.opacity = '1';
        }, 150);
      });
    }, 5000);
  }

  function claimBtn(key, name, kind) {
    return '<button class="claimbtn" data-act="claim" data-key="' + esc(key) +
      '" data-name="' + esc(name) + '" data-kind="' + kind + '">' +
      (kind === 'junction' ? '当NPC指路人' : '占山为王') + '</button>';
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
      /* 下半：左边标签，右边留言人；内容每 5 秒自动换下一条 */
      '<div class="footbox" data-foot=\'' + JSON.stringify(o.foots) + '\' data-i="0" ' +
      'data-label="' + esc(o.footTitle) + '">' + footInner(o.footTitle, o.foots, 0) + '</div>';
    /* 卡片里要塞一个「@线路」链接，所以外层不能再是 <a>（锚点不能套锚点）：
       上半截自己是一个链接，@线路 单独一行。 */
    var top = o.href ? '<a href="' + o.href + '" style="display:block">' + inner + '</a>' : inner;
    var via = o.route ? '<a class="lcvia" href="#/trails/' + o.route.slug + '">@' +
      esc(o.route.name) + ' · 看整条路书 ›</a>' : '';
    return '<div class="card' + (o.href ? '' : '') + '" style="padding:0;overflow:hidden;' +
      'margin-bottom:12px">' + top + via + '</div>';
  }

  /* ==================== 山头页 ==================== */
  /* 点位详情：山脚、还没进榜的山顶，前端没有它们的卡，直接按编号去后端取。
     ——「扫一次码点亮一格」，点那一格当然也得打得开。 */
  var _loading = {}, _pointErrors = {};
  var _communityLoading = {};
  function hydratePeakCommunity(p) {
    if (!p.code || (p.communityReady && p.commentsReady) || _communityLoading[p.code]) return;
    _communityLoading[p.code] = true;
    var detail = p.communityReady ? Promise.resolve(null) : fetch('/api/points/' + encodeURIComponent(p.code)).then(function (r) {
      if (!r.ok) throw new Error('community unavailable');
      return r.json();
    });
    detail.then(function (d) {
      if (d) {
        p.maintainerName = d.maintainerName;
        p.recentContribution = d.recentContribution;
        p.pendingCount = d.pendingCount;
        p.pointId = d.id;
        p.visitCount = d.visitCount;
        p.boardId = d.boardId;
        p.boardPointCodes = d.boardPointCodes;
        p.communityReady = true;
      }
      return Promise.all([
        fetch('/api/points/' + p.pointId + '/comments?limit=20').then(function (r) {
          if (!r.ok) throw new Error('comments unavailable');
          return r.json();
        }),
        fetch('/api/points/' + encodeURIComponent(p.code) + '/ads').then(function (r) {
          return r.ok ? r.json() : { items: [] };
        })
      ]);
    }).then(function (results) {
      p.comments = (results[0].items || []).map(function (c) {
        return { who: c.nickname || '山友', when: new Date(c.created_at).toLocaleDateString(),
          text: c.text, mine: false, top: c.is_maintainer, real: true };
      });
      p.boardAds = results[1].items || [];
      p.commentsReady = true;
      if ((parse().name === 'peak' || parse().name === 'arrive') && parse().id === p.id) render();
    }).catch(function () { p.communityError = true; })
      .then(function () { delete _communityLoading[p.code]; });
  }
  function mountainMaintenance(p) {
    if (!p.code) return '';
    var role = myPeakRole(p.code);
    var title = role === 'collaborator' ? '协作维护 · 待核验 ' + (p.pendingCount || 0) + ' 条信息'
      : role ? '大王，今天有 ' + (p.pendingCount || 0) + ' 条信息待核验'
      : p.maintainerName ? '这座山有人维护' : '这座山，等一位山大王';
    var detail = role === 'collaborator' ? '进入维护台，协助处理这块板的留言'
      : role ? '进入维护台，处理留言与广告素材' : p.maintainerName
      ? '维护人 ' + esc(p.maintainerName) + (p.recentContribution ? ' · 最近贡献：' + esc(p.recentContribution) : '')
      : '维护山顶留言板，核验山友留下的信息';
    var action = role ? '<a class="btn coral" href="#/admin/p/' + esc(p.code) + '">进入维护台</a>'
      : p.maintainerName ? '<button class="btn ghost" data-act="collaboration-open" data-code="' + esc(p.code) + '">' +
        (p.collaborationStatus === 'pending' ? '申请审核中' : p.collaborationStatus === 'rejected' ? '重新申请协作' : '我也来帮忙') + '</button>'
      : '<button class="btn coral" data-act="master-claim" data-code="' + esc(p.code) + '" data-name="' + esc(p.name || p.code) + '">查看职责与福利</button>';
    return '<div class="sec-head"><h3>山头维护</h3></div><div class="card">' +
      '<b style="font-size:15px">' + title + '</b><div class="hint">' + detail + '</div>' + action + '</div>';
  }
  function loadPointByCode(code) {
    if (_loading[code]) return;
    _loading[code] = 1;
    fetch('/api/points/' + encodeURIComponent(code))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { _pointErrors[code] = '未找到这个扫码点位，请核对编号。'; render(); return; }
        var tc = d.topComment;
        H.peaks.unshift({
          id: 'p-' + d.code, pointId: d.id, code: d.code, origin: 'user',
          type: d.type,                      /* peak / junction —— 决定这页上的说法 */
          name: d.name, alt: d.altitude, trailName: d.route_name,
          routeSlug: d.route_slug, city: null, level: d.level,
          km: 0, rise: 0, peakCount: d.total_in_route || 1,
          lat: null, lng: null,
          visits30: 0, visitCount: d.visitCount || 0, fastest: null, holder: null, photos: 0,
          board: [], communityReady: true, maintainerName: d.maintainerName,
          boardId: d.boardId, boardPointCodes: d.boardPointCodes,
          recentContribution: d.recentContribution, pendingCount: d.pendingCount,
          comments: tc ? [{ who: tc.nickname, when: '最新一条', text: tc.text,
                            mine: false, top: tc.is_maintainer }] : []
        });
        render();
      })
      .catch(function (e) {
        /* 这里以前把原因吞掉了，页面上只留一句"读取点位失败"，查不出是哪一步挂的 */
        console.error('读取点位失败', code, e);
        _pointErrors[code] = '点位加载失败，请稍后重试。'; render();
      });
  }

  function peakView(id) {
    var p = peak(id);
    if (!p && id.indexOf('p-') === 0) {
      loadPointByCode(id.slice(2));
      return '<div class="pad"><div class="empty">正在读取点位 ' + esc(id.slice(2)) +
        ' …</div></div>';
    }
    if (!p) return notFound();
    hydratePeakCommunity(p);
    var board = p.board.map(function (b) { return { pos: b.pos, av: personByName(b.who), name: b.who, sub: b.when, time: b.time }; });
    if (S.mySeqs[p.id] && S.pb[p.id]) {
      board = board.filter(function (b) { return b.name !== '你'; });
      board.push({ pos: 0, av: H.me, name: '你', sub: '个人最好', time: S.pb[p.id], mine: true });
      board.sort(function (a, b) { return a.time.localeCompare(b.time); });
      board.forEach(function (b, i) { b.pos = i + 1; });
    }
    var cs = commentsFor(p.id);
    var want = isWant(p.id);
    var selfBuilt = p.origin === 'user';        /* 用户自己上传 GPX 建的点位 */
    var isJunction = p.type === 'junction';     /* 自建的岔路点位也走这个页面模板 */
    return (
      '<div class="hero tall">' + U.scene(p.id) +
      '<div class="floating"><a href="#/places"><span class="pill">‹ 返回</span></a></div>' +
      '<div class="floating right"><span class="pill">' +
      (selfBuilt ? (isJunction ? '岔路 · ' : '山头 · ') + esc(p.code)
                 : (isJunction ? '岔路 · 路书点' : '山头 · 打卡点')) + '</span></div>' +
      (p.code ? '' : claimBtn(p.id, p.name || p.trailName, isJunction ? 'junction' : 'peak')) + '</div>' +
      '<div class="pad">' +
      /* 首屏只放**被审核提到第一屏**的广告；维护人自己投的默认都在留言区顶部 */
      adCarousel(adsOf(p.code).first, '推荐 · 广告') +
      '<h2 class="arrive-h" style="margin-top:0">' + esc(p.name || '名称待定') + '</h2>' +
      '<p class="arrive-p">' +
      (p.name ? esc(p.name) + ' · ' : '<span class="soon-tag">待命名</span>') +
      (p.alt ? '海拔 ' + p.alt + ' m' : '海拔待补') +
      (p.trailName ? ' · 属于「' + esc(p.trailName) + '」'
                   : ' · 轨迹 ' + p.km + ' km · 爬升 ' + p.rise + ' m') + '</p>' +
      '<div class="hint" style="margin:-8px 2px 14px;display:flex;gap:12px;flex-wrap:wrap">' +
      '<span>' + (p.pointId ? '累计到访 ' : '本周热度 ') + '<b style="color:var(--coral)">' +
      (p.pointId ? p.visitCount || 0 : p.visits30 || 0) + '</b></span>' +
      (p.lat ? '<span>坐标 ' + p.lat + ', ' + p.lng + '</span>'
             : '<span>坐标待采集</span>') +
      '</div>' +
      U.signage(p, { code: p.code || ('PK-' + p.id.toUpperCase()), realQR: !!p.pointId }) +
      mountainMaintenance(p) +

      '<div class="sec-head"><h3>用时榜</h3><span class="more">今日 · 好友 · 我的纪录 ›</span></div>' +
      '<div class="card tight">' + (board.length ? rankRows(board) +
      '<div style="font-size:11.5px;color:var(--ink3);padding:10px 0 2px">' +
      (selfBuilt ? '共 ' + board.length + ' 人登顶 · 请以安全返程为第一目标'
                 : '共 37 人今日登顶 · 请以安全返程为第一目标') + '</div>'
        : '<div class="empty">暂无个人用时。<br>' +
          '<span style="font-size:12.5px">已有 ' + (p.visitCount || 0) + ' 次到访记录；用时按明确路段分别统计。</span></div>') + '</div>' +

      '<div class="sec-head"><h3>山顶照片墙</h3><span class="more">' + p.photos + ' 张 ›</span></div>' +
      (selfBuilt
        ? '<div class="empty" style="padding:22px 0"><span class="big">📷</span>照片还没开<br>' +
          '<span style="font-size:12.5px">等第一个到访的人来贴</span></div>'
        : '<div class="photowall">' + [1, 2, 3].map(function (i) {
            return '<div class="pw">' + U.scene(p.id + '-photo' + i, { palette: (i * 2) % 6 }) + '</div>';
          }).join('') + '</div>') +

      '<div class="sec-head"><h3>留言板</h3><span class="more">全部 ›</span></div>' +
      /* 维护人的广告位默认就在这儿：留言板最上面（第一屏之外） */
      adCarousel(adsOf(p.code).board, '这座山的广告位') +
      (myPeakRole(p.code) && myPeakRole(p.code) !== 'collaborator' ? maintainerAdEntry(p) : '') +
      (cs.length ? cs.slice(0, 3).map(commentCard).join('') : '<div class="empty">还没有留言。</div>') +

      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="want" data-id="' + p.id + '" data-on="♥ 已收藏到想去" data-off="♡ 收藏到想去">' + (want ? '♥ 已收藏到想去' : '♡ 收藏到想去') + '</button>' +
      (p.code ? '<button class="btn coral" data-act="guest-checkin" data-code="' + esc(p.code) + '">我也到了</button>' :
        '<button class="btn coral" data-act="checkin" data-type="peak" data-id="' + p.id + '">' +
        (beenThere(p.id) ? '再打一次卡' : '我也到了') + '</button>') +
      '</div>' +
      (p.code ? '<button class="btn ghost" style="margin-top:9px" data-act="arrival-draft" data-code="' +
        esc(p.code) + '">在留言板写一句</button>' :
        '<button class="btn ghost" style="margin-top:9px" data-act="comment-open" data-type="peak" data-id="' +
        p.id + '">在留言板写一句</button>')
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
      '<div class="floating right"><span class="pill">岔路 · 路书点</span></div>' +
      claimBtn(j.id, j.name, 'junction') + '</div>' +
      '<div class="pad">' +
      /* 岔路口同一套规则：默认在情报区顶部（屏外），被审核提升的才上首屏 */
      adCarousel(adsOf(j.code).first, '推荐 · 广告') +
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
      adCarousel(adsOf(j.code).board, '这个岔路口的广告位') +
      (myPeakRole(j.code) && myPeakRole(j.code) !== 'collaborator' ? maintainerAdEntry(j) : '') +
      intelFor(j).map(function (i) { return intelCard(i, j.id); }).join('') +
      '<div class="hint" style="text-align:center">一条情报被 3 个人确认后会自动升级为「已核验」</div>' +

      '<button class="btn ghost" data-act="intel-open" data-id="' + j.id + '">上报一条情报</button>' +
      '<button class="btn coral" style="margin-top:9px" data-act="checkin" data-type="junction" data-id="' + j.id + '">' +
      (beenThere(j.id) ? '再打一次卡' : '顺路打卡') + '</button>' +
      '<div class="hint" style="text-align:center">路过这里也可以打卡，留下「我走过这一段」</div>'
      + '</div>'
    );
  }

  /* ==================== 消息 ====================
     第一屏是"我要负责的山头"和"我关注的山头"，然后是留言提醒；
     最后才是原有的互动 / 请求 / 信件 / 系统（那几组还是示例数据）。 */

  /* 自己开的点位分两种说法：山头是「山大王」，岔路口是「NPC指路人」。
     接管留言板的两种点位都叫「维护人」。 */
  function roleTag(role, type) {
    return '<span class="pill-btn ' + (role === 'maintainer' ? 'acc' : '') +
      '" style="font-size:10.5px;padding:1px 7px;margin-left:6px">' +
      (role === 'maintainer' ? '维护人'
        : role === 'collaborator' ? '协作者'
        : (type === 'junction' ? 'NPC指路人' : '山大王')) + '</span>';
  }

  function unreadTag(n) {
    return n ? '<span class="pill-btn acc" style="font-size:10.5px;padding:1px 7px;margin-left:6px">' +
      n + ' 条新留言</span>' : '';
  }

  /* 我的山头：我维护的（版主）+ 我自己开的（山大王）。
     维护人这一行多一个「维护 · 管留言」入口——这就是"更高权限"的落点。 */
  function mySummitsBlock() {
    var mine = H.mySummits || [];
    var unread = mine.reduce(function (n, x) { return n + (x.unread || 0); }, 0);
    var head = '<div class="group-label">我的山头' +
      (unread ? '<span style="color:var(--coral);margin-left:6px">' + unread + ' 条新留言</span>' : '') +
      '</div>';
    if (!mine.length) {
      return head +
        '<div class="card" style="text-align:center;padding:18px 14px">' +
        '<div style="font-size:13.5px;font-weight:700">你还没有山头</div>' +
        '<div style="font-size:12.5px;color:var(--ink3);margin:6px 0 12px">' +
        '自己开一座山或立一个岔路点位（拿编号和二维码），或者接管一个已有山头的留言板</div>' +
        '<a class="btn coral mini" href="#/me/peak">去占山为王</a></div>';
    }
    return head + mine.map(function (m) {
      return '<div class="msg"><div class="tx" style="flex:1;min-width:0">' +
        '<b>' + (m.name ? esc(m.name) : '<span class="tbd">名称待定</span>') +
        roleTag(m.role, m.type) + unreadTag(m.unread) + '</b>' +
        '<em>' + esc(m.code) + (m.altitude ? ' · 海拔 ' + m.altitude + ' m' : '') +
        (m.city ? ' · ' + esc(m.city) : '') + '</em>' +
        '<p style="margin-top:6px">留言 ' + m.commentCount + ' 条' +
        (m.heat7 ? ' · 本周打卡 ' + m.heat7 + ' 人' : '') + '</p>' +
        '<div class="mini-actions">' +
        '<a class="pill-btn acc" href="#/peaks/p-' + esc(m.code) + '">进留言板 ›</a>' +
        (m.role === 'maintainer' || m.role === 'collaborator'
          ? '<button class="pill-btn" data-act="summit-board" data-id="' + m.pointId +
            '">维护 · 管留言</button>' : '') +
        '</div></div></div>';
    }).join('');
  }

  /* 我关注的山头：留言有更新，这里和下面的提醒都会亮 */
  function followBlock() {
    var list = H.followPeaks || [];
    var unread = list.reduce(function (n, x) { return n + (x.unread || 0); }, 0);
    var head = '<div class="group-label">我关注的山头' +
      (unread ? '<span style="color:var(--coral);margin-left:6px">' + unread + ' 条新留言</span>' : '') +
      '</div>';
    if (!list.length) {
      return head + '<div class="card" style="padding:16px 14px">' +
        '<div style="font-size:13px;color:var(--ink2)">去山头页点 ♡ 关注一座山，' +
        '它的留言板有更新就会提醒你。</div>' +
        '<a class="btn ghost mini" style="margin-top:10px" href="#/places">去挑山头</a></div>';
    }
    return head + list.map(function (f) {
      return '<div class="msg"><div class="tx" style="flex:1;min-width:0">' +
        '<b>' + (f.name ? esc(f.name) : '<span class="tbd">名称待定</span>') + unreadTag(f.unread) + '</b>' +
        '<em>' + esc(f.code || '') + (f.altitude ? ' · 海拔 ' + f.altitude + ' m' : '') +
        (f.city ? ' · ' + esc(f.city) : '') + '</em>' +
        '<p style="margin-top:6px">留言 ' + f.commentCount + ' 条</p>' +
        '<div class="mini-actions">' +
        (f.code ? '<a class="pill-btn acc" href="#/peaks/p-' + esc(f.code) + '">进留言板 ›</a>' : '') +
        '</div></div></div>';
    }).join('');
  }

  /* 留言提醒：我维护的 + 我关注的山头上的新留言 */
  function notifBlock() {
    var list = H.notif || [];
    if (!list.length) return '';
    var unread = list.filter(function (x) { return x.unread; }).length;
    var head = '<div class="group-label">留言提醒' +
      (unread ? '<span style="color:var(--coral);margin-left:6px">' + unread + ' 条未读</span>' : '') +
      '</div>';
    return head + list.slice(0, 10).map(function (n) {
      return '<div class="msg">' +
        '<div class="tx" style="flex:1;min-width:0">' +
        '<b>' + esc(n.who || '山友') +
        (n.unread ? '<span class="pill-btn acc" style="font-size:10.5px;padding:1px 7px;margin-left:6px">新</span>' : '') +
        '<span class="pill-btn" style="font-size:10.5px;padding:1px 7px;margin-left:6px">' +
        (n.reason === 'maintainer' ? '你维护的' : '你关注的') + '</span></b>' +
        '<p style="margin-top:4px">' + esc(n.text) + '</p>' +
        '<div class="mini-actions"><a class="pill-btn acc" href="#/peaks/p-' + esc(n.code) + '">' +
        (n.peakName ? esc(n.peakName) : esc(n.code || '这个山头')) + ' 的留言板 ›</a>' +
        (n.reason === 'maintainer'
          ? '<button class="pill-btn" data-act="summit-board" data-id="' + n.pointId + '">维护</button>' : '') +
        '</div></div></div>';
    }).join('') +
      (unread ? '<button class="btn ghost" style="margin-top:8px" data-act="notif-seen">全部标记已读</button>' : '');
  }

  var _hiddenCommentsLoading = false, _hiddenCommentsLoaded = false;
  function loadHiddenComments() {
    if (_hiddenCommentsLoading || _hiddenCommentsLoaded) return;
    _hiddenCommentsLoading = true;
    apiToken().then(function (tk) {
      return tk ? window.API.ja('/api/me/hidden-comments') : [];
    }).then(function (items) {
      H.hiddenComments = items || [];
      _hiddenCommentsLoaded = true;
      if (parse().name === 'messages') render();
    }).catch(function () { H.hiddenComments = []; })
      .then(function () { _hiddenCommentsLoading = false; });
  }
  function hiddenCommentsBlock() {
    var items = H.hiddenComments || [];
    if (!items.length) return '';
    return '<div class="group-label">我的内容处置</div>' + items.map(function (c) {
      var appeal = c.appeal;
      var status = appeal ? (appeal.status === 'pending' ? '申诉审核中' :
        appeal.status === 'rejected' ? '申诉未通过' : '已恢复') : '已隐藏';
      return '<div class="msg"><div class="tx" style="flex:1;min-width:0">' +
        '<b>' + esc(c.pointName || c.pointCode || '山顶留言板') +
        '<span class="pill-btn" style="font-size:10.5px;padding:1px 7px;margin-left:6px">' + status + '</span></b>' +
        '<p>' + esc(c.text) + '</p>' +
        (appeal && appeal.reviewNote ? '<em>' + esc(appeal.reviewNote) + '</em>' : '') +
        (c.appealable && !appeal ? '<div class="mini-actions"><button class="pill-btn acc" ' +
          'data-act="appeal-open" data-id="' + c.id + '">申请复核</button></div>' : '') +
        '</div></div>';
    }).join('');
  }

  /* 维护人视角的留言板管理：列出这个山头的留言，可以逐条隐藏（隐藏不删除，留痕） */
  function sheetSummitBoard(pid) {
    U.openSheet('<h3>留言板 · 维护人</h3><div class="sh-sub">正在加载…</div>');
    window.API.ja('/api/points/' + pid + '/comments?limit=50').then(function (d) {
      var rows = (d && d.items) || [];
      var el = document.getElementById('sheet');
      if (!el) return;
      el.innerHTML = '<h3>留言板 · 维护人</h3>' +
        '<div class="sh-sub">可处理本板留言；隐藏他人内容需要说明理由，记录可追溯。</div>' +
        (rows.length
          ? '<div class="card tight">' + rows.map(function (c) {
              return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--hair)">' +
                '<div style="flex:1;min-width:0">' +
                '<b style="font-size:13px">' + esc(c.nickname || '山友') + '</b>' +
                (c.is_maintainer ? '<span class="pill-btn acc" style="font-size:10px;padding:0 6px;margin-left:6px">维护人</span>' : '') +
                '<em style="font-style:normal;display:block;font-size:11px;color:var(--ink3)">' +
                esc(String(c.created_at || '').slice(0, 16).replace('T', ' ')) + '</em>' +
                '<p style="font-size:13px;margin:4px 0 0">' + esc(c.text) + '</p></div>' +
                '<button class="pill-btn" data-act="hide-comment" data-id="' + c.id +
                '" data-pid="' + pid + '">隐藏</button></div>';
            }).join('') + '</div>'
          : '<div class="empty">这个山头还没有留言。</div>') +
        '<button class="btn ghost" style="margin-top:12px" data-act="close">关闭</button>';
    }).catch(function () {
      var el = document.getElementById('sheet');
      if (el) el.innerHTML = '<h3>留言板 · 维护人</h3>' +
        '<div class="empty">没加载出来（多半是登录态过期）。重新加载页面试试。</div>' +
        '<button class="btn ghost" data-act="close">关闭</button>';
    });
  }

  function messagesView() {
    loadHiddenComments();
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
    return mySummitsBlock() + notifBlock() + hiddenCommentsBlock() + followBlock() + body +
      '<div class="hint" style="text-align:center">每条通知都带一个地点上下文胶囊，点它回到现场，而不是回到某个人的主页</div>';
  }

  /* ==================== 我 ==================== */
  function recordCard() {
    /* 登顶记录：一座山一行（取最好那次的用时），点整张卡看全部记录。
       数据是真的——就是我的打卡流水，一条都不编。 */
    var recs = summitRecords();
    if (!recs.length) {
      return '<div class="card record"><div class="row-between" style="margin-bottom:6px">' +
        '<h3 style="font-size:16px;font-weight:800">我的登顶 records</h3></div>' +
        '<div class="empty" style="padding:18px 0"><span class="big">⛰</span>还没有登顶记录<br>' +
        '<span style="font-size:12.5px">到山顶扫一次码，这里就记上时间</span></div></div>';
    }
    var bySummit = {};
    recs.forEach(function (r) {
      var k = r.name;
      if (!bySummit[k] || (r.time && (!bySummit[k].time || r.time < bySummit[k].time))) {
        bySummit[k] = bySummit[k] || {};
        bySummit[k] = { name: r.name, level: r.level, alt: r.alt, time: r.time,
                        at: r.at, count: 0 };
      }
      bySummit[k].count++;
    });
    var list = Object.keys(bySummit).map(function (k) { return bySummit[k]; });
    var rows = list.map(function (s) {
      return '<div class="row">' +
        '<span class="ic ' + (s.level === 'easy' ? 'g' : s.level === 'mid' ? 'b' : '') + '">' +
        '<span class="lvshape">' + U.shapeSVG(s.level) + '</span></span>' +
        '<span class="nm"><b>' + esc(s.name) + '</b>' +
        '<em>' + (s.alt ? '海拔 ' + s.alt + ' m · ' : '') + esc(fmtDay(s.at)) +
        (s.count > 1 ? ' · 来过 ' + s.count + ' 次' : '') + '</em></span>' +
        '<span class="tm' + (s.time ? ' pb' : '') + '">' + (s.time || '—') + '</span></div>';
    }).join('');
    return '<button class="card record" style="width:100%;text-align:left;font-family:inherit" ' +
      'data-act="records-all">' +
      '<div class="row-between" style="margin-bottom:4px"><h3 style="font-size:16px;font-weight:800">' +
      '我的登顶 records</h3>' +
      '<span class="tiny muted">' + list.length + ' 座 · 共 ' + recs.length + ' 次 ›</span></div>' +
      '<div class="tiny muted" style="margin-bottom:8px">用时只和自己比 · 点开看每一次的年月日</div>' +
      '<div>' + rows + '</div>' +
      '<div class="tiny muted" style="margin-top:10px">' +
      '橙色是最快的一次；同一座山去过多次会分开记。</div>' +
      '</button>';
  }

  /* 把打卡流水整理成登顶记录：只算山顶（山脚打卡不算登顶） */
  function summitRecords() {
    return (S.visited || []).map(function (v) {
      /* S.visited 里的 id 是后端 pointId（数字），不是 'p-CODE'，得按 pointId 找 */
      var p = peakById(v.pointId || v.id);
      return { name: v.name || (p && p.name) || '名称待定',
               level: v.level || (p && p.level) || 'mid',
               alt: (p && p.alt) || null, time: v.time || null, at: v.at || null,
               pointId: v.pointId || (p && p.pointId),
               isTrailhead: /-S$/.test(v.code || '') };
    }).filter(function (r) { return !r.isTrailhead; });
  }

  function fmtDay(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function fmtFull(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* 点卡片：一条一条列出来，年月日时都有 */
  function sheetRecords() {
    var recs = summitRecords().slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    });
    U.openSheet('<h3>登顶记录</h3><div class="sh-sub">' +
      recs.length + ' 次登顶 · 时间精确到分钟</div>' +
      '<div class="card tight">' + recs.map(function (r) {
        var pk = peakById(r.pointId);
        return '<a class="hotrow" href="' + (pk ? '#/peaks/' + pk.id : '#/me') + '">' +
          '<span class="no">' + (r.alt ? r.alt : '⛰') + '</span>' +
          '<span class="nm"><b>' + esc(r.name) + '</b>' +
          '<em>' + esc(fmtFull(r.at)) + '</em></span>' +
          '<span class="mt">' + (r.time ? '用时 ' + r.time : '没记用时') + '</span></a>';
      }).join('') + '</div>' +
      '<div class="note" style="margin-top:10px">每在山上扫一次码就多一条；' +
      '同一天同一个点位只算一次。</div>' +
      '<button class="btn ghost" data-act="close">收起</button>');
  }
  function peakById(pid) {
    return (H.peaks || []).filter(function (p) { return p.pointId === pid; })[0];
  }

  /* ---------- 山径拼图 ----------
     每一格就是一座**真实的山头**：点亮 = 你去过它，点一下进那座山的详情页
     （留言板就在里头）。以前是"到过 N 个点位就点亮 N 格"，格子不对应任何一座山，
     点也点不开——那种进度条骗得了自己，骗不了用户。 */
  function puzzleTotals() {
    var pr = H.progress || [], lit = 0, all = 0;
    pr.forEach(function (r) {
      all += r.summits.length;
      lit += r.summits.filter(function (s) { return s.count; }).length;
    });
    return { lit: lit, all: all, routes: pr.length };
  }

  function puzzleBlock(withProgress) {
    var pr = H.progress || [];
    var t = puzzleTotals();
    if (!pr.length) {
      return (withProgress ? '<div class="row-between"><h3 style="font-size:16px;font-weight:800">' +
          '山径拼图</h3></div>' : '') +
        '<div class="empty"><span class="big">⛰</span>还没有点亮的格子<br>' +
        '<span style="font-size:12.5px">山上扫一次码就点亮一座山——' +
        '山脚和山顶都扫了，格子里就有这次登顶用时</span></div>' + trackUploadBox();
    }
    return (withProgress
        ? '<div class="row-between"><h3 style="font-size:16px;font-weight:800">山径拼图</h3>' +
          '<span class="tiny muted">' + t.lit + '/' + t.all + ' 座 · ' + t.routes + ' 条线</span></div>' +
          '<div class="progress"><i style="width:' + Math.round(t.lit / t.all * 100) + '%"></i></div>'
        : '') +
      pr.map(function (r) {
        return '<div class="pzrow">' +
          '<div class="pzh"><b>' + esc(r.routeName) + '</b>' +
          '<span>' + r.visited + '/' + r.total +
          (r.complete ? ' · <i>完整记录</i>' : '') + '</span></div>' +
          '<div class="pzgrid">' + r.summits.map(function (sm) {
            return summitCell(sm);
          }).join('') + '</div></div>';
      }).join('') +
      '<div class="tiny muted" style="margin-top:6px">' +
      '一格是一座山：山脚和山顶各一个扫码点。只扫一个只是点亮；' +
      '两个都扫了，格子里就是这次登顶用时。点格子看每一次的记录。</div>' +
      trackUploadBox();
  }

  /* ---------- 传轨迹 ----------
     手机上没有"文件系统"这个概念给普通用户——**微信聊天记录就是文件管理器**。
     所以最简路径不是教他"导出到文件"，而是：手表 App 分享到微信 → 我们这儿从聊天记录选。 */
  /* 选中文件 → 读出来发后端 → 解析出的山顶变成拼图候选 */
  function uploadTrack(file) {
    if (!file) return;
    if (!/\.(gpx|kml|tcx|fit)$/i.test(file.name)) {
      U.toast('这看着不是轨迹文件——要 .gpx / .kml');
      return;
    }
    if (/\.(tcx|fit)$/i.test(file.name)) {
      U.toast('TCX / FIT 还读不了，先在手表 App 里导出 GPX');
      return;
    }
    U.toast('正在解析…');
    var rd = new FileReader();
    rd.onload = function () {
      apiToken().then(function (tk) {
        if (!tk) { U.toast('上传失败：拿不到登录凭证'); return; }
        fetch('/api/tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ text: String(rd.result), filename: file.name })
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (x) {
            if (!x.ok) {
              U.toast((x.d.detail && x.d.detail.error && x.d.detail.error.message) || '解析失败');
              return;
            }
            H.myTracks = [x.d].concat(H.myTracks || []);
            render();
            U.toast('识别到 ' + x.d.peakCount + ' 座山，已摆进拼图（灰色待点亮）');
          })
          .catch(function (e) { U.toast('上传失败：' + e.message); });
      });
    };
    rd.readAsText(file);
  }

  function trackUploadBox() {
    var ts = H.myTracks || [];
    return '<div class="upbox">' +
      '<div class="ubt">走了一条我们还没有的线？把轨迹传上来</div>' +
      '<div class="ubn"><b>手机上三步，全在微信里：</b>' +
      '① 手表 App 里那条记录 → 分享 → 发到微信「文件传输助手」<br>' +
      '② 回到这里点下面的按钮<br>' +
      '③ 弹窗里选「从聊天记录选择」→ 点那个文件</div>' +
      '<div class="ubn" style="color:var(--ink3)">' +
      '支持 GPX / KML（佳明、高驰、颂拓、华为、Strava 都能导出）。' +
      '传上来只是把格子**摆成灰色候选**——上山扫码才会点亮。</div>' +
      '<input id="trkFile" type="file" accept=".gpx,.kml,.tcx,.fit" style="display:none">' +
      '<button class="btn ghost" data-act="pick-track">传轨迹文件</button>' +
      (ts.length ? '<div class="ubt" style="margin-top:14px">我传过的轨迹（' + ts.length + '）</div>' +
        ts.map(function (t) {
          return '<div class="pzrow"><div class="pzh"><b>' + esc(t.name) + '</b>' +
            '<span>' + t.km + ' km · ↗ ' + (t.up || 0) + ' m · ' + t.peaks.length + ' 座 ›</span></div>' +
            '<div class="pzgrid">' + t.peaks.map(function (p, i) {
              return '<button class="pzcell cand" data-act="track-peak" ' +
                'data-track="' + t.id + '" data-i="' + i + '">' +
                '<span class="h"><b>顶' + (i + 1) + '</b></span>' +
                '<span class="mt">' + p.ele + ' m · 候选</span></button>';
            }).join('') + '</div></div>';
        }).join('') : '') +
      '</div>';
  }

  /* 一座山一格。格里三样：山脚 / 山顶 两个扫码点，人 · 时间 · 次数 */
  function summitCell(sm) {
    var lit = sm.count > 0;
    var last = sm.times.length ? sm.times[sm.times.length - 1] : null;
    return '<button class="pzcell' + (lit ? ' lit' : '') + (sm.climbTime ? ' timed' : '') +
      '" data-act="summit-cell" data-code="' + esc(sm.code) + '">' +
      '<span class="h"><b>' + (sm.name ? esc(sm.name) : '名称待定') + '</b>' +
      (sm.climbTime ? '<i>' + sm.climbTime + '</i>' : '') + '</span>' +
      '<span class="pts">' +
      '<em class="' + (sm.start && sm.start.mine ? 'on' : '') + '">山脚</em>' +
      '<em class="' + (sm.top && sm.top.mine ? 'on' : '') + '">山顶</em>' +
      '</span>' +
      '<span class="mt">' + (lit
        ? '我 · ' + shortDay(last.at) + ' · ×' + sm.count
        : (sm.altitude ? sm.altitude + ' m · 未到' : '未到')) + '</span>' +
      '</button>';
  }
  function shortDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* 点一格：这一座山的每一次打卡，谁、什么时候、用时多少 */
  function sheetSummitCell(code) {
    var hit = null;
    (H.progress || []).forEach(function (r) {
      r.summits.forEach(function (sm) { if (sm.code === code) hit = { r: r, sm: sm }; });
    });
    if (!hit) return;
    var sm = hit.sm;
    U.openSheet('<h3>' + (sm.name ? esc(sm.name) : '名称待定') + '</h3>' +
      '<div class="sh-sub">' + esc(hit.r.routeName) +
      (sm.altitude ? ' · 海拔 ' + sm.altitude + ' m' : '') + '</div>' +
      '<div class="card" style="box-shadow:none;background:var(--blue-bg);padding:14px">' +
      '<div style="display:flex;gap:10px">' +
      '<div style="flex:1"><div style="font-size:11px;color:#2B3568">山脚扫码点</div>' +
      '<div style="font-size:13.5px;font-weight:800;margin-top:3px">' +
      (sm.start.code || '—') + '</div>' +
      '<div style="font-size:11.5px;color:#2B3568;margin-top:2px">' +
      (sm.start.mine ? '我去过 ' + sm.start.mine + ' 次' : '还没扫') + '</div></div>' +
      '<div style="flex:1"><div style="font-size:11px;color:#2B3568">山顶扫码点</div>' +
      '<div style="font-size:13.5px;font-weight:800;margin-top:3px">' +
      sm.top.code + '</div>' +
      '<div style="font-size:11.5px;color:#2B3568;margin-top:2px">' +
      (sm.top.mine ? '我登顶 ' + sm.top.mine + ' 次' : '还没扫') + '</div></div>' +
      '</div></div>' +
      (sm.times.length
        ? '<div class="group-label" style="margin-top:14px">我的打卡记录</div>' +
          '<div class="card tight">' + sm.times.slice().reverse().map(function (x) {
            return '<div class="hotrow"><span class="no">' +
              (x.time ? x.time : '—') + '</span>' +
              '<span class="nm"><b>' + esc(fmtFull(x.at)) + '</b>' +
              '<em>' + (x.time ? '这次登顶用时 ' + x.time
                               : '只扫了山顶，没扫山脚 → 不算完整登顶') + '</em></span>' +
              '<span class="mt">我</span></div>';
          }).join('') + '</div>'
        : '<div class="empty" style="padding:20px 0">还没扫过这个扫码点</div>') +
      '<a class="btn coral" style="margin-top:14px" href="' + sm.href +
      '" data-act="close">去它的留言板</a>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">收起</button>');
  }

  function meView() {
    var visitedCount = S.visited.length;
    return '<div class="profile"><div class="big">我</div>' +
      '<div><b>' + esc(H.me.name) + '</b><span>到过 ' + visitedCount + ' 个点位 · 认领 1 座山头 · 连续 ' + H.me.streak + ' 周上山</span></div></div>' +

      '<div class="card">' +
      puzzleBlock(true) + '</div>' +

      recordCard() +
      /* 「我去过的地方」删掉了——到访记录已经在上面那张登顶 records 卡里，
         再开一个入口就是同一个东西看两遍。 */
      rowlink('#/me/want', '♡', '我想去的地方 ' + S.want.length, '收藏的线路和山峰') +
      /* 我的山头 = 拿二维码的地方，不是展示位 */
      rowlink('#/me/peak', '⛰', '我的山头',
        '成为山大王 / NPC指路人拿二维码 · 成为版主管留言板') +
      rowlink('#/me/letters', '✉', '山间信箱 ' + (H.letters.length + S.letters.length) +
        '<span class="soon-tag">待开发</span>', '未来信数据表还没建，下面是示例') +
      rowlink('#/me/activity', '＋', '发起周末活动<span class="soon-tag">待开发</span>',
        '选一条路，约人一起走') +
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
        puzzleBlock(true) + '</div>';
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
      var t = trail(id), p = t ? null : peak(id);
      if (!t && !p) return '';
      var name = t ? t.name : (p.name || '名称待定');
      var sub = t
        ? (t.km + ' km · ↗ ' + t.up + ' m · ' + esc(t.hours || '') + ' · 线路')
        : (p.alt + ' m' + (p.city ? ' · ' + esc(p.city) : '') +
           (p.trailName ? ' · @' + esc(p.trailName) : '') + ' · 山头');
      return '<div class="rank"><span class="thumb">' + U.scene((t || p).id) + '</span>' +
        '<span class="nm"><a href="' + (t ? '#/trails/' + t.id : '#/peaks/' + p.id) + '">' +
        '<b>' + esc(name) + '</b></a><em>' + sub + '</em></span>' +
        '<button class="wanticon" data-act="want" data-id="' + id + '" data-on="♥" data-off="♡" ' +
        'style="font-size:16px;color:var(--coral)">♥</button></div>';
    }).join('') + '</div>' +
      '<div class="hint">收藏的线路和山峰都在这里，点 ♥ 取消收藏。</div>';
  }

  function mePeakView() {
    /* 这里不是展示位，是**入口**：拿二维码、或者接管一个留言板。 */
    var k = H.king;
    return '<div class="card" style="padding:16px">' +
      '<h3 style="font-size:17px;font-weight:800;margin-bottom:6px">我的山头</h3>' +
      '<div class="note" style="line-height:1.7">三条路，选一条走。' +
      '开一座山、立一个岔路点位，都当场发编号和二维码；' +
      '或者不发码，接手一个已有山头的留言板。</div>' +
      '<button class="btn coral" style="margin-top:12px" data-act="king-new">' +
      '成为山大王<em class="btn-note">自己开一座山 · 拿编号和二维码 · 让大家扫码打卡</em></button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="king-new" data-kind="junction">' +
      '我是NPC指路人<em class="btn-note">立在岔路口 · 给路过的人指条明路 · 一样发编号和二维码</em></button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="become-master">' +
      '成为版主<em class="btn-note">不发二维码 · 接管一个已有山头的留言板</em></button>' +
      '</div>' +
      (k ? '<div class="card" style="margin-top:12px">' +
        '<div class="row-between"><h3 style="font-size:15px;font-weight:800">我的等级</h3>' +
        '<span class="tiny muted">' + esc(k.levelName) + '</span></div>' +
        '<div style="font-size:12.5px;color:var(--ink2);margin-top:6px;line-height:1.7">' +
        '名下点位 <b>' + k.used + ' / ' + k.quota + '</b> 个 · ' +
        '累计 <b>' + k.people + '</b> 人扫过 · 维护动作 <b>' + k.kept + '</b> 次</div>' +
        '<div class="progress" style="margin:9px 0 6px"><i style="width:' +
        Math.min(100, k.used / k.quota * 100) + '%"></i></div>' +
        (k.nextName
          ? '<div class="note">升到「' + esc(k.nextName) + '」：再攒 ' +
            Math.max(0, (k.nextNeedPeople || 0) - k.people) + ' 人扫码、维护动作再 ' +
            Math.max(0, (k.nextNeedKept || 0) - k.kept) + ' 次，配额到 ' +
            (k.nextQuota || 0) + ' 个。</div>'
          : '<div class="note">已经是最高等级。</div>') +
        '</div>' : '') +
      '<a class="btn blue" style="margin-top:12px" href="#/admin">进入维护台 · 管理我的点位</a>' +
      '<div class="hint">山大王要自己印二维码贴上山——没人扫，点位就一直是空的。<br>' +
      '版主不发码，线上就能开始。</div>';
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
    var p = peak(pid);
    if (!p && pid.indexOf('p-') === 0) {
      if (_pointErrors[pid.slice(2)]) return '<div class="pad"><div class="empty">' +
        esc(_pointErrors[pid.slice(2)]) + '</div></div>';
      loadPointByCode(pid.slice(2));
      return '<div class="pad"><div class="empty">正在读取点位…</div></div>';
    }
    if (!p || !p.code) return '<div class="pad"><div class="empty">未找到这个扫码点位，请核对编号。</div></div>';
    hydratePeakCommunity(p);
    return (
      '<div class="hero tall">' + U.scene(p.id) +
      '<div class="floating"><a href="#/scan"><span class="pill">‹ 返回</span></a></div>' +
      '<div class="floating right"><span class="pill">' + esc(p.name) + ' · 打卡点</span></div></div>' +
      '<div class="pad">' +
      '<span class="seal">到此一游</span>' +
      '<h2 class="arrive-h">你到了，山友。</h2>' +
      '<p class="arrive-p">' + esc(p.name || '名称待定') +
      (p.alt ? ' · 海拔 ' + p.alt + ' m' : '') + ' · 打卡后生成本次到访凭证</p>' +
      /* 游客主路径：不登录、不填表，点了就拿到带时间戳的到此一游凭证 */
      '<button class="btn coral" data-act="guest-checkin" data-code="' + esc(p.code || '') + '">' +
      '我到了</button>' +
      '<div class="hint" style="text-align:center">不用注册，就能拿到带时间戳的凭证</div>' +
      '<a class="btn ghost" style="margin-top:9px" href="#/peaks/' + esc(p.id) + '">查看这座山</a>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="arrival-draft" data-code="' + esc(p.code) + '">' +
      '留一句给下一位</button>' +
      '<div class="sec-head"><h3>' + esc(p.name) + '留言板</h3><span class="more">全部 ›</span></div>' +
      commentsFor(p.id).slice(0, 2).map(commentCard).join('') +
      '<button class="btn ghost" data-act="arrival-draft" data-code="' + esc(p.code) + '">在留言板写一句</button>'
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

      /* 先讲清楚这套难度是分两层算的：段是机器算的，线路是人判的。
         不讲清这一层，用户会拿"四个颜色"去理解整条线路，那就错了。 */
      '<div class="card" style="box-shadow:none;background:var(--blue-bg);padding:15px">' +
      '<div style="font-size:14.5px;font-weight:800;color:var(--blue-deep);margin-bottom:8px">' +
      '难度分两层看</div>' +
      '<div style="font-size:12.5px;color:#2B3568;line-height:1.7">' +
      '<b>① 单段难度 —— 机器算的。</b>把整条路线切成一段一段，每段只看两个数字：' +
      '这一段爬升多少米、坡有多陡（爬升 ÷ 水平距离）。两个数字各定一档，取高的那档上色。<br>' +
      '所以线条上的颜色是"<b>这一段难不难</b>"，不是"整条线难不难"。<br><br>' +
      '<b>② 线路综合难度 —— 人判断的。</b>一个颜色装不下它。要看' +
      '<b>平均完成时间、登顶难度、距离与累计爬升、路况、技术动作</b>这几项合起来——' +
      '由维护人给结论。<br>' +
      '所以线路卡片上不放单一难度色块，放的是<b>平均用时 + 大致卡路里 + 最难那一段的徽标 + 路况说明</b>；' +
      '线路列表里的那个形状，只代表<b>全线最难的一段</b>。' +
      '</div></div>' +

      '<div class="group-label" style="margin-top:16px">单段难度 · 四档</div>' +
      H.difficultyDoc.map(function (d) {
        return '<div class="card" style="box-shadow:none;background:#fff;padding:14px;display:flex;gap:14px;align-items:center">' +
          '<span class="shape" style="width:52px;height:52px;flex:0 0 auto">' + U.shapeSVG(d.key) + '</span>' +
          '<div><div style="font-size:14px;font-weight:800;margin-bottom:5px">' + esc(d.title) + '</div>' +
          '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.6">' + esc(d.body) + '</div></div></div>';
      }).join('') +

      '<div class="group-label" style="margin-top:16px">线路综合难度 · 这五项一起看</div>' +
      '<div class="card" style="box-shadow:none;background:#fff;padding:6px 14px">' +
      H.routeFactors.map(function (f, i) {
        return '<div style="padding:11px 0' + (i ? ';border-top:1px solid var(--hair)' : '') + '">' +
          '<div style="font-size:13.5px;font-weight:800">' + esc(f.label) + '</div>' +
          '<div style="font-size:12.5px;color:#3C3F4E;line-height:1.6;margin-top:3px">' +
          esc(f.hint) + '</div></div>';
      }).join('') +
      '<div class="note" style="padding:0 0 13px">这几项不出一个总分，也不给一个颜色——' +
      '它们变成页面上那几行字：平均用时、大致卡路里、最难的一段、路况。</div></div>' +

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
      case 'arrive': r.name = 'arrive'; r.id = parts[1] || ''; r.parent = '#/scan'; break;
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
      case 'trail': {
        var currentTrail = trail(r.id);
        if (currentTrail && !currentTrail.detailLoaded && window.API && window.API.loadRouteDetail) {
          if (!currentTrail.detailError) {
            window.API.loadRouteDetail(r.id).then(function () {
              if (parse().name === 'trail' && parse().id === r.id) render();
            }).catch(function () {
              currentTrail.detailError = true;
              if (parse().name === 'trail' && parse().id === r.id) render();
            });
          }
          html = '<div class="empty">' + (currentTrail.detailError ? '路书加载失败，请刷新重试' : '正在加载路书…') + '</div>';
        } else {
          html = trailDetailView(r.id);
        }
        break;
      }
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
      if (input) input.addEventListener('input', function () { q = this.value; pages.trails = 0; refreshTrailResults(); });
    }
    if (r.name === 'places') {
      startFootRotate();
      var pi = document.getElementById('pq');
      if (pi) pi.addEventListener('input', function () {
        pq = this.value;
        pages.peaks = pages.peakHot = pages.junctions = 0;
        render();
        var ni = document.getElementById('pq');       /* 重渲染后把焦点和光标放回去 */
        if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
      });
    }
    if (r.name === 'home') homeInit();
    else if (homeTimer) { clearInterval(homeTimer); homeTimer = null; }

    var isTab = !!r.tab && r.name !== 'peak' && r.name !== 'junction' && r.name !== 'trail';
    if (lastRoute !== r.name + (r.id || '')) view.scrollTop = 0;
    lastRoute = r.name + (r.id || '');
  }
  var lastRoute = '';

  /* ==================== 事件 ==================== */
  function on(act, fn) { return { act: act, fn: fn }; }

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'arrivalPrivate' && e.target.id !== 'arrivalPublic') return;
    var save = document.querySelector('[data-act="arrival-draft-save"]');
    if (!save) return;
    rememberArrivalDraft(save.getAttribute('data-code'),
      (document.getElementById('arrivalPrivate') || {}).value || '',
      (document.getElementById('arrivalPublic') || {}).value || '');
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'retry-boot') { location.reload(); return; }
    var id = t.getAttribute('data-id');
    var type = t.getAttribute('data-type');
    var val = t.getAttribute('data-val');

    if (act === 'want') {
      e.preventDefault();
      var i = S.want.indexOf(id);
      if (i >= 0) { S.want.splice(i, 1); U.toast('已从想去移除'); }
      else { S.want.unshift(id); U.toast('已收藏到想去'); }
      persist();
      syncWant(id, i < 0);        /* 关注度要落库，见下面的注释 */
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
    /* 游客打卡：不登录，直接拿带时间戳的到此一游凭证 */
    if (act === 'guest-checkin') {
      var gcode = t.getAttribute('data-code');
      if (!gcode) { U.toast('这个示例点位没有编号；扫真实二维码就有'); return; }
      t.disabled = true;
      window.API.token().then(function (tk) {
        if (!tk) return window.API.guestVisit(gcode);
        var known = H.peaks.filter(function (p) { return p.code === gcode && p.pointId; })[0];
        var point = known ? Promise.resolve(known) : fetch('/api/points/' + encodeURIComponent(gcode))
          .then(function (r) { if (!r.ok) throw new Error('点位加载失败'); return r.json(); });
        return point.then(function (p) {
          return window.API.ja('/api/points/' + (p.pointId || p.id) + '/visit', {
            method: 'POST', body: JSON.stringify({ source: 'scan' })
          });
        });
      }).then(function (v) { sheetGuestCard(v); })
        .catch(function () { U.toast('网络未确认打卡结果，请重试；同日不会重复计数'); })
        .then(function () { t.disabled = false; });
      return;
    }
    if (act === 'arrival-draft') { sheetArrivalDraft(t.getAttribute('data-code') || arrivalCode()); return; }
    if (act === 'arrival-draft-save' || act === 'arrival-draft-publish') {
      var code = t.getAttribute('data-code');
      var note = (document.getElementById('arrivalPrivate') || {}).value || '';
      var comment = (document.getElementById('arrivalPublic') || {}).value || '';
      var errorEl = document.getElementById('arrivalDraftError');
      if (!note.trim() && !comment.trim()) { errorEl.textContent = '请先写下纪念或留言。'; return; }
      if (act === 'arrival-draft-publish' && !comment.trim()) {
        errorEl.textContent = '请先写下要发布的留言。'; return;
      }
      rememberArrivalDraft(code, note, comment);
      t.disabled = true;
      window.API.token().then(function (tk) {
        var guest = !tk;
        var pendingKey = guest ? '' : 'hikes.arrival.publish.pending.' + arrivalDraftOwner() + ':' + code;
        var pendingValue = JSON.stringify([note.trim(), comment.trim()]);
        var publishUrl = '/api/me/arrival-drafts/' + encodeURIComponent(code) + '/publish';
        function finishPublish() {
          localStorage.removeItem(pendingKey);
          rememberArrivalDraft(code, note, '');
          var p = (H.peaks || []).filter(function (x) { return x.code === code; })[0];
          if (p) { p.commentsReady = false; hydratePeakCommunity(p); }
          U.closeSheet(); U.toast('已署名发布'); render();
        }
        function publish() {
          localStorage.setItem(pendingKey, pendingValue);
          return arrivalRequest(publishUrl, 'POST').then(finishPublish);
        }
        function save() {
          return arrivalRequest(guest ? '/api/guest/arrival-draft' : '/api/me/arrival-drafts',
            guest ? 'POST' : 'PUT', { code: code, privateNote: note, publicCommentDraft: comment }, guest)
            .then(function () {
            if (act === 'arrival-draft-save') {
              if (pendingKey) localStorage.removeItem(pendingKey);
              errorEl.textContent = guest ? '草稿已同步；注册后会并入账号。' : '草稿已同步到账号。';
              return;
            }
            if (guest) { sheetSignup('comment'); return; }
            return publish();
          });
        }
        if (act === 'arrival-draft-publish' && !guest &&
            localStorage.getItem(pendingKey) === pendingValue) {
          return arrivalRequest(publishUrl, 'POST').then(finishPublish)
            .catch(function (e) { if (e.status === 404) return save(); throw e; });
        }
        return save();
      }).catch(function (e) {
        if (errorEl && errorEl.isConnected) errorEl.textContent =
          (e instanceof TypeError || e.name === 'AbortError' || /身份不可用/.test(e.message))
            ? '网络未连通，草稿已保存在本机；联网后可重试。' : e.message;
      })
        .then(function () { t.disabled = false; });
      return;
    }
    if (act === 'arrival-auth') {
      var username = (document.getElementById('arrivalUser') || {}).value || '';
      var password = (document.getElementById('arrivalPassword') || {}).value || '';
      var authError = document.getElementById('arrivalAuthError');
      var draftSyncFailed = false;
      if (!username.trim() || !password) { authError.textContent = '请填写用户名和密码。'; return; }
      t.disabled = true;
      window.API.guestToken().then(function (guestToken) {
        return window.API.timedFetch('/api/auth/' + t.getAttribute('data-mode'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guest-Token': guestToken || '' },
          body: JSON.stringify({ username: username, password: password })
        });
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.message || d.detail && d.detail.message || '注册或登录失败');
          return d;
        });
      }).then(function (d) {
        var oldGuestToken = localStorage.getItem('hikes.guest.token');
        localStorage.setItem('hikes.auth.token', d.token);
        localStorage.setItem('hikes.auth.userId', String(d.userId));
        window.API.setToken(d.token);
        return moveGuestDraftsToAccount(oldGuestToken, d.userId).then(function (results) {
          localStorage.removeItem('hikes.guest.token');
          window.API.resetGuest();
          return results;
        }).then(function (results) {
          draftSyncFailed = results.some(function (ok) { return !ok; });
          return window.API.ja('/api/me/summits');
        }).then(function (items) {
          H.mySummits = items;
        }).catch(function () { H.mySummits = []; }).then(function () {
          _hiddenCommentsLoaded = false;
          U.closeSheet();
          U.toast(draftSyncFailed ? '已登录；草稿保存在本机，联网后可重试' :
            '已登录，到访与草稿已保存');
          render();
          if (_collaborationAfterAuth) {
            var code = _collaborationAfterAuth;
            _collaborationAfterAuth = null;
            var button = document.querySelector('[data-act="collaboration-open"][data-code="' + code + '"]');
            if (button) button.click();
          }
        });
      }).catch(function (e) {
        if (authError && authError.isConnected) authError.textContent =
          e.name === 'AbortError' ? '网络未确认结果。新账号可尝试登录；到访和草稿仍在本机。' : e.message;
      })
        .then(function () { t.disabled = false; });
      return;
    }
    /* 留言 / 起称呼 / 存记录：都要注册，统一走注册引导 */
    if (act === 'signup') { sheetSignup(t.getAttribute('data-why')); return; }
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
    /* 我要成为山大王（用户侧建点位）。
       注意：维护台里的「新建点位」是 admin.js 的 new-point，两回事，别混。 */
    /* 卡片自己在 data-kind 上标了山头还是岔路（我的山头页那颗按钮没标，按山头算） */
    if (act === 'king-new') {
      newPointSheet(t.getAttribute('data-kind') || 'peak');
      return;
    }
    if (act === 'new-point-submit') {
      newPointSend(t.getAttribute('data-kind') || 'peak', t);
      return;
    }
    if (act === 'close') { U.closeSheet(); render(); return; }
    /* 页面卡在旧代码上时的自救按钮（见 hotBoard 的空态） */
    if (act === 'reload') { location.reload(); return; }
    /* 首页轮播卡：整卡可点进线路详情（收藏按钮有自己的 data-act，不会误跳） */
    if (act === 'goto-trail') { U.go('#/trails/' + id); return; }
    /* 消息页：维护人打开留言板管理 / 隐藏留言 / 提醒全部已读 */
    if (act === 'summit-board') { sheetSummitBoard(id); return; }
    /* 广告：维护人开面板 / 提交（提交后进待审队列） */
    if (act === 'ad-panel') { sheetAdPanel(t.getAttribute('data-code')); return; }
    if (act === 'ad-edit') {
      var existingAd = adPanelItems.filter(function (a) { return String(a.id) === t.getAttribute('data-id'); })[0];
      if (!existingAd) return;
      document.getElementById('adEditId').value = existingAd.id;
      document.getElementById('adTitle').value = existingAd.title || '';
      document.getElementById('adBody').value = existingAd.body || '';
      document.getElementById('adLink').value = existingAd.link || '';
      document.getElementById('adDays').value = existingAd.durationDays || 30;
      document.getElementById('adTitle').focus();
      return;
    }
    if (act === 'ad-submit' || act === 'ad-save-draft') {
      var acode = t.getAttribute('data-code');
      var editId = (document.getElementById('adEditId') || {}).value || '';
      var payload = {
        title: ((document.getElementById('adTitle') || {}).value || '').trim(),
        body: ((document.getElementById('adBody') || {}).value || '').trim() || null,
        link: ((document.getElementById('adLink') || {}).value || '').trim() || null,
        days: Number((document.getElementById('adDays') || {}).value) || 30
      };
      var adBase = '/api/points/' + encodeURIComponent(acode) + '/ads';
      t.disabled = true;
      var saveAd = editId
        ? window.API.ja(adBase + '/' + editId, { method: 'PATCH', body: JSON.stringify(payload) })
        : window.API.ja(adBase + (act === 'ad-save-draft' ? '/drafts' : ''),
          { method: 'POST', body: JSON.stringify(payload) });
      saveAd.then(function (saved) {
        if (act === 'ad-submit' && editId) {
          return window.API.ja(adBase + '/' + saved.id + '/submit', { method: 'POST' });
        }
        return saved;
      }).then(function () {
          U.toast(act === 'ad-save-draft' ? '草稿已保存' : '已提交，等系统审核'); sheetAdPanel(acode);
        })
        .catch(function (e) {
          U.toast(/403/.test(e.message) ? '只有这座山的维护人可以提交' : '提交失败，稍后再试');
        }).then(function () { t.disabled = false; });
      return;
    }
    if (act === 'hide-comment') {
      var pid = t.getAttribute('data-pid');
      var reason = prompt('隐藏理由（至少 8 字）');
      if (reason === null) return;
      if (reason.trim().length < 8) { U.toast('请填写至少 8 字理由'); return; }
      window.API.ja('/api/comments/' + id + '/hide', { method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }) })
        .then(function () { U.toast('已隐藏这条留言'); sheetSummitBoard(pid); })
        .catch(function () { U.toast('隐藏失败——只有维护人（或作者本人）能隐藏'); });
      return;
    }
    if (act === 'appeal-open') {
      U.openSheet('<h3>申请复核</h3><div class="sh-sub">说明这条留言为什么应恢复；原文只对你和平台审核员可见。</div>' +
        '<div class="field"><label>申诉理由</label><textarea id="appealReason" maxlength="500"></textarea></div>' +
        '<button class="btn coral" data-act="appeal-submit" data-id="' + id + '">提交申诉</button>' +
        '<button class="btn ghost" style="margin-top:9px" data-act="close">再想想</button>');
      return;
    }
    if (act === 'appeal-submit') {
      var appealReason = ((document.getElementById('appealReason') || {}).value || '').trim();
      if (appealReason.length < 8) { U.toast('请至少写 8 字申诉理由'); return; }
      t.disabled = true;
      window.API.ja('/api/comments/' + id + '/appeals', { method: 'POST',
        body: JSON.stringify({ reason: appealReason }) })
        .then(function () { return window.API.ja('/api/me/hidden-comments'); })
        .then(function (items) {
          H.hiddenComments = items; _hiddenCommentsLoaded = true;
          U.closeSheet(); render(); U.toast('申诉已提交，等待平台复核');
        }).catch(function () { U.toast('提交失败，理由仍在，请重试'); t.disabled = false; });
      return;
    }
    if (act === 'notif-seen') {
      window.API.ja('/api/me/notifications/seen', { method: 'POST' }).then(function () {
        return Promise.all([
          window.API.ja('/api/me/summits').catch(function () { return []; }),
          window.API.ja('/api/me/follows').catch(function () { return []; }),
          window.API.ja('/api/me/notifications').catch(function () { return []; })
        ]);
      }).then(function (r) {
        H.mySummits = r[0] || []; H.followPeaks = r[1] || []; H.notif = r[2] || [];
        U.toast('已标记为已读'); render();
      }).catch(function () { U.toast('标记失败，稍后再试'); });
      return;
    }
    if (act === 'hot-all') { sheetHotAll(); return; }
    if (act === 'records-all') { sheetRecords(); return; }
    if (act === 'summit-cell') { sheetSummitCell(t.getAttribute('data-code')); return; }
    if (act === 'pick-track') {
      var fi = document.getElementById('trkFile');
      if (fi) {
        fi.onchange = function () { uploadTrack(this.files && this.files[0]); };
        fi.click();
      } else { U.toast('先点开「我」→ 山径拼图'); }
      return;
    }
    if (act === 'track-peak') {
      var tid = +t.getAttribute('data-track'), ti = +t.getAttribute('data-i');
      var tr = (H.myTracks || []).filter(function (x) { return x.id === tid; })[0];
      var pk = tr && tr.peaks[ti];
      if (!pk) return;
      U.openSheet('<h3>' + esc(tr.name) + ' · 顶' + (ti + 1) + '</h3>' +
        '<div class="sh-sub">我们自己算出来的山顶，还没有名字</div>' +
        '<div class="card" style="box-shadow:none;background:var(--blue-bg);padding:14px;line-height:1.8">' +
        '海拔 <b>' + pk.ele + ' m</b><br>坐标 ' + pk.lat + ', ' + pk.lng + '<br>' +
        '相对高度 <b>' + pk.rel + ' m</b> · 距起点 ' + pk.km + ' km</div>' +
        '<div class="note" style="margin-top:12px;line-height:1.8">' +
        '它是**候选**，不是打卡。传轨迹只说明你走过这条线；' +
        '要让它变成真的，得有人到现场扫码——扫一次点亮，山脚和山顶都扫了才有登顶用时。</div>' +
        '<button class="btn ghost" style="margin-top:12px" data-act="close">知道了</button>');
      return;
    }
    /* 成为版主：不新建点位，去认领一个已经立好的山头 / 岔路，把它的留言板管起来 */
    if (act === 'become-master') { sheetBecomeMaster(); return; }
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
    if (act === 'seg') { seg = val; pf = 'all'; pq = ''; pages.peaks = pages.peakHot = pages.junctions = 0; render(); return; }
    /* 成为版主：不发编号、不发二维码，只接管这个山头的线上留言板 */
    if (act === 'master-claim') {
      var mcCode = t.getAttribute('data-code'), mcName = t.getAttribute('data-name');
      U.openSheet(
        '<h3>成为版主</h3>' +
        '<div class="sh-sub">' + esc(mcName) + ' · ' + esc(mcCode) + '</div>' +
        '<div class="card" style="box-shadow:none;background:var(--blue-bg);padding:14px;' +
        'margin-bottom:14px"><div style="font-size:12.5px;color:#2B3568;line-height:1.75">' +
        '<b>版主不发二维码。</b>二维码是标牌上的事——得实地印、实地贴。' +
        '你手上的是这个山头的<b>留言板</b>：核验内容、把有用的置顶、把胡说的压下去。' +
        '想自己开一座山、或者立一个岔路口拿二维码，走「成为山大王 / 我是NPC指路人」。' +
        '</div></div>' +
        '<div class="field"><label>你的昵称</label>' +
        '<input id="msNick" type="text" value="' + esc(H.me.name) + '"></div>' +
        '<div class="field"><label>微信号 · 选填</label>' +
        '<input id="msContact" type="text" placeholder="例如 wx: agan"></div>' +
        '<button class="btn coral" data-act="master-submit" data-code="' + esc(mcCode) + '">' +
        '接管这个留言板</button>' +
        '<button class="btn ghost" style="margin-top:9px" data-act="close">再想想</button>');
      return;
    }
    if (act === 'collaboration-open') {
      var cc = t.getAttribute('data-code');
      apiToken().then(function (tk) {
        if (!tk) { _collaborationAfterAuth = cc; sheetSignup('collaboration'); return; }
        return Promise.all([
          fetch('/api/points/' + encodeURIComponent(cc)).then(function (r) { return r.json(); }),
          window.API.ja('/api/me/collaboration-applications')
        ]).then(function (res) {
          var point = res[0], apps = res[1], boardId = point.boardId;
          if (!boardId) { U.toast('这块留言板暂不能申请协作'); return; }
          var mine = apps.filter(function (a) { return a.boardId === boardId; })[0];
          var current = H.peaks.filter(function (p) { return p.code === cc; })[0];
          if (current) { current.collaborationStatus = mine && mine.status; render(); }
          if (mine && mine.status === 'pending') {
            U.openSheet('<h3>协作申请审核中</h3><div class="sh-sub">平台核实后会更新状态。</div>' +
              '<button class="btn ghost" data-act="close">知道了</button>');
            return;
          }
          U.openSheet('<h3>申请维护协作</h3><div class="sh-sub">只申请这块山顶留言板；审核通过后可处理本板留言，不含广告权限。</div>' +
            (mine && mine.reviewNote ? '<div class="hint">上次反馈：' + esc(mine.reviewNote) + '</div>' : '') +
            '<div class="field"><label>熟悉的路况与能承担的维护工作</label>' +
            '<textarea id="collaborationMessage" maxlength="500"></textarea></div>' +
            '<button class="btn coral" data-act="collaboration-submit" data-board="' + boardId + '" data-code="' + esc(cc) + '">提交申请</button>' +
            '<button class="btn ghost" style="margin-top:9px" data-act="close">再想想</button>');
        });
      }).catch(function () { U.toast('申请状态读取失败，请稍后重试'); });
      return;
    }
    if (act === 'collaboration-submit') {
      var message = ((document.getElementById('collaborationMessage') || {}).value || '').trim();
      if (message.length < 8) { U.toast('请至少写 8 个字说明你能做什么'); return; }
      t.disabled = true;
      window.API.ja('/api/boards/' + encodeURIComponent(t.getAttribute('data-board')) + '/collaboration-applications', {
        method: 'POST', body: JSON.stringify({ message: message })
      }).then(function () {
        var cc = t.getAttribute('data-code');
        var current = H.peaks.filter(function (p) { return p.code === cc; })[0];
        if (current) current.collaborationStatus = 'pending';
        U.closeSheet(); render(); U.toast('申请已提交，等待平台审核');
      }).catch(function () { U.toast('提交失败，文字仍在，请重试'); t.disabled = false; });
      return;
    }
    if (act === 'master-submit') {
      var msCode = t.getAttribute('data-code');
      var msNick = ((document.getElementById('msNick') || {}).value || '').trim();
      var msCt = ((document.getElementById('msContact') || {}).value || '').trim();
      t.disabled = true; t.textContent = '正在接管…';
      apiToken().then(function (tk) {
        if (!tk) { sheetSignup('claim'); return; }
        return fetch('/api/claims/master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ target_code: msCode, nickname: msNick, contact: msCt })
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (x) {
            t.disabled = false; t.textContent = '接管这个留言板';
            if (!x.ok) {
              U.toast((x.d.detail && x.d.detail.error && x.d.detail.error.message) || '接管失败');
              return;
            }
            U.openSheet('<h3>你是版主了</h3>' +
              '<div class="sh-sub">' + esc(x.d.targetName) + ' · ' + esc(x.d.pointCode) + '</div>' +
              '<div class="note" style="line-height:1.8">' + esc(x.d.message) + '</div>' +
              '<a class="btn coral" href="#/peaks/p-' + esc(x.d.pointCode) + '" ' +
              'data-act="close">去看看它的留言板</a>' +
              '<button class="btn ghost" style="margin-top:9px" data-act="close">知道了</button>');
            window.API.ja('/api/me/summits').then(function (items) {
              H.mySummits = items;
              render();
            });
          });
      });
      return;
    }
    if (act === 'claim') {
      var ck = t.getAttribute('data-key'), cn = t.getAttribute('data-name'),
          ckind = t.getAttribute('data-kind');
      var cjc = ckind === 'junction';
      U.openSheet(
        '<h3>' + (cjc ? '我是NPC指路人' : '占山为王') + '</h3>' +
        '<div class="sh-sub">' + esc(cn) + ' · ' +
        (cjc ? '认领后你就是这个岔路口的 NPC 指路人' : '认领后你成为这个点位的山大王') +
        '</div>' +
        '<div class="note" style="margin-bottom:14px;line-height:1.75">' +
        '认领后立刻拿到一个编号和二维码，<b>自己打印贴出去就能用</b>，不用等官方标牌。<br>' +
        (cjc ? '路过的人扫码就能看到你写的指路情报。<br>' : '') +
        '被扫 <b>40 次</b>（且分布在 7 个以上不同日子、你本人留过言）之后，' +
        '可以申领喷漆和二维码打孔卡。</div>' +
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
      /* 这个局部变量原来叫 kb——和路书页的"距离档"过滤状态 kb 撞名了。
         var 是函数作用域，这个名字会遮蔽整个点击处理函数里的外层 kb，
         于是点「距离」筛选卡时 `kb = val` 其实写进了这个局部变量，
         筛选永远不生效（点上去一点反应都没有）。改名 ckey。 */
      var ckey = t.getAttribute('data-key'), kn = t.getAttribute('data-name'),
          kk = t.getAttribute('data-kind');
      var nick = (document.getElementById('clNick') || {}).value || H.me.name;
      var ct = (document.getElementById('clContact') || {}).value || null;
      t.disabled = true; t.textContent = '生成中…';
      claimSubmit(ckey, kn, kk, nick, ct, t);
      return;
    }
    if (act === 'seg-comments') {
      segComments(t.getAttribute('data-id'), t.getAttribute('data-no'));
      return;
    }
    if (act === 'seg-send') {
      segSend(t.getAttribute('data-id'), t);
      return;
    }
    if (act === 'filter-open') { filterKind = val; filterDraft = currentFilter(val); drawFilterSheet(); return; }
    if (act === 'filter-opt') { filterDraft[t.getAttribute('data-key')] = val; drawFilterSheet(); return; }
    if (act === 'filter-reset') {
      Object.keys(filterDraft).forEach(function (key) { filterDraft[key] = 'all'; });
      drawFilterSheet(); return;
    }
    if (act === 'filter-apply') {
      if (filterKind === 'trails') { kb = filterDraft.kb; ru = filterDraft.ru; rg = filterDraft.rg; }
      else { pf = filterDraft.pf; if (filterKind === 'peaks') { pd = filterDraft.pd; plv = filterDraft.plv; } }
      resetPages(); U.closeSheet(); render(); return;
    }
    if (act === 'page-prev' || act === 'page-next') {
      var dir = act === 'page-next' ? 1 : -1;
      pages[val] = Math.max(0, (pages[val] || 0) + dir);
      if (dir > 0) nextPageClicks++;
      render();
      var pageAnchor = document.getElementById(val === 'home' ? 'carousel' :
        val === 'trails' ? 'trailResults' : 'page-' + val);
      if (pageAnchor) pageAnchor.scrollIntoView({ block: 'start' });
      if (dir > 0 && nextPageClicks > 3 && !browseSignupShown && !localStorage.getItem('hikes.auth.token')) {
        browseSignupShown = true;
        sheetSignup('browse');
      }
      return;
    }
    if (act === 'clear-filter') {
      q = ''; lv = 'all'; kb = 'all'; rg = 'all'; ru = 'all';
      resetPages(); render(); return;
    }
    if (act === 'meview') { meViewMode = val; render(); return; }
    if (act === 'sim') { U.go(type === 'peak' ? '#/arrive/' + id : '#/junctions/' + id); return; }
    if (act === 'goto-junction') { U.go('#/junctions/' + id); return; }
    if (act === 'sim-code') {
      var code = ((document.getElementById('codeInput') || {}).value || '').trim().toUpperCase();
      var hitJ = H.junctions.filter(function (j) { return j.code.toUpperCase() === code; })[0];
      if (hitJ) { U.go('#/junctions/' + hitJ.id); return; }
      if (code) { U.go('#/arrive/p-' + code); return; }
      U.toast('请输入点位编号');
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

  /* 分段留言：弹层里看别人对这一段的说明，也留一句 */
  function segComments(sid, no) {
    U.openSheet(
      '<h3>第 ' + esc(no) + ' 段</h3>' +
      '<div class="sh-sub">走这一段的人留下的话</div>' +
      '<div id="segList" style="min-height:52px"><div class="skel"></div></div>' +
      '<div class="field" style="margin-top:12px"><label>写一句给走这一段的人</label>' +
      '<input id="segTxt" type="text" maxlength="200" placeholder="例如：石阶有青苔，雨后很滑"></div>' +
      '<button class="btn coral" data-act="seg-send" data-id="' + sid + '">发布</button>' +
      '<button class="btn ghost" style="margin-top:9px" data-act="close">关闭</button>');
    loadSeg(sid);
  }
  function loadSeg(sid) {
    fetch('/api/segments/' + sid + '/comments')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = document.getElementById('segList');
        if (!box) return;
        box.innerHTML = d.items.length
          ? d.items.map(function (c) {
              return '<div class="comment" style="box-shadow:none;background:#fff;' +
                'border:1px solid var(--line)"><div class="ph">' +
                esc(c.nickname || '山友') + '</div><p>' + esc(c.text) + '</p></div>';
            }).join('')
          : '<div class="note">这一段还没有人留言。你是第一个走到的。</div>';
      })
      .catch(function () {
        var box = document.getElementById('segList');
        if (box) box.innerHTML = '<div class="note">留言加载失败</div>';
      });
  }
  function segSend(sid, btn) {
    var el = document.getElementById('segTxt');
    var txt = el ? el.value.trim() : '';
    if (!txt) { if (el) el.focus(); return; }
    btn.disabled = true;
    apiToken().then(function (tk) {
        if (!tk) throw new Error('请先注册或登录再留言');
        return fetch('/api/segments/' + sid + '/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ text: txt })
        });
      })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.toast('发布失败'); return; }
        if (el) el.value = '';
        loadSeg(sid);
        U.toast('已发布到这一段');
      })
      .catch(function () { btn.disabled = false; U.toast('发布失败'); });
  }

  /* 认领：使用当前账号令牌；未登录时不创建伪造身份。 */
  function claimSubmit(key, name, kind, nick, contact, btn) {
    apiToken().then(function (tk) {
        if (!tk) throw new Error('请先注册或登录，再申请维护');
        return fetch('/api/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
                     'Authorization': 'Bearer ' + tk },
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
        var cjc = kind === 'junction';
        U.openSheet(
          '<h3>' + (cjc ? '你是这个岔路口的 NPC 指路人了'
                        : '你是这个山头的王了') + '</h3>' +
          '<div class="sh-sub">' + esc(c.target_name) + ' · 编号 <b>' + esc(c.code) + '</b></div>' +
          '<div style="text-align:center;padding:8px 0 4px">' +
          '<img src="' + c.qrUrl + '" alt="二维码" style="width:190px;height:190px;' +
          'border:1px solid var(--line);border-radius:14px;background:#fff;padding:8px"></div>' +
          '<div class="note" style="text-align:center;margin-bottom:14px">' +
          '印出来贴在' + (cjc ? '岔路口' : '山上') +
          '就能用 · 短链 <b>' + esc(c.shortLink) + '</b></div>' +
          '<a class="btn coral" href="' + c.qrUrl + '" download="' + c.code + '.svg">下载二维码</a>' +
          '<div class="card" style="margin-top:14px;background:var(--blue-bg);box-shadow:none">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0">' +
          '<span style="color:var(--blue-deep)">已被扫码</span><b>' + c.scanCount + ' 次</b></div>' +
          '<div class="progress" style="margin:8px 0 6px"><i style="width:' +
          Math.min(100, c.scanCount / 10 * 100) + '%"></i></div>' +
          '<div class="note" style="color:var(--blue-deep)">' +
          (c.canClaimKit ? '条件已满足，可以申领<b>喷漆和二维码打孔卡</b>了'
                         : '再被扫 ' + c.needForKit + ' 次（当前 ' + c.scanCount +
                           ' 次 / ' + c.scanDays + ' 天）可申领物料') +
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

  U.$('#mask').addEventListener('click', function (e) {
    if (e.target.id === 'mask' || e.target.closest('[data-act="close-mask"]')) U.closeSheet();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') U.closeSheet(); });

  /* 等后端数据灌进 HIKES 之后再渲染（见 js/api.js） */
  function boot() {
    var p = (window.API && window.API.ready) ? window.API.ready : Promise.resolve();
    p.then(function () {
      if (window.API && window.API.error) {
        document.getElementById('view').innerHTML =
          '<div class="empty"><span class="big">⛰</span>点位暂时没有加载出来<br>' +
          '<button class="btn coral" data-act="retry-boot" style="margin-top:16px">重试</button></div>';
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
