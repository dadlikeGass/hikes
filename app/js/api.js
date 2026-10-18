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
  g.API.account = null;
  g.API.accountState = 'checking';
  g.API.accountError = null;

  var ACCOUNT_CACHE_KEY = 'hikes.auth.profile';
  function cachedAccount() {
    try {
      var row = JSON.parse(localStorage.getItem(ACCOUNT_CACHE_KEY) || 'null');
      return row && row.userId && row.username ? row : null;
    } catch (e) { return null; }
  }
  function saveAccount(account) {
    g.API.account = account;
    g.API.accountState = 'authenticated';
    g.API.accountError = null;
    try {
      localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(account));
      localStorage.setItem('hikes.auth.userId', String(account.userId));
    } catch (e) { /* Storage unavailable; the current page still knows the account. */ }
  }
  g.API.setAccount = saveAccount;
  g.API.clearSession = function () {
    g.API.setToken(null);
    g.API.account = null;
    g.API.accountState = 'guest';
    g.API.accountError = null;
    try {
      localStorage.removeItem('hikes.auth.token');
      localStorage.removeItem('hikes.auth.userId');
      localStorage.removeItem(ACCOUNT_CACHE_KEY);
    } catch (e) { /* Storage unavailable. */ }
  };
  g.API.loadAccount = function () {
    g.API.accountState = 'checking';
    return authToken().then(function (tk) {
      if (!tk) {
        g.API.account = null;
        g.API.accountState = 'guest';
        try { localStorage.removeItem(ACCOUNT_CACHE_KEY); } catch (e) { /* ignore */ }
        return null;
      }
      return timedFetch('/api/me/account', {
        headers: { Authorization: 'Bearer ' + tk }
      }).then(function (r) {
        if (r.status === 401) {
          g.API.clearSession();
          g.API.accountState = 'expired';
          return null;
        }
        if (!r.ok) throw new Error('/api/me/account → HTTP ' + r.status);
        return r.json().then(function (account) {
          saveAccount(account);
          return account;
        });
      }).catch(function (error) {
        var cached = cachedAccount();
        g.API.account = cached;
        g.API.accountState = 'offline';
        g.API.accountError = error;
        return cached;
      });
    });
  };

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
  g.API.guestVisit = function (code, details) {
    return guestToken().then(function (tk) {
      if (!tk) throw new Error('guest token unavailable');
      return timedFetch('/api/guest/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Guest-Token': tk },
        body: JSON.stringify(Object.assign({ code: code }, details || {}))
      }).then(function (r) {
        if (!r.ok) throw new Error('guest visit → HTTP ' + r.status);
        return r.json();
      });
    });
  };
  g.API.nearbyPoints = function (position) {
    return timedFetch('/api/points/nearby', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position)
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (body) {
          var error = body && (body.error || (body.detail && body.detail.error));
          throw new Error((error && error.message) ||
            ('附近点位查询失败（HTTP ' + r.status + '）'));
        });
      }
      return r.json();
    });
  };

  var KIND = { climb: '爬升', desc: '下降', flat: '平缓' };
  var LEV = { easy: '简单', mid: '中等', hard: '困难', hidden: '隐藏' };

  function settle(promise) {
    return promise.then(function (value) {
      return { ok: true, value: value };
    }, function (error) {
      return { ok: false, error: error };
    });
  }

  /* 线路列表是站点的主数据，山顶点位、热榜和社区是增强数据。
     以前这里用 Promise.all：任何一个增强接口 500，真实线路也会被整批丢掉，
     页面静默退回内置演示数据（看起来像只有 8 条线路、5 个山头）。
     现在每个来源独立结算，主线成功就先展示主线。 */
  g.API.ready = Promise.all([
    /* 取全量：库里 157 条线路（64 徒步 + 93 赛事），limit=100 会让第 100 条之后的
       线路在页面上"不存在"（点进详情是空白），地区筛选的计数也会跟着少 */
    settle(j('/api/routes?limit=300')),
    /* 山头列表：一条线路一张卡，卡是它的**主峰**（不是线路）。
       每个山头有自己的点位和编号，扫码打卡打在它身上。 */
    /* 取全量：库里 166 个山头（96 条线路主峰 + 69 座名山 + 用户点位），
       limit=100 会把香港、江苏、上海那批整段截掉，地区筛选的计数也会跟着错 */
    settle(j('/api/summits?limit=300')),
    settle(j('/api/points?limit=2000')),
    /* 热门登顶榜：拿不到不要因此整页报"后端没连上"，但也不能悄悄吞掉——
       把真实原因记在 API.hotError 里，榜单空态会把它原样显示出来 */
    /* 取 50 条而不是 10 条：榜上只展示前 5，但页面上的筛选要在这 50 条里筛，
       只取 10 条的话一按「海外」就只剩两三条，筛选等于没用 */
    settle(j('/api/peaks/hot?limit=50')),
    settle(j('/api/community/recent'))
  ]).then(function (res) {
    var routeResult = res[0], summitResult = res[1], pointResult = res[2];
    var hotResult = res[3], recentResult = res[4];
    var routes = routeResult.ok ? (routeResult.value.items || []) : null;
    var peaks = summitResult.ok ? (summitResult.value || []) : null;
    var points = pointResult.ok ? (pointResult.value || []) : [];
    g.API.hotError = hotResult.ok ? null : hotResult.error.message;
    g.API.recentError = recentResult.ok ? null : recentResult.error.message;
    H.hotPeaks = hotResult.ok ? (hotResult.value || []) : [];
    H.recentBoards = recentResult.ok ? (recentResult.value || []) : [];
    /* 只有线路主线失败才阻止页面渲染；其它数据降级为局部空态。 */
    g.API.error = routeResult.ok ? null : routeResult.error;
    g.API.partialErrors = res.slice(1).filter(function (r) { return !r.ok; })
      .map(function (r) { return r.error; });

    if (routes) {
      H.trails = routes.map(function (r) {
        return {
          id: r.slug, name: r.name, sub: r.sub,
          level: r.hardest_level,          /* 界面用 level，含义是"最难的那一段" */
          km: r.km, up: r.up, down: r.down,
          city: r.city,
          /* 赛事（kind=race）不套用休闲徒步估时与热量，接口给的是 null：
             显示"—"，不要再拼"小时"。 */
          hours: r.hours == null ? '—' : r.hours + ' 小时',
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
    }

    var detailRequests = {};
    g.API.loadRouteDetail = function (slug, force) {
      var trail = H.trails.find(function (item) { return item.id === slug; });
      if (!trail || (trail.detailLoaded && !force)) return Promise.resolve(trail);
      if (force) trail.detailLoaded = false;
      if (force) delete detailRequests[slug];
      if (detailRequests[slug]) return detailRequests[slug];
      detailRequests[slug] = ja('/api/routes/' + encodeURIComponent(slug)).then(function (d) {
        trail.path = d.path || [];
        trail.coordinates = d.coordinates || [];
        trail.terrainUrl = d.terrain_url || null;
        trail.terrainBounds = d.terrain_bounds || null;
        trail.terrainContour = d.terrain_contour || null;
        trail.coverUrl = d.coverUrl || d.cover_url || null;
        trail.coverThumbnailUrl = d.coverThumbnailUrl || d.cover_thumbnail_url || null;
        trail.coverByline = d.coverByline || d.cover_byline || null;
        trail.profile = d.profile || [];
        trail.elevationM = d.elevation_m || [];
        trail.segments = d.segments || [];
        trail.peakList = d.peaks || [];
        trail.canMaintainRoute = !!d.can_maintain_route;
        trail.checkpoints = d.checkpoints || [];
        trail.sections = trail.segments.map(function (s) {
          return {
            no: (s.no < 10 ? '0' : '') + s.no,
            name: KIND[s.kind] + ' · ' + s.from_km + '–' + s.to_km + ' km',
            tip: (s.rise > 0 ? '+' : '') + s.rise + ' m · ' +
                 (s.pct > 0 ? '+' : '') + s.pct + '% · ' +
                 (!s.level || s.difficulty_applicable === false ? '不评级' : LEV[s.level]),
            maxRise: s.max_rise_m, maxDrop: s.max_drop_m,
            /* 下降段 / 平缓段 level 为 null：给一个 'none' 让色板与形状退回灰标 */
            level: s.level || 'none', kind: 'route', point: ''
          };
        });
        trail.detailLoaded = true;
        return trail;
      }).finally(function () { delete detailRequests[slug]; });
      return detailRequests[slug];
    };

    /* 山头 = 线路的主峰。name 为空是正常状态（真名要实地采）→ 界面显示「名称待定」 */
    if (peaks) {
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
    }

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
    return authToken().then(function (tk) {
      if (!tk) {
        H.mySummits = [];
        H.followPeaks = [];
        H.notif = [];
        return;
      }
      return Promise.all([
        ja('/api/me/summits').catch(function () { return []; }),
        ja('/api/me/follows').catch(function () { return []; }),
        ja('/api/me/notifications').catch(function () { return []; })
      ]).then(function (r) {
        H.mySummits = r[0] || [];
        H.followPeaks = r[1] || [];
        H.notif = r[2] || [];
      });
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
