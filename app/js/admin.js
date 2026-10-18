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

    /* 广告待审队列：维护人是运营角色，广告必须过审才上架。
       数据要带登录态，所以渲染完再异步填（页面不阻塞）。 */
    setTimeout(fillAdQueue, 0);

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

      '<div id="adqueue"><div class="sec-head" style="margin-top:12px"><h3>广告待审</h3>' +
      '<span class="more">加载中…</span></div></div>' +

      '<div class="sec-head"><h3>还没人认领</h3><span class="more">' + free.length + ' 个</span></div>' +
      free.slice(0, 4).map(function (p) {
        return '<div class="rowlink"><span class="em">' + U.levelMark(p.level, '') + '</span>' +
          '<div class="tx"><b>' + esc(p.name) + '</b><span>' + esc(p.code) + ' · ' + TYPES[p.type].label + '</span></div>' +
          '<button class="btn ghost mini" data-act="claim-point" data-id="' + p.id + '">认领</button></div>';
      }).join('');
  }

  /* ---------- 广告待审队列 ---------- */
  function fillAdQueue() {
    var box = document.getElementById('adqueue');
    if (!box) return;
    Promise.all([
      window.API.ja('/api/admin/ads?status=pending'),
      window.API.ja('/api/admin/ads?status=approved')
    ]).then(function (res) {
      var pend = res[0] || [], live = (res[1] || []).slice(0, 8);
      var meta = function (a) {
        return '<div style="font-size:11.5px;color:var(--ink3);margin:6px 0 9px">' +
          esc(a.peakName || '') + ' · ' + esc(a.pointCode || '') +
          ' · 投放至 ' + String(a.endsAt).slice(0, 10) + '</div>';
      };
      box.innerHTML =
        '<div class="sec-head" style="margin-top:12px"><h3>广告待审</h3>' +
        '<span class="more">' + pend.length + ' 条</span></div>' +
        (pend.length ? pend.map(function (a) {
          return '<div class="card" style="padding:12px 14px;margin-bottom:10px">' +
            '<b style="font-size:13.5px">' + esc(a.title) + '</b>' +
            (a.body ? '<div style="font-size:12.5px;color:var(--ink2);margin-top:4px">' + esc(a.body) + '</div>' : '') +
            meta(a) +
            '<div class="mini-actions">' +
            '<button class="pill-btn acc" data-act="ad-approve" data-id="' + a.id + '">通过 · 留言区</button>' +
            '<button class="pill-btn acc" data-act="ad-approve-top" data-id="' + a.id + '">通过 · 放第一屏</button>' +
            '<button class="pill-btn ign" data-act="ad-reject" data-id="' + a.id + '">驳回</button>' +
            '</div></div>';
        }).join('') : '<div class="empty">没有待审广告。</div>') +

        /* 已上架的可以随时调位置：默认在留言区顶部，"提到第一屏"是运营手里的开关 */
        (live.length
          ? '<div class="sec-head" style="margin-top:14px"><h3>已上架 · 位置</h3>' +
            '<span class="more">默认在留言区顶部</span></div>' +
            live.map(function (a) {
              return '<div class="card" style="padding:11px 14px;margin-bottom:9px">' +
                '<b style="font-size:13px">' + esc(a.title) + '</b>' +
                '<div style="font-size:11.5px;color:var(--ink3);margin:5px 0 8px">' +
                esc(a.pointCode || '') + ' · ' +
                (a.promoted ? '<b style="color:var(--coral)">已在第一屏</b>' : '在留言区顶部') + '</div>' +
                '<button class="pill-btn ' + (a.promoted ? '' : 'acc') + '" data-act="ad-promote" data-id="' +
                a.id + '" data-val="' + (a.promoted ? '1' : '0') + '">' +
                (a.promoted ? '退回留言区' : '提到第一屏') + '</button></div>';
            }).join('')
          : '');
    }).catch(function () {
      box.innerHTML = '<div class="hint">广告审核与首屏提升由系统审核员处理。</div>';
    });
  }

  function fillCollaborationQueue() {
    var box = document.getElementById('collaborationQueue');
    if (!box) return;
    window.API.ja('/api/admin/collaboration-applications?status=pending').then(function (items) {
      box.innerHTML = '<div class="sec-head"><h3>维护协作待审</h3><span class="more">' + items.length + ' 条</span></div>' +
        (items.length ? items.map(function (a) {
          return '<div class="card"><b>' + esc(a.boardName || '山顶板 #' + a.boardId) +
            ' · ' + esc(a.applicantName || '申请人 #' + a.applicantId) + '</b>' +
            '<div class="hint">' + esc(a.message) + '</div><div class="mini-actions">' +
            '<button class="pill-btn acc" data-act="collaboration-approve" data-id="' + a.id + '">通过</button>' +
            '<button class="pill-btn ign" data-act="collaboration-reject" data-id="' + a.id + '">驳回</button>' +
            '</div></div>';
        }).join('') : '<div class="empty">没有待审申请。</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  /* 维护申请（山大王 / 山寨）待审队列。理由、频次、期待都摆出来，
     审核人要写说明（驳回时必须写给申请人看）。 */
  function fillMasterQueue() {
    var box = document.getElementById('masterQueue');
    if (!box) return;
    Promise.all([
      window.API.ja('/api/admin/king-applications?status=pending'),
      window.API.ja('/api/admin/king-applications?status=pending_confirmation')
    ]).then(function (res) {
      var items = res[0] || [], waiting = res[1] || [];
      box.innerHTML = '<div class="sec-head"><h3>统一山头申请待审</h3>' +
        '<span class="more">' + items.length + ' 条 · 3 天处理目标</span></div>' +
        (items.length ? items.map(function (a) {
          var due = (a.dueAt || '').slice(0, 16).replace('T', ' ');
          return '<div class="card"><b>' + esc(a.mountainName || a.newName || a.pointCode) + ' · ' +
            esc(a.applicantName || ('申请人 #' + a.id)) + '</b>' +
            '<div class="hint">' + (a.targetKind === 'new' ? '申请新山头' : a.intent === 'join' ? '申请加入山寨' : '申请成为负责人') +
            ' · 一个月能去 ' + a.visitsPerMonth + ' 次 · 截止 ' + esc(due) + '</div>' +
            (a.isDelayed ? '<div class="hint" style="color:#a55326"><b>已延迟：</b>超过 3 天处理目标，不会自动失效或通过</div>' : '') +
            (a.contact ? '<div class="hint">联系方式（仅审核可见）：' + esc(a.contact) + '</div>' : '') +
            (a.ownerName ? '<div class="hint">现任负责人：' + esc(a.ownerName) + ' · 负责人意见：' +
              esc(a.ownerOpinion || '尚未提交') + '</div>' : '') +
            '<div class="hint">为什么申请：' + esc(a.reason) + '</div>' +
            '<div class="hint">经营计划：' + esc(a.expectations) + '</div>' +
            (a.newRegion || a.newLocationText ? '<div class="hint">位置：' + esc(a.newRegion || '') +
              ' · ' + esc(a.newLocationText || '') + '</div>' : '') +
            '<div class="mini-actions">' +
            '<button class="pill-btn acc" data-act="master-approve" data-id="' + a.id + '">通过</button>' +
            '<button class="pill-btn" data-act="master-needs" data-id="' + a.id + '">要求补充</button>' +
            '<button class="pill-btn ign" data-act="master-reject" data-id="' + a.id + '">驳回</button>' +
            '</div></div>';
        }).join('') : '<div class="empty">没有待审的统一申请。</div>') +
        (waiting.length ? '<div class="sec-head" style="margin-top:14px"><h3>待申请人确认加入</h3>' +
          '<span class="more">' + waiting.length + ' 条 · 确认前没有成员权限</span></div>' +
          waiting.map(function (a) {
            return '<div class="card"><b>' + esc(a.mountainName || a.pointCode) + ' · ' +
              esc(a.applicantName || '申请人') + '</b><div class="hint">' + esc(a.reviewNote || '等待本人确认继续') +
              '</div></div>';
          }).join('') : '');
    }).catch(function () { box.innerHTML = ''; });
  }

  function fillClanQueue() {
    var box = document.getElementById('clanQueue');
    if (!box) return;
    window.API.ja('/api/admin/clans?status=pending').then(function (items) {
      box.innerHTML = '<div class="sec-head"><h3>山寨组建待审</h3><span class="more">' + items.length + ' 条</span></div>' +
        (items.length ? items.map(function (c) {
          return '<div class="card"><b>' + esc(c.mountainName || ('山头 #' + c.mountainId)) +
            ' · ' + esc(c.name) + '</b>' +
            '<div class="hint">介绍：' + esc(c.intro) + '</div>' +
            '<div class="hint">协作计划：' + esc(c.collaborationPlan) + '</div>' +
            '<div class="hint">招募要求：' + esc(c.recruitRequirements) + '</div>' +
            '<div class="mini-actions"><button class="pill-btn acc" data-act="clan-approve" data-id="' + c.id + '">成立</button>' +
            '<button class="pill-btn ign" data-act="clan-reject" data-id="' + c.id + '">驳回</button></div></div>';
        }).join('') : '<div class="empty">没有待审的山寨。</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  function fillCoverQueue() {
    var box = document.getElementById('coverQueue');
    if (!box) return;
    window.API.ja('/api/admin/cover-submissions?status=pending').then(function (items) {
      box.innerHTML = '<div class="sec-head"><h3>路书封面待审</h3><span class="more">' + items.length + ' 条</span></div>' +
        (items.length ? items.map(function (c) {
          return '<div class="card"><b>' + esc(c.routeSlug || ('线路 #' + c.routeId)) +
            ' · ' + esc(c.photographer) + '</b>' +
            (c.thumbnailUrl ? '<img src="' + esc(c.thumbnailUrl) + '" alt="" loading="lazy" ' +
              'style="width:100%;max-width:420px;aspect-ratio:16/7;object-fit:cover;border-radius:12px;margin:8px 0">' : '') +
            '<div class="hint">拍摄：' + esc(c.shotAt || '未填日期') + ' · 投稿人 ' +
            esc(c.submitterName || '山友') + ' · 山头推荐 ' + (c.recommendations || 0) + ' 次</div>' +
            (c.caption ? '<div class="hint">说明：' + esc(c.caption) + '</div>' : '') +
            '<div class="mini-actions"><button class="pill-btn acc" data-act="cover-approve" data-id="' + c.id + '">通过</button>' +
            '<button class="pill-btn ign" data-act="cover-reject" data-id="' + c.id + '">驳回</button></div></div>';
        }).join('') : '<div class="empty">没有待审封面。</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  function fillCommentAppeals() {
    var box = document.getElementById('commentAppeals');
    if (!box) return;
    window.API.ja('/api/admin/comment-appeals?status=pending').then(function (items) {
      box.innerHTML = '<div class="sec-head"><h3>留言申诉待审</h3><span class="more">' + items.length + ' 条</span></div>' +
        (items.length ? items.map(function (a) {
          return '<div class="card"><b>' + esc(a.pointName || a.pointCode || '山顶留言板') +
            ' · ' + esc(a.authorName || '山友') + '</b>' +
            '<div class="hint">原留言：' + esc(a.commentText || '') + '</div>' +
            '<div class="hint">隐藏理由：' + esc(a.hiddenReason || '历史记录无理由') + '</div>' +
            '<div class="hint">申诉理由：' + esc(a.reason) + '</div><div class="mini-actions">' +
            '<button class="pill-btn acc" data-act="appeal-restore" data-id="' + a.id + '">恢复</button>' +
            '<button class="pill-btn ign" data-act="appeal-reject" data-id="' + a.id + '">驳回</button>' +
            '</div></div>';
        }).join('') : '<div class="empty">没有待审申诉。</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  /* ---------- 山脚候选待核验 ----------
     轨迹起点只是算法给出的候选，不直接公开。负责人到现场核对名称与坐标后
     才能发布；发布后才会出现在「附近打卡」里。 */
  function fillTrailheadQueue() {
    var box = document.getElementById('trailheadQueue');
    if (!box) return;
    window.API.ja('/api/me/trailhead-candidates').then(function (items) {
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="sec-head"><h3>山脚候选待核验</h3>' +
        '<span class="more">' + items.length + ' 个 · 轨迹起点推算</span></div>' +
        '<div class="hint" style="margin:0 0 10px">候选不会自动公开。到现场核对名称和位置后再发布，' +
        '发布后才会进入附近打卡；不是山脚的直接标掉。</div>' +
        items.slice(0, 12).map(function (c) {
          var title = c.name || c.routeName || c.code;
          var place = [c.routeName, c.mountainName].filter(Boolean).join(' · ');
          var coord = Number(c.lat).toFixed(5) + ', ' + Number(c.lng).toFixed(5);
          return '<div class="card"><b>' + esc(title) + '</b>' +
            '<div class="hint">' + esc(place || '未关联山头') + ' · ' + esc(c.code) + '</div>' +
            '<div class="hint">候选坐标 ' + coord +
            (c.needsMountain ? ' · <b style="color:#a55326">需先关联山头</b>' : '') + '</div>' +
            (c.needsMountain
              ? '<div class="field"><label>关联山头</label><select id="thMountain-' + c.id +
                '"><option value="">选择山头…</option></select></div>'
              : '') +
            '<div class="mini-actions">' +
            '<button class="pill-btn acc" data-act="trailhead-publish" data-id="' + c.id +
            '" data-code="' + esc(c.code) + '" data-name="' + esc(title) + '">按此坐标发布</button>' +
            '<button class="pill-btn ign" data-act="trailhead-locate" data-id="' + c.id +
            '" data-code="' + esc(c.code) + '" data-name="' + esc(title) + '">用我的位置修正</button>' +
            '<button class="pill-btn" data-act="trailhead-reject" data-id="' + c.id +
            '">不是这里</button></div></div>';
        }).join('') +
        (items.length > 12
          ? '<div class="hint">先列最近要处理的 12 个；发布或标掉后会继续显示。</div>'
          : '');
      fillMountainPickers(items.filter(function (c) { return c.needsMountain; }));
    }).catch(function () { box.innerHTML = ''; });
  }

  function fillMountainPickers(rows) {
    if (!rows.length) return;
    window.API.ja('/api/mountains?limit=1000').then(function (mountains) {
      rows.forEach(function (c) {
        var sel = document.getElementById('thMountain-' + c.id);
        if (!sel) return;
        sel.innerHTML = '<option value="">选择山头…</option>' + mountains.map(function (m) {
          return '<option value="' + m.id + '">' + esc(m.name) +
            (m.region ? ' · ' + esc(m.region) : '') + '</option>';
        }).join('');
        if (c.mountainId) sel.value = String(c.mountainId);
      });
    }).catch(function () {});
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

  function liveListView() {
    setTimeout(function () {
      var box = document.getElementById('maintenanceList');
      if (!box) return;
      window.API.ja('/api/me/summits').then(function (items) {
        H.mySummits = items;
        box.innerHTML = items.length ? items.map(function (p) {
          return '<a class="rowlink" href="#/admin/p/' + esc(p.code) + '">' +
            '<span class="em">' + U.icon('hill') + '</span><div class="tx"><b>' + esc(p.name || p.code) + '</b>' +
            '<span>' + esc(p.code) + ' · 未读留言 ' + p.unread + ' 条 · 近 7 天到访 ' + p.heat7 + '</span></div>' +
            '<span class="ar">›</span></a>';
        }).join('') : '<div class="empty">还没有负责的山头。先到山头页查看招募。</div>';
      }).catch(function () { box.innerHTML = '<div class="empty">请先登录，再查看维护任务。</div>'; });
      fillAdQueue();
      fillCollaborationQueue();
      fillMasterQueue();
      fillClanQueue();
      fillCoverQueue();
      fillCommentAppeals();
      fillTrailheadQueue();
    }, 0);
    return '<div class="pad"><div class="sec-head"><h3>我维护的山头</h3></div>' +
      '<div id="maintenanceList" class="card tight"><div class="empty">正在读取…</div></div>' +
      '<div id="trailheadQueue"></div>' +
      '<div id="adqueue"></div><div id="masterQueue"></div><div id="clanQueue"></div>' +
      '<div id="coverQueue"></div><div id="collaborationQueue"></div>' +
      '<div id="commentAppeals"></div></div>';
  }

  function livePointView(r) {
    setTimeout(function () {
      var box = document.getElementById('maintenancePoint');
      if (!box) return;
      window.API.ja('/api/me/summits').then(function (mine) {
        var membership = mine.filter(function (p) {
          return p.code === r.id || (p.boardPointCodes || []).indexOf(r.id) >= 0;
        })[0];
        if (!membership) throw new Error('无维护权限');
        return Promise.all([
          fetch('/api/points/' + encodeURIComponent(r.id)).then(function (x) { return x.json(); }),
          membership.role === 'collaborator' ? Promise.resolve(null) :
            window.API.ja('/api/points/' + encodeURIComponent(r.id) + '/ads'),
          Promise.resolve(membership.role)
        ]);
      }).then(function (res) {
        var p = res[0], ads = res[1], collaborator = res[2] === 'collaborator';
        box.innerHTML = '<h2 class="arrive-h">' + esc(p.name || p.code) + '</h2>' +
          '<div class="hint">' + esc(p.code) + ' · 待核验 ' + p.pendingCount + ' 条 · 当前版本 v' + p.version + '</div>' +
          (collaborator ? '' : '<div class="card"><div class="field"><label>点位名称</label><input id="livePointName" value="' + esc(p.name || '') + '"></div>' +
          '<div class="field"><label>现场说明</label><textarea id="livePointGuide" maxlength="500">' +
          esc(p.guide && p.guide.desc || '') + '</textarea></div>' +
          '<div class="field"><label>' + (p.type === 'junction' ? '岔路口介绍' : '山峰介绍（建议约 100 字）') + '</label><textarea id="livePointIntro" maxlength="500" placeholder="介绍位置、地貌与现场特点；请以核实过的信息为准">' +
          esc(p.guide && p.guide.intro || '') + '</textarea></div>' +
          (p.type === 'peak' ? '<div class="field"><label>首登者介绍（注明来源，未知可留空）</label><textarea id="liveFirstAscent" maxlength="500" placeholder="首登者 / 队伍、时间与资料来源">' +
            esc(p.guide && p.guide.first_ascent || '') + '</textarea></div>' +
            '<div class="field"><label>登顶方式</label><textarea id="liveAscentMethod" maxlength="500" placeholder="路线、关键岔口、难点与返程提示">' +
            esc(p.guide && p.guide.ascent_method || '') + '</textarea></div>' : '') +
          '<button class="btn blue" data-act="real-save-point" data-id="' + p.id + '" data-val="' + esc(JSON.stringify(p.guide || {})) + '">保存点位信息</button></div>') +
          '<div class="sec-head"><h3>待核验留言</h3></div>' +
          '<div id="liveFlagged" class="card tight"><div class="empty">正在读取…</div></div>' +
          (collaborator ? '' : '<button class="btn ghost" data-act="ad-panel" data-code="' + esc(p.code) + '">广告素材与审核状态</button>' +
          '<div class="hint">已提交 ' + (ads.mine || []).length + ' 条广告；审核及首屏提升由系统负责。</div>');
        loadFlagged(p.id);
      }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }, 0);
    return '<div class="pad" id="maintenancePoint"><div class="empty">正在读取维护任务…</div></div>';
  }

  function loadFlagged(pointId) {
    window.API.ja('/api/points/' + pointId + '/comments?limit=50').then(function (d) {
      var box = document.getElementById('liveFlagged');
      if (!box) return;
      var flagged = (d.items || []).filter(function (c) { return c.status === 'flagged'; });
      box.innerHTML = flagged.length ? flagged.map(function (c) {
        return '<div class="rowlink"><div class="tx"><b>' + esc(c.nickname || '山友') + '</b><span>' +
          esc(c.text) + '</span></div><button class="btn ghost mini" data-act="real-hide-comment" data-id="' +
          c.id + '" data-val="' + pointId + '">隐藏</button></div>';
      }).join('') : '<div class="empty">没有待核验留言。</div>';
    }).catch(function () { var box = document.getElementById('liveFlagged'); if (box) box.textContent = '留言加载失败'; });
  }

  g.EXTRA_VIEWS = { admin: liveListView, 'admin-p': livePointView };
  g.EXTRA_TITLES = { admin: '维护台', 'admin-p': '管理点位' };
  g.EXTRA_ACTIONS = {
    'trailhead-publish': function (t, o) {
      var name = window.prompt('山脚的正式名称（会显示在附近打卡里）：',
        t.getAttribute('data-name') || '');
      if (name === null) return;
      name = name.trim();
      if (name.length < 2) { U.toast('请填写至少 2 个字的山脚名称'); return; }
      var body = { decision: 'publish', name: name };
      var picker = document.getElementById('thMountain-' + o.id);
      if (picker) {
        if (!picker.value) { U.toast('请先选择这个山脚所属的山头'); return; }
        body.mountainId = Number(picker.value);
      }
      t.disabled = true;
      window.API.ja('/api/points/' + o.id + '/trailhead-review', {
        method: 'POST', body: JSON.stringify(body)
      }).then(function () { U.toast('已发布，附近打卡现在能找到它'); fillTrailheadQueue(); })
        .catch(function (e) { U.toast(e.message || '发布失败'); t.disabled = false; });
    },
    'trailhead-locate': function (t, o) {
      if (!navigator.geolocation) { U.toast('这个浏览器拿不到定位'); return; }
      t.disabled = true;
      U.toast('正在取你的位置…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var acc = Math.round(pos.coords.accuracy || 0);
        if (acc > 50) {
          U.toast('定位精度 ±' + acc + ' 米，太粗了；到开阔处再试，或直接按候选坐标发布');
          t.disabled = false;
          return;
        }
        var name = window.prompt('确认山脚名称（会用到你当前的位置，精度 ±' + acc + ' 米）：',
          t.getAttribute('data-name') || '');
        if (name === null) { t.disabled = false; return; }
        name = name.trim();
        if (name.length < 2) { U.toast('请填写至少 2 个字的山脚名称'); t.disabled = false; return; }
        var body = { decision: 'publish', name: name,
          lat: pos.coords.latitude, lng: pos.coords.longitude };
        var picker = document.getElementById('thMountain-' + o.id);
        if (picker) {
          if (!picker.value) { U.toast('请先选择这个山脚所属的山头'); t.disabled = false; return; }
          body.mountainId = Number(picker.value);
        }
        window.API.ja('/api/points/' + o.id + '/trailhead-review', {
          method: 'POST', body: JSON.stringify(body)
        }).then(function () { U.toast('已按你的位置发布'); fillTrailheadQueue(); })
          .catch(function (e) { U.toast(e.message || '发布失败'); t.disabled = false; });
      }, function (e) {
        U.toast(e.code === 1 ? '没有定位权限；可在浏览器设置里允许' : '定位失败，请重试');
        t.disabled = false;
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    },
    'trailhead-reject': function (t, o) {
      var note = window.prompt('为什么它不是山脚？（选填，维护人自己能看见）', '');
      if (note === null) return;
      t.disabled = true;
      window.API.ja('/api/points/' + o.id + '/trailhead-review', {
        method: 'POST', body: JSON.stringify({ decision: 'reject', note: note })
      }).then(function () { U.toast('已标记，不再出现在待核验里'); fillTrailheadQueue(); })
        .catch(function (e) { U.toast(e.message || '操作失败'); t.disabled = false; });
    },
    'appeal-restore': function (t, o) {
      var note = prompt('恢复依据（至少 8 字）');
      if (note === null) return;
      if (note.trim().length < 8) { U.toast('请填写至少 8 字复核依据'); return; }
      t.disabled = true;
      window.API.ja('/api/admin/comment-appeals/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'restored', note: note.trim() })
      }).then(function () { U.toast('留言已恢复'); fillCommentAppeals(); })
        .catch(function () { U.toast('复核失败'); t.disabled = false; });
    },
    'appeal-reject': function (t, o) {
      var note = prompt('驳回理由（至少 8 字）');
      if (note === null) return;
      if (note.trim().length < 8) { U.toast('请填写至少 8 字复核依据'); return; }
      t.disabled = true;
      window.API.ja('/api/admin/comment-appeals/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'rejected', note: note.trim() })
      }).then(function () { U.toast('申诉已驳回'); fillCommentAppeals(); })
        .catch(function () { U.toast('复核失败'); t.disabled = false; });
    },
    'master-approve': function (t, o) {
      var note = window.prompt('通过说明（申请人会看到）：', '资料核过，欢迎维护这座山');
      if (note === null) return;
      window.API.ja('/api/admin/king-applications/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'approved', note: note })
      }).then(function () { U.toast('已通过'); fillMasterQueue(); fillClanQueue(); fillCollaborationQueue(); })
        .catch(function (e) { U.toast('没通过：' + e.message); });
    },
    'master-needs': function (t, o) {
      var note = window.prompt('要申请人补充什么？（至少 6 个字）', '请补充 GPX 轨迹或位置说明');
      if (note === null) return;
      window.API.ja('/api/admin/king-applications/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'needs_info', note: note })
      }).then(function () { U.toast('已要求补充'); fillMasterQueue(); })
        .catch(function (e) { U.toast('操作失败：' + e.message); });
    },
    'master-reject': function (t, o) {
      var note = window.prompt('驳回理由（申请人会看到，至少 6 个字）：', '');
      if (note === null) return;
      window.API.ja('/api/admin/king-applications/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'rejected', note: note })
      }).then(function () { U.toast('已驳回'); fillMasterQueue(); })
        .catch(function (e) { U.toast('驳回失败：' + e.message); });
    },
    'clan-approve': function (t, o) {
      var note = window.prompt('成立说明（至少 6 个字）：', '招募要求清楚，同意成立山寨');
      if (note === null) return;
      window.API.ja('/api/admin/clans/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'approved', note: note })
      }).then(function () { U.toast('山寨已成立'); fillClanQueue(); })
        .catch(function (e) { U.toast('操作失败：' + e.message); });
    },
    'clan-reject': function (t, o) {
      var note = window.prompt('驳回理由（至少 6 个字）：', '');
      if (note === null) return;
      window.API.ja('/api/admin/clans/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'rejected', note: note })
      }).then(function () { U.toast('已驳回'); fillClanQueue(); })
        .catch(function (e) { U.toast('驳回失败：' + e.message); });
    },
    'cover-approve': function (t, o) {
      var note = window.prompt('通过说明（作者会看到）：', '真实性与授权已核对');
      if (note === null) return;
      window.API.ja('/api/admin/cover-submissions/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'approved', note: note })
      }).then(function () { U.toast('封面已通过'); fillCoverQueue(); })
        .catch(function (e) { U.toast('操作失败：' + e.message); });
    },
    'cover-reject': function (t, o) {
      var note = window.prompt('驳回理由（作者会看到，至少 6 个字）：', '');
      if (note === null) return;
      window.API.ja('/api/admin/cover-submissions/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'rejected', note: note })
      }).then(function () { U.toast('已驳回'); fillCoverQueue(); })
        .catch(function (e) { U.toast('驳回失败：' + e.message); });
    },
    'collaboration-approve': function (t, o) {
      var note = prompt('审核依据（至少 8 字）');
      if (note === null) return;
      if (note.trim().length < 8) { U.toast('请填写至少 8 字的审核依据'); return; }
      t.disabled = true;
      window.API.ja('/api/admin/collaboration-applications/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'approved', note: note.trim() })
      }).then(function () { U.toast('已授权本板协作'); fillCollaborationQueue(); })
        .catch(function () { U.toast('审核失败'); t.disabled = false; });
    },
    'collaboration-reject': function (t, o) {
      var note = prompt('驳回理由（至少 8 字）');
      if (note === null) return;
      if (note.trim().length < 8) { U.toast('请填写至少 8 字的理由'); return; }
      t.disabled = true;
      window.API.ja('/api/admin/collaboration-applications/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ decision: 'rejected', note: note.trim() })
      }).then(function () { U.toast('已驳回'); fillCollaborationQueue(); })
        .catch(function () { U.toast('审核失败'); t.disabled = false; });
    },
    'real-save-point': function (t, o) {
      var name = (field('livePointName') || '').trim();
      var desc = (field('livePointGuide') || '').trim();
      var intro = (field('livePointIntro') || '').trim();
      var firstAscent = field('liveFirstAscent');
      var ascentMethod = field('liveAscentMethod');
      if (!name) { U.toast('请填写点位名称'); return; }
      var guide = {};
      try { guide = JSON.parse(o.val || '{}'); } catch (e) { guide = {}; }
      guide.desc = desc;
      guide.intro = intro;
      if (firstAscent !== null) guide.first_ascent = firstAscent.trim();
      if (ascentMethod !== null) guide.ascent_method = ascentMethod.trim();
      t.disabled = true;
      window.API.ja('/api/points/' + o.id, { method: 'PATCH',
        body: JSON.stringify({ name: name, guide: guide })
      }).then(function () { U.toast('已保存'); }).catch(function () { U.toast('保存失败，请检查权限'); })
        .then(function () { t.disabled = false; });
    },
    'real-hide-comment': function (t, o) {
      var reason = prompt('隐藏理由（至少 8 字）');
      if (reason === null) return;
      if (reason.trim().length < 8) { U.toast('请填写至少 8 字理由'); return; }
      t.disabled = true;
      window.API.ja('/api/comments/' + o.id + '/hide', { method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }) })
        .then(function () { U.toast('已隐藏'); loadFlagged(o.val); })
        .catch(function () { U.toast('处理失败，请检查权限'); t.disabled = false; });
    },
    /* 广告审核：通过即上架（进入首页/路书页/山头页的轮播位），驳回要写理由 */
    'ad-approve': function (t, o) {
      window.API.ja('/api/admin/ads/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ approve: true })
      }).then(function () { U.toast('已上架'); fillAdQueue(); })
        .catch(function () { U.toast('审核失败，稍后再试'); });
    },
    /* 通过并提升：默认位置是留言区顶部，这条把它提到第一屏 */
    'ad-approve-top': function (t, o) {
      window.API.ja('/api/admin/ads/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ approve: true, promote: true })
      }).then(function () { U.toast('已上架，并放到第一屏'); fillAdQueue(); })
        .catch(function () { U.toast('审核失败，稍后再试'); });
    },
    /* 已上架的广告可以随时调位置：提到第一屏 / 退回留言区 */
    'ad-promote': function (t, o) {
      var on = o.val === '1';                 /* 当前是否已在第一屏 */
      window.API.ja('/api/admin/ads/' + o.id + '/promote?promote=' + (on ? 'false' : 'true'),
                    { method: 'POST' })
        .then(function () { U.toast(on ? '已退回留言区' : '已提到第一屏'); fillAdQueue(); })
        .catch(function () { U.toast('调整失败'); });
    },
    'ad-reject': function (t, o) {
      var reason = prompt('驳回理由（会显示给投放的维护人）', '与户外无关');
      if (reason === null) return;
      window.API.ja('/api/admin/ads/' + o.id + '/review', {
        method: 'POST', body: JSON.stringify({ approve: false, reason: reason || '不符合投放规范' })
      }).then(function () { U.toast('已驳回'); fillAdQueue(); })
        .catch(function () { U.toast('审核失败，稍后再试'); });
    },
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
