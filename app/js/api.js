/* 把后端数据灌进 HIKES —— app.js 照旧同步读取，不用重构它的渲染逻辑。
   先跑 api.js 拿到数据，再让 app.js 渲染。 */
(function (g) {
  var H = g.HIKES;
  function timedFetch(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(url, Object.assign({}, options || {}, { signal: controller.signal }))
      .finally(function () { clearTimeout(timer); });
  }
  function j(u) {
    return timedFetch(u).then(function (r) {
      if (!r.ok) throw new Error(u + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  /* 带登录态的请求使用扫码页注册/登录保存的账号令牌；不可静默切换到开发账号。 */
  var _tk = null;
  function authToken() {
    if (_tk) return Promise.resolve(_tk);
    try { _tk = localStorage.getItem('hikes.auth.token'); } catch (e) { _tk = null; }
    return Promise.resolve(_tk);
  }
  function ja(u, opt) {
    return authToken().then(function (tk) {
      var h = { 'Content-Type': 'application/json' };
      if (tk) h.Authorization = 'Bearer ' + tk;
      return timedFetch(u, { method: (opt && opt.method) || 'GET', headers: h,
                        body: opt && opt.body })
        .then(function (r) {
          if (!r.ok) throw new Error(u + ' → HTTP ' + r.status);
          return r.status === 204 ? null : r.json();
        });
    });
  }
  /* 先建对象，再挂 promise —— 否则 catch 里引用 g.API 会报错并把错误吞掉 */
  g.API = { ok: false, error: null, ready: null };
  g.API.ja = ja;                  /* app.js 里消息页与留言管理要用（带登录态） */
  g.API.token = authToken;
  g.API.timedFetch = timedFetch;
  g.API.setToken = function (token) { _tk = token; };

  /* ---------- 游客身份：不登录也能打卡 ---------- */
  /* 令牌存 localStorage，丢了就换一个新身份（游客本来就不是账号，这是可接受的）。
     留言 / 起称呼都不走这条路 —— 那两个必须注册。 */
  var GUEST_KEY = 'hikes.guest.token';
  var guestReady = null;
  function guestToken() {
    if (guestReady) return guestReady;
    var t = null;
    try { t = localStorage.getItem(GUEST_KEY); } catch (e) { t = null; }
    if (!t && g.crypto && g.crypto.getRandomValues) {
      var bytes = new Uint8Array(24);
      g.crypto.getRandomValues(bytes);
      t = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem(GUEST_KEY, t); } catch (e) { /* 隐身模式 */ }
    }
    guestReady = timedFetch('/api/guest', { method: 'POST', headers: t ? { 'X-Guest-Token': t } : {} })
      .then(function (r) { if (!r.ok) throw new Error('guest identity unavailable'); return r.json(); })
      .then(function (d) {
        if (d && d.token) {
          try { localStorage.setItem(GUEST_KEY, d.token); } catch (e) { /* 隐身模式 */ }
          return d.token;
        }
        return null;
      })
      .catch(function () { guestReady = null; return null; });
    return guestReady;
  }
  g.API.guestToken = guestToken;
  g.API.resetGuest = function () { guestReady = null; };
  g.API.guestVisit = function (code) {
    return guestToken().then(function (tk) {
      if (!tk) throw new Error('guest token unavailable');
      return timedFetch('/api/guest/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Guest-Token': tk },
        body: JSON.stringify({ code: code })
      }).then(function (r) {
        if (!r.ok) throw new Error('guest visit → HTTP ' + r.status);
        return r.json();
      });
    });
  };

  var KIND = { climb: '爬升', desc: '下降', flat: '平缓' };
  var LEV = { easy: '简单', mid: '中等', hard: '困难', hidden: '隐藏' };

  g.API.ready = Promise.all([
    /* 取全量：库里 157 条线路（64 徒步 + 93 赛事），limit=100 会让第 100 条之后的
       线路在页面上"不存在"（点进详情是空白），地区筛选的计数也会跟着少 */
    j('/api/routes?limit=300'),
    /* 山头列表：一条线路一张卡，卡是它的**主峰**（不是线路）。
       每个山头有自己的点位和编号，扫码打卡打在它身上。 */
    /* 取全量：库里 166 个山头（96 条线路主峰 + 69 座名山 + 用户点位），
       limit=100 会把香港、江苏、上海那批整段截掉，地区筛选的计数也会跟着错 */
    j('/api/summits?limit=300'),
    j('/api/points?limit=300'),
    /* 热门登顶榜：拿不到不要因此整页报"后端没连上"，但也不能悄悄吞掉——
       把真实原因记在 API.hotError 里，榜单空态会把它原样显示出来 */
    /* 取 50 条而不是 10 条：榜上只展示前 5，但页面上的筛选要在这 50 条里筛，
       只取 10 条的话一按「海外」就只剩两三条，筛选等于没用 */
    j('/api/peaks/hot?limit=50').catch(function (e) { g.API.hotError = e.message; return []; }),
    j('/api/community/recent').catch(function (e) { g.API.recentError = e.message; return []; })
  ]).then(function (res) {
    var routes = res[0].items, peaks = res[1], points = res[2];
    H.hotPeaks = res[3] || [];
    H.recentBoards = res[4] || [];

    H.trails = routes.map(function (r) {
      return {
        id: r.slug, name: r.name, sub: r.sub,
        level: r.hardest_level,          /* 界面用 level，含义是"最难的那一段" */
        km: r.km, up: r.up, down: r.down,
        city: r.city,
        hours: (r.hours || '—') + ' 小时',
        hoursVal: r.hours, kcal: r.kcal,
        visits7: r.weekly_visits,
        fastest: { time: r.fastest_time || '—', who: r.fastest_holder || '—' },
        peakCount: r.peak_count, segmentCount: r.segment_count, visitCount: r.visit_count,
        desc: r.sub || '', newest: false,
        status: null,                     /* 最近路况：后端还没这张表 */
        detailLoaded: false,
        /* 详情页用的真数据 */
        path: [], profile: [],
        segments: [], peakList: [],
        /* 赛事打卡点（组委会 GPX 的 <wpt>）：只有赛事路线有，徒步线路是空的 */
        checkpoints: [],
        sections: []
      };
    });

    var detailRequests = {};
    g.API.loadRouteDetail = function (slug) {
      var trail = H.trails.find(function (item) { return item.id === slug; });
      if (!trail || trail.detailLoaded) return Promise.resolve(trail);
      if (detailRequests[slug]) return detailRequests[slug];
      detailRequests[slug] = j('/api/routes/' + encodeURIComponent(slug)).then(function (d) {
        trail.path = d.path || [];
        trail.profile = d.profile || [];
        trail.segments = d.segments || [];
        trail.peakList = d.peaks || [];
        trail.checkpoints = d.checkpoints || [];
        trail.sections = trail.segments.map(function (s) {
          return {
            no: (s.no < 10 ? '0' : '') + s.no,
            name: KIND[s.kind] + ' · ' + s.from_km + '–' + s.to_km + ' km',
            tip: (s.rise > 0 ? '+' : '') + s.rise + ' m · ' +
                 (s.pct > 0 ? '+' : '') + s.pct + '% · ' + LEV[s.level],
            level: s.level, kind: 'route', point: ''
          };
        });
        trail.detailLoaded = true;
        return trail;
      }).finally(function () { delete detailRequests[slug]; });
      return detailRequests[slug];
    };

    /* 山头 = 线路的主峰。name 为空是正常状态（真名要实地采）→ 界面显示「名称待定」 */
    H.peaks = peaks.map(function (p) {
      return {
        id: p.id,                           /* p-{code}，就是它的点位 */
        pointId: p.pointId,
        code: p.code,                       /* 二维码印的就是这个编号 */
        origin: p.origin,                   /* route = 线路主峰；user = 用户自建 */
        name: p.name,                       /* 空 = 名称待定 */
        alt: p.altitude,
        trailName: p.routeName,             /* 归属线路，卡片上 @ 出来 */
        routeSlug: p.routeSlug,
        city: p.city,
        province: p.province,               /* 山头页「城市」筛选：国内按省出卡 */
        country: p.country,                 /* 山头页「城市」筛选：非中国的一律归到「海外」 */
        level: p.level,
        km: p.segKm, rise: p.segRise,       /* 最难那条爬升段的距离与爬升 */
        peakCount: p.peakCount,
        lat: p.lat, lng: p.lng,
        series: p.series || null,           /* 世界前 10 / 七大洲 / 中国名山 / 各国名山 */
        visits30: p.visits30 || 0,          /* 本周热度：这个顶被扫了几次 */
        fastest: p.fastest, holder: p.holder,
        photos: 0,
        board: [], comments: []
      };
    });
    H.summits = H.peaks;

    H.points = points;

    /* 我：仅加载当前浏览器已登录账号的真实打卡记录。 */
    return authToken().then(function (tk) {
        if (!tk) return;
        return fetch('/api/me/visits', { headers: { Authorization: 'Bearer ' + tk } })
          .then(function (r) { return r.ok ? r.json() : []; })
          .catch(function () { return []; })
          .then(function (vs) {
            if (window.APP_S && vs.length) {
              window.APP_S.visited = vs.map(function (v) {
                return {
                  id: v.pointId, type: 'peak', name: v.name, seq: v.seq,
                  when: new Date(v.at).toLocaleDateString('zh-CN'),
                  at: v.at,                        /* 完整时间，登顶记录要精确到时辰 */
                  time: v.time || null,            /* 这次登顶用时 */
                  level: v.level,
                  code: v.code || null,
                  routeSlug: v.routeSlug || null   /* 山径拼图靠它判断哪几格点亮 */
                };
              });
            }
                /* 山径拼图要的是"哪些点位打了卡、哪些还没"——一个点一个格 */
                return fetch('/api/me/route-progress',
                             { headers: { Authorization: 'Bearer ' + tk } })
                  .then(function (r) { return r.ok ? r.json() : []; })
                  .catch(function () { return []; })
                  .then(function (pr) { H.progress = pr; })
                  .then(function () {
                    /* 我上传的轨迹：它们识别出的山顶是拼图的**灰色候选** */
                    return fetch('/api/me/tracks',
                                 { headers: { Authorization: 'Bearer ' + tk } })
                      .then(function (r) { return r.ok ? r.json() : []; })
                      .catch(function () { return []; })
                      .then(function (ts) { H.myTracks = ts; });
                  })
                  .then(function () {
                    /* 收藏也是服务端说了算：本地只留一份镜像给即时反馈用 */
                    return fetch('/api/me/wants',
                                 { headers: { Authorization: 'Bearer ' + tk } })
                      .then(function (r) { return r.ok ? r.json() : []; })
                      .catch(function () { return []; })
                      .then(function (ws) {
                        if (window.APP_S && ws.length) {
                          window.APP_S.want = ws.map(function (w) { return w.targetKey; });
                        }
                      });
                  })
                  .then(function () {
                    /* 我的山头：等级 + 配额，页面要显示"已用几个 / 还能建几个" */
                    return fetch('/api/me/king',
                                 { headers: { Authorization: 'Bearer ' + tk } })
                      .then(function (r) { return r.ok ? r.json() : null; })
                      .catch(function () { return null; })
                      .then(function (k) { H.king = k; });
                  });
          });
      });
  }).then(function () {
    /* 消息页要的三份数据：我的山头（维护人 / 山大王）、我关注的山头、留言提醒。
       任何一份拿不到都当空数组——消息页显示空态，不能让整页报"后端没连上"，
       也不会因为没开 dev 登录就白屏。 */
    return Promise.all([
      ja('/api/me/summits').catch(function () { return []; }),
      ja('/api/me/follows').catch(function () { return []; }),
      ja('/api/me/notifications').catch(function () { return []; })
    ]).then(function (r) {
      H.mySummits = r[0] || [];
      H.followPeaks = r[1] || [];
      H.notif = r[2] || [];
    });
  }).then(function () {
    /* 广告流：只有过审且在有效期内的会返回。拿不到就当没有，
       首页/路书页的广告轮播位会整块不显示（不是空框）。 */
    return j('/api/ads?limit=12').catch(function () { return []; });
  }).then(function (ads) {
    H.ads = ads || [];
  }).then(function () {
    g.API.ok = true;
    return true;
  }).catch(function (e) {
    g.API.error = e;
    console.error('[api] 数据加载失败：', e);
    return false;
  });
})(window);
