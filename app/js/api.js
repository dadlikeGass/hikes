/* 把后端数据灌进 HIKES —— app.js 照旧同步读取，不用重构它的渲染逻辑。
   先跑 api.js 拿到数据，再让 app.js 渲染。 */
(function (g) {
  var H = g.HIKES;
  function j(u) {
    return fetch(u).then(function (r) {
      if (!r.ok) throw new Error(u + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  /* 先建对象，再挂 promise —— 否则 catch 里引用 g.API 会报错并把错误吞掉 */
  g.API = { ok: false, error: null, ready: null };

  var KIND = { climb: '爬升', desc: '下降', flat: '平缓' };
  var LEV = { easy: '简单', mid: '中等', hard: '困难', hidden: '隐藏' };

  g.API.ready = Promise.all([
    j('/api/routes?limit=100'),
    j('/api/peaks?limit=300'),
    j('/api/points?limit=300')
  ]).then(function (res) {
    var routes = res[0].items, peaks = res[1], points = res[2];

    /* 线路详情要的分段 / 山顶 / 轨迹，得逐条取（列表接口不返回） */
    return Promise.all(routes.map(function (r) {
      return j('/api/routes/' + r.slug)
        .then(function (d) { return { list: r, det: d }; })
        .catch(function () { return { list: r, det: null }; });
    })).then(function (all) {

    H.trails = all.map(function (x) {
      var r = x.list, d = x.det || {};
      return {
        id: r.slug, name: r.name, sub: r.sub,
        level: r.hardest_level,          /* 界面用 level，含义是"最难的那一段" */
        km: r.km, up: r.up, down: r.down,
        hours: (r.hours || '—') + ' 小时',
        hoursVal: r.hours, kcal: r.kcal,
        visits7: r.weekly_visits,
        fastest: { time: r.fastest_time || '—', who: r.fastest_holder || '—' },
        peakCount: r.peak_count, segmentCount: r.segment_count, visitCount: r.visit_count,
        desc: r.sub || '', newest: false,
        status: null,                     /* 最近路况：后端还没这张表 */
        /* 详情页用的真数据 */
        path: d.path || [], profile: d.profile || [],
        segments: d.segments || [], peakList: d.peaks || [],
        sections: (d.segments || []).map(function (s) {
          return {
            no: (s.no < 10 ? '0' : '') + s.no,
            name: KIND[s.kind] + ' · ' + s.from_km + '–' + s.to_km + ' km',
            tip: (s.rise > 0 ? '+' : '') + s.rise + ' m · ' +
                 (s.pct > 0 ? '+' : '') + s.pct + '% · ' + LEV[s.level],
            level: s.level, kind: 'route', point: ''
          };
        })
      };
    });

    /* 山顶：来自 GPX 自动识别 */
    H.peaks = peaks.map(function (p) {
      return {
        id: p.route_slug + '-' + p.idx, name: p.route_name,
        alt: p.altitude, trailName: p.route_name,
        km: p.km, rise: p.rise, visits30: 0, fastest: '—', photos: 0,
        board: [], comments: []
      };
    });

    H.points = points;
    g.API.ok = true;
    return true;
    });
  }).catch(function (e) {
    g.API.error = e;
    console.error('[api] 数据加载失败：', e);
    return false;
  });
})(window);
