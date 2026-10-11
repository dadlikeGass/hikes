/* 维护台：认领点位、二维码自动生成、子页面内容管理
 * 通过 window.EXTRA_VIEWS / EXTRA_ACTIONS 挂到 app.js 的路由上。 */
(function (g) {
  'use strict';
  var H = g.HIKES, U = g.UI, esc = U.esc;

  var EDITS = U.load('pointEdits', {});
  var MINE = U.load('myPoints', []);          /* 维护人新建的点位 */
  function save() { U.save('pointEdits', EDITS); U.save('myPoints', MINE); }

  var TYPES = {
    peak:     { label: '山顶打卡点', pre: 'P' },
    junction: { label: '岔路路书点', pre: 'J' },
    trail:    { label: '线路起点',   pre: 'T' }
  };

  function byId(arr, id) { return arr.filter(function (x) { return x.id === id; })[0]; }

  function base(id) {
    var p = byId(H.peaks, id);
    if (p) return {
      id: p.id, type: 'peak', name: p.name, level: 'mid', alt: p.alt,
      code: 'QS-P' + (100 + p.seq), claimed: true, status: 'published', updated: '10 月 2 日',
      guideTitle: '你到顶了，这里是最高的打卡点', guideDesc: '山顶风大，注意保暖与返程时间',
      next: '返程 · 原路下山 · 约 2 小时',
      terrain: 'handsfree', ratio: '—'
    };
    var j = byId(H.junctions, id);
    if (j) {
      var t = byId(H.trails, j.trailId) || {};
      return {
        id: j.id, type: 'junction', name: j.name, level: t.level || 'easy', alt: '',
        code: j.code.replace('-', ''), claimed: true, status: 'published', updated: '9 月 28 日',
        guideTitle: j.guide.title, guideDesc: j.guide.desc, next: j.guide.next,
        terrain: 'walk', ratio: (t.up && t.km ? Math.round(t.up / t.km * 10) / 10 + ' m / km' : '—')
      };
    }
    var tr = byId(H.trails, id);
    if (tr) return {
      id: tr.id, type: 'trail', name: tr.name, level: tr.level, alt: '',
      code: 'QS-T' + String(tr.km).replace('.', ''), claimed: false, status: 'published',
      updated: '9 月 28 日', guideTitle: '从这里进山', guideDesc: '起点标牌在停车场东侧',
      next: '全程 ' + tr.km + ' km · 爬升 ' + tr.up + ' m',
      terrain: 'walk', ratio: Math.round(tr.up / tr.km * 10) / 10 + ' m / km'
    };
    return byId(MINE, id) || null;
  }
  function rec(id) {
    var b = base(id);
    return b ? Object.assign({}, b, EDITS[id] || {}) : null;
  }
  function all() {
    return H.peaks.map(function (p) { return rec(p.id); })
      .concat(H.junctions.map(function (j) { return rec(j.id); }))
      .concat(MINE.map(function (m) { return rec(m.id); }))
      .filter(Boolean);
  }
  function shortLink(code) { return 'hikes.app/p/' + String(code).replace(/[^A-Za-z0-9]/g, ''); }
  function nextCode(type) {
    var pre = (TYPES[type] || TYPES.peak).pre;
    return 'QS-' + pre + String(all().length + 101).slice(-3) + 'K';
  }

  /* ---------- 维护台首页 ---------- */
  function listView() {
    var list = all();
    var mine = list.filter(function (p) { return p.claimed; });
    var free = list.filter(function (p) { return !p.claimed; });
    var pending = 4;

    function row(p) {
      return '<a class="rowlink" href="#/admin/p/' + p.id + '">' +
        '<span class="em">' + U.levelMark(p.level, '') + '</span>' +
        '<div class="tx"><b>' + esc(p.name) + ' · ' + TYPES[p.type].label + '</b>' +
        '<span>' + esc(p.code) + ' · ' + p.status.replace('published', '已发布').replace('draft', '草稿') +
        ' · 更新于 ' + esc(p.updated) + '</span></div>' +
        '<span class="ar">›</span></a>';
    }

    return '<div class="card" style="background:var(--blue-bg);box-shadow:none">' +
      '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:5px">维护人是什么</div>' +
      '<div style="font-size:13px;color:var(--blue-deep);line-height:1.6">' +
      '认领一个点位之后，你负责它的路书准确、情报核验和标牌二维码。二维码由系统自动生成，你只需要维护页面上的内容。</div></div>' +

      '<div class="sec-head" style="margin-top:8px"><h3>我维护的点位</h3><span class="more">' + mine.length + ' 个</span></div>' +
      mine.map(row).join('') +

      '<div class="card" style="margin-top:12px">' +
      '<div class="kv2"><span>待核验情报</span><b>' + pending + ' 条</b></div>' +
      '<div class="kv2"><span>最久没更新</span><b>青山顶 · 23 天</b></div>' +
      '<div class="kv2"><span>本月新增点位</span><b>' + MINE.length + ' 个</b></div>' +
      '</div>' +

      '<button class="btn coral" data-act="new-point">新建点位 · 自动生成二维码</button>' +
      '<div class="hint">编号按「区域 + 类型 + 顺序 + 校验位」自动分配，不用手写。</div>' +

      '<div class="sec-head"><h3>还没人认领</h3><span class="more">' + free.length + ' 个</span></div>' +
      free.slice(0, 4).map(function (p) {
        return '<div class="rowlink"><span class="em">' + U.levelMark(p.level, '') + '</span>' +
          '<div class="tx"><b>' + esc(p.name) + '</b><span>' + esc(p.code) + ' · ' + TYPES[p.type].label + '</span></div>' +
          '<button class="btn ghost mini" data-act="claim-point" data-id="' + p.id + '">认领</button></div>';
      }).join('');
  }

  /* ---------- 单个点位 ---------- */
  function pointView(r) {
    var p = rec(r.id);
    if (!p) return '<div class="empty"><span class="big">⛰</span>没有这个点位。<br>' +
      '<a href="#/admin" style="color:var(--blue);font-weight:700">回维护台</a></div>';
    var draft = p.status !== 'published';
    var blocked = p.type === 'junction' || p.status === 'published';

    return '<div class="card">' +
      '<div class="row-between"><h3 style="font-size:16px;font-weight:800">二维码</h3>' +
      '<span class="chipstate ' + (draft ? 'draft' : 'live') + '">' +
      (draft ? '草稿 · 编号可改' : '已发布 · 编号锁定') + '</span></div>' +
      '<div class="qrpanel"><span class="qrbig">' + U.qrSVG(p.code) + '</span>' +
      '<div class="qrmeta"><div class="tiny muted">点位编号</div>' +
      '<div class="big">' + esc(p.code) + '</div>' +
      '<div class="tiny muted" style="margin-top:9px">短链（二维码里印的就是它）</div>' +
      '<div class="link">' + shortLink(p.code) + '</div></div></div>' +
      '<div class="btn-row"><button class="btn ghost" data-act="qr-copy" data-id="' + p.id + '">复制短链</button>' +
      '<button class="btn ghost" data-act="qr-regen" data-id="' + p.id + '">重新生成编号</button></div>' +
      '<div class="note" style="margin-top:10px">二维码里印短链、不印页面地址。页面以后怎么改都不用重印标牌；' +
      '标牌一旦贴出去，编号就锁定，只能改页面内容。</div></div>' +

      '<div class="sec-head" style="margin-top:6px"><h3>标牌预览</h3>' +
      '<span class="tagprint">改了要重印</span></div>' +
      U.signage({ level: p.level, alt: p.alt || '', seq: 0 },
        { code: p.code, alt: '海拔待补' }) +

      '<div class="sec-head" style="margin-top:6px"><h3>难度判定</h3>' +
      '<span class="more">维护人填写</span></div>' +
      '<div class="card">' +
      '<div class="fld"><label>单段爬升 / 距离比</label>' +
      '<input id="apRatio" type="text" value="' + esc(p.ratio || '') + '" placeholder="例如 180 m / km"></div>' +
      '<div class="fld"><label>地形方式</label><div class="tags-pick" id="apTerrain">' +
      H.terrains.map(function (t) {
        return '<button data-act="terrain" data-id="' + p.id + '" data-val="' + t.key + '" class="' +
          ((p.terrain || 'walk') === t.key ? 'on' : '') + '">' + t.label + '</button>';
      }).join('') + '</div></div>' +
      '<div class="note">' + H.terrains.map(function (t) {
        return '<b>' + t.label + '</b>　' + t.note;
      }).join('<br>') + '</div>' +
      '<div class="kv2" style="margin-top:10px"><span>这一档对应</span>' +
      '<b>' + H.levels[(H.terrains.filter(function (t) { return t.key === (p.terrain || "walk"); })[0] || {}).suggest || "easy"].label + '</b></div>' +
      '<div class="note">需要绳索、冰爪等保护措施时，难度会落进隐藏档（⬢ 黑色六边形），' +
      '默认不在列表里主动推荐。</div>' +
      '</div>' +
      '<div class="sec-head" style="margin-top:6px"><h3>子页面内容</h3>' +
      '<span class="more" style="color:var(--blue)">随时可改 · 不用重印</span></div>' +
      '<div class="card">' +
      '<div class="fld"><label>点位名称</label><input id="apName" type="text" value="' + esc(p.name) + '"></div>' +
      '<div class="fld"><label>难度</label><select id="apLevel">' +
      ['easy', 'mid', 'hard'].map(function (k) {
        return '<option value="' + k + '"' + (p.level === k ? ' selected' : '') + '>' + H.levels[k].label + ' · ' + H.levels[k].en + '</option>';
      }).join('') + '</select></div>' +
      (p.type !== 'junction' ? '<div class="fld"><label>海拔（米）</label><input id="apAlt" type="text" value="' +
        esc(p.alt || '') + '" placeholder="例如 1660"></div>' : '') +
      '<div class="fld"><label>「你在这里 · 往哪走」第一句</label>' +
      '<input id="apGuideTitle" type="text" value="' + esc(p.guideTitle || '') + '"></div>' +
      '<div class="fld"><label>补充说明</label>' +
      '<input id="apGuideDesc" type="text" value="' + esc(p.guideDesc || '') + '"></div>' +
      '<div class="fld"><label>下一段</label>' +
      '<input id="apNext" type="text" value="' + esc(p.next || '') + '"></div>' +
      '<button class="btn blue" data-act="save-point" data-id="' + p.id + '">保存并预览</button>' +
      '</div>' +

      '<div class="sec-head"><h3>动态内容</h3><span class="more">只能核验，不能替别人改</span></div>' +
      '<div class="card"><div class="kv2"><span>待核验情报</span><b>4 条</b></div>' +
      '<div class="kv2"><span>留言板</span><b>214 条</b></div>' +
      '<div class="kv2"><span>最近一次核验</span><b>' + esc(p.updated) + '</b></div></div>' +
      '<a class="rowlink" href="#/junctions/' + p.id + '"><span class="em">⚑</span>' +
      '<div class="tx"><b>去核验情报</b><span>确认或驳回山友上报的路况</span></div><span class="ar">›</span></a>' +

      '<div class="sec-head"><h3>发布状态</h3><span class="more">' + esc(p.updated) + '</span></div>' +
      (draft
        ? '<button class="btn coral" data-act="publish-point" data-id="' + p.id + '">提交审核并发布</button>' +
          '<div class="note" style="margin-top:10px">发布后编号锁定，标牌可以直接送印。</div>'
        : '<div class="card"><div class="kv2"><span>当前版本</span><b>v3 · 已发布</b></div>' +
          '<div class="kv2"><span>v3</span><span>' + esc(p.updated) + ' · 更新往哪走</span></div>' +
          '<div class="kv2"><span>v2</span><span>9 月 12 日 · 核验补给点</span></div>' +
          '<div class="kv2"><span>v1</span><span>8 月 30 日 · 首次创建</span></div></div>');
  }

  /* ---------- 动作 ---------- */
  function field(id) { var el = document.getElementById(id); return el ? el.value : null; }

  g.EXTRA_VIEWS = { admin: listView, 'admin-p': pointView };
  g.EXTRA_TITLES = { admin: '维护台', 'admin-p': '管理点位' };
  g.EXTRA_ACTIONS = {
    'new-point': function () {
      var id = 'np' + Date.now();
      var code = nextCode('peak');
      MINE.unshift({ id: id, type: 'peak', name: '未命名点位', level: 'easy', alt: '',
        code: code, claimed: true, status: 'draft', updated: '刚刚', guideTitle: '', guideDesc: '', next: '' });
      EDITS[id] = EDITS[id] || {};
      save();
      U.toast('已生成编号 ' + code);
      U.go('#/admin/p/' + id);
    },
    'claim-point': function (t, o) {
      EDITS[o.id] = Object.assign({}, EDITS[o.id], { claimed: true });
      save(); U.toast('已认领，去维护台管理'); g.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    'terrain': function (t, o) {
      var hit = H.terrains.filter(function (x) { return x.key === o.val; })[0] || {};
      var s = hit.suggest || 'easy';
      EDITS[o.id] = Object.assign({}, EDITS[o.id], { terrain: o.val, level: s, updated: '刚刚' });
      var m = MINE.filter(function (x) { return x.id === o.id; })[0];
      if (m) { m.level = s; }
      save();
      g.dispatchEvent(new HashChangeEvent('hashchange'));
      U.toast('地形已记录 · 难度落到 ' + H.levels[s].label);
    },
    'qr-regen': function (t, o) {
      var p = rec(o.id);
      if (p.status === 'published' && p.type !== 'junction') {
        U.toast('已发布的点位不能换编号，二维码已经印出去了');
        return;
      }
      var code = nextCode(p.type);
      EDITS[o.id] = Object.assign({}, EDITS[o.id], { code: code });
      save();
      g.dispatchEvent(new HashChangeEvent('hashchange'));
      U.toast('已重新生成 ' + code);
    },
    'qr-copy': function (t, o) {
      var p = rec(o.id), link = shortLink(p.code);
      if (navigator.clipboard) navigator.clipboard.writeText('https://' + link).catch(function () { });
      U.toast('短链已复制：' + link);
    },
    'save-point': function (t, o) {
      var patch = {
        name: field('apName') || rec(o.id).name,
        level: field('apLevel') || rec(o.id).level,
        ratio: field('apRatio') || '',
        guideTitle: field('apGuideTitle') || '',
        guideDesc: field('apGuideDesc') || '',
        next: field('apNext') || '',
        updated: '刚刚'
      };
      var alt = field('apAlt');
      if (alt !== null) patch.alt = alt.replace(/[^\d]/g, '');
      EDITS[o.id] = Object.assign({}, EDITS[o.id], patch);
      var m = MINE.filter(function (x) { return x.id === o.id; })[0];
      if (m) { Object.assign(m, patch); }
      save();
      g.dispatchEvent(new HashChangeEvent('hashchange'));
      U.toast('已保存 · 页面马上生效，标牌不用重印');
    },
    'publish-point': function (t, o) {
      EDITS[o.id] = Object.assign({}, EDITS[o.id], { status: 'published', updated: '刚刚' });
      var m = MINE.filter(function (x) { return x.id === o.id; })[0];
      if (m) { m.status = 'published'; m.updated = '刚刚'; }
      save();
      g.dispatchEvent(new HashChangeEvent('hashchange'));
      U.toast('已发布 · 编号锁定，可以送印了');
    }
  };
})(window);
