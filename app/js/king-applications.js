/* 统一山大王申请、申请进度与「我管理的留言版」。
 *
 * 2026-10-17 起旧入口不再在浏览器里直接创建点位或授权：
 *   搜索已有山头 / 新建山头 → 一份私有申请 → 平台审核 → 授予负责人或成员身份。
 * 这个模块保持原生 JavaScript，不把新业务继续塞进 app.js；
 * 渲染完成后由 app.js 调 KING_APP.mount(r) 填充异步数据。
 */
(function (g) {
  'use strict';

  var U = g.UI;
  var esc = U.esc;
  var A = {
    mode: 'existing', type: 'peak', target: null, results: [], app: null,
    busy: false, searchTimer: null, autosaveTimer: null, gpxRef: null,
    loadedKey: '', managed: null, managedError: null, detail: null,
    detailError: null, progress: null, progressError: null
  };

  var STATUS = {
    draft: ['草稿', '还在你手里，只有本账号可见'],
    pending: ['待审核', '平台会在 3 天内处理；到期未处理只标延迟，不会自动通过'],
    needs_info: ['需补充', '在原申请上补完再交，版本会保留'],
    waiting_clan: ['等待山寨开放', '目前只是加入意向，还不是成员'],
    pending_confirmation: ['待你确认', '山头或山寨状态变了；只有本人确认才会继续'],
    approved: ['已通过', '已按审核结果授予负责人或成员身份'],
    rejected: ['未通过', '可以查看审核说明后补充再申请'],
    withdrawn: ['已撤回', '你自己收回的申请'],
    expired: ['已失效', '超过约定处理时间，可以重新提交']
  };

  function isLoggedIn() {
    try { return !!localStorage.getItem('hikes.auth.token'); } catch (e) { return false; }
  }

  function query() {
    var raw = (location.hash.split('?')[1] || '');
    try { return new URLSearchParams(raw); } catch (e) { return { get: function () { return null; } }; }
  }

  function go(hash) { location.hash = hash; }

  function errText(error) {
    if (!error) return '请求失败，请稍后重试';
    if (error.code === 'UNAUTHORIZED' || error.code === 'TOKEN_EXPIRED') {
      return '登录已过期，请重新登录后再继续';
    }
    return error.message || errorTextFallback(error);
  }
  function errorTextFallback(error) { return error.detail || error.status ? '请求失败，请稍后重试' : '网络连接失败，请稍后重试'; }

  function request(path, opt) {
    opt = opt || {};
    return g.API.token().then(function (token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return fetch(path, {
        method: opt.method || 'GET', headers: headers, body: opt.body
      }).then(function (res) {
        return res.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
          if (res.ok) return data;
          var detail = data && data.detail;
          var info = (detail && detail.error) || (data && data.error) || {};
          var error = new Error(info.message || ('HTTP ' + res.status));
          error.status = res.status;
          error.code = info.code || (res.status === 401 ? 'UNAUTHORIZED' : 'HTTP_' + res.status);
          throw error;
        });
      });
    });
  }

  function requireLogin() {
    if (isLoggedIn()) return true;
    U.toast('先登录，再保存正式申请');
    go('#/scan');
    return false;
  }

  function statusBadge(status) {
    var s = STATUS[status] || [status || '未知', ''];
    return '<span class="king-status ' + esc(status || '') + '">' + esc(s[0]) + '</span>';
  }

  function targetName(app) {
    if (!app) return '未选择';
    return app.mountainName || app.newName || app.pointCode || '未命名山头';
  }

  function intentCopy() {
    if (A.mode === 'new') {
      return {
        title: '申请结果：这座新山头的负责人',
        body: '审核通过前不会公开，也不会生成可用二维码。通过时一次性创建山头、点位、短链与留言板，并授予负责人身份。',
        tone: 'owner'
      };
    }
    var t = A.target;
    if (!t) return { title: '先选择一座已有山头', body: '平台会按现任负责人和山寨状态判定你这次是申请负责人还是加入山寨。', tone: 'neutral' };
    if (t.isOwner) {
      return {
        title: '你已经是负责人',
        body: '继续提交会作为资料更新申请进入审核台，不会重复创建第二个负责人。',
        tone: 'owner'
      };
    }
    if (t.ownerName && t.clanStatus === 'active') {
      return {
        title: '申请结果：加入「' + (t.clanName || '山寨') + '」',
        body: '负责人可以写接纳意见，但最终是否成为成员由平台审核；意见本身不会直接授权。',
        tone: 'join'
      };
    }
    if (t.ownerName) {
      return {
        title: '申请结果：加入意向',
        body: '这座山已有负责人但还没有成立山寨。现在留下的是加入意向，不会承诺已进入成员审核；山寨成立后会提醒你确认继续。',
        tone: 'wait'
      };
    }
    return {
      title: '申请结果：这座山头的负责人',
      body: '目前没有在任负责人。多人竞争时平台只能通过一位，其余申请人会先进入「待确认加入」，必须本人确认才继续。',
      tone: 'owner'
    };
  }

  function selectedHTML() {
    if (A.mode === 'new') {
      return '<div class="ka-selected new"><div class="ka-selected-main"><span class="ka-selected-icon">＋</span><div>' +
        '<b>申请一个新山头</b><p>名称、地区、准确位置和介绍在下方填写；审核通过前不公开。</p></div></div></div>';
    }
    if (!A.target) {
      return '<div class="ka-selected empty"><div class="ka-selected-main"><span class="ka-selected-icon">⌕</span><div>' +
        '<b>搜索全库山头</b><p>可以按山头名、地区或点位编号查找；列表不受首页只加载一部分的限制。</p></div></div></div>';
    }
    var t = A.target;
    return '<div class="ka-selected"><div class="ka-selected-main"><span class="ka-selected-icon">' +
      (t.pointType === 'junction' ? '↗' : '⛰') + '</span><div><b>' + esc(t.name || '名称待定') + '</b>' +
      '<p>' + esc(t.region || '地区待补') + (t.altitude ? ' · 海拔 ' + t.altitude + ' m' : '') +
      (t.pointCode ? ' · ' + esc(t.pointCode) : '') + '</p>' +
      '<p class="ka-owner-line">' + (t.ownerName ? '现任负责人：' + esc(t.ownerName) : '目前没有负责人') +
      (t.clanName ? ' · 山寨：' + esc(t.clanName) + '（' + esc(t.clanStatus === 'active' ? '已成立' : '待审核') + '）' : '') +
      '</p></div></div><button class="btn ghost mini" data-act="ka-clear-target">换一座</button></div>';
  }

  function intentHTML() {
    var copy = intentCopy();
    return '<div class="ka-intent ' + copy.tone + '"><span class="ka-intent-dot"></span><div>' +
      '<b>' + esc(copy.title) + '</b><p>' + esc(copy.body) + '</p></div></div>';
  }

  function appBanner() {
    if (!A.app) return '';
    var s = STATUS[A.app.status] || [A.app.status, ''];
    return '<div class="ka-app-banner ' + esc(A.app.status) + '"><div><b>当前申请：' + esc(s[0]) +
      '</b><p>' + esc(A.app.needsInfoNote || A.app.reviewNote || s[1]) + '</p></div>' +
      (A.app.status === 'draft' ? '<span>v' + (A.app.version || 1) + ' 已保存</span>' : '') + '</div>';
  }

  function applyShell() {
    var copy = intentCopy();
    return '<div class="king-apply-page">' +
      '<a class="king-back" href="#/places">‹ 回占山为王</a>' +
      '<header class="king-apply-head">' +
      '<span class="eyebrow">MOUNTAIN KEEPER</span>' +
      '<h1>把一座山，认真接过来</h1>' +
      '<p>不用猜自己是“山大王”还是“版主”。选好山头，写清楚为什么想做、以后怎么经营；平台审核后再授予权限。</p>' +
      '<div class="ka-steps"><span class="on">01 选山头</span><span>02 写申请</span><span>03 平台审核</span><span>04 开始管理</span></div>' +
      '</header>' +
      (!isLoggedIn() ? '<div class="ka-login-note"><div><b>正式填写前先登录</b><p>草稿和联系方式只跟你的账号绑定，其他普通用户看不到。</p></div>' +
        '<button class="btn coral mini" data-act="king-login">去登录</button></div>' : '') +
      appBanner() +
      '<section class="king-panel">' +
      '<div class="king-panel-head"><div><span class="king-step">01</span><h2>选择目标</h2></div>' +
      '<div class="ka-mode"><button class="' + (A.mode === 'existing' ? 'on' : '') + '" data-act="ka-mode" data-val="existing">已有山头</button>' +
      '<button class="' + (A.mode === 'new' ? 'on' : '') + '" data-act="ka-mode" data-val="new">申请新山头</button></div></div>' +
      '<div data-ka-existing style="display:' + (A.mode === 'existing' ? 'block' : 'none') + '">' +
      '<label class="ka-search"><span>' + U.icon('search') + '</span><input id="kaSearch" type="search" autocomplete="off" placeholder="搜索山头名、地区或编号，例如 妙峰山 / BJ-1041"></label>' +
      '<div id="kaResults" class="ka-results"><div class="ka-search-hint">输入关键词，从服务端全库搜索。</div></div>' +
      '</div>' +
      '<div data-ka-new style="display:' + (A.mode === 'new' ? 'block' : 'none') + '">' +
      '<div class="ka-new-grid">' +
      '<label class="ka-field"><span>新山头名称</span><input id="kaNewName" maxlength="80" placeholder="例如 老鹰嘴"></label>' +
      '<label class="ka-field"><span>类型</span><select id="kaNewType"><option value="peak"' + (A.type === 'peak' ? ' selected' : '') + '>山峰</option><option value="junction"' + (A.type === 'junction' ? ' selected' : '') + '>岔路口</option></select></label>' +
      '<label class="ka-field"><span>地区</span><input id="kaNewRegion" maxlength="80" placeholder="例如 北京 · 门头沟"></label>' +
      '<label class="ka-field"><span>准确位置</span><input id="kaNewLocation" maxlength="160" placeholder="例如 妙峰山镇涧沟村北侧山脊"></label>' +
      '<label class="ka-field"><span>海拔（选填，可从 GPX 提取）</span><input id="kaNewAltitude" type="number" min="0" max="9000" placeholder="例如 1180"></label>' +
      '<label class="ka-field"><span>GPX 轨迹（建议，审核真实性用）</span><input id="kaNewGpx" type="file" accept=".gpx,.xml,application/gpx+xml"><small id="kaGpxState">只保存文件引用与摘要，不把 GPX 公开。</small></label>' +
      '</div>' +
      '<label class="ka-field"><span>山头介绍</span><textarea id="kaNewIntro" maxlength="2000" placeholder="位置、地貌、常规上山方式；只写核实过的信息。"></textarea></label>' +
      '<button class="btn ghost mini" data-act="ka-locate">取当前坐标（选填）</button> ' +
      '<span class="ka-locate" id="kaLocateState">坐标只在审核时用于核对位置</span>' +
      '</div>' +
      '<div id="kaSelected">' + selectedHTML() + '</div>' +
      '<div id="kaIntent">' + intentHTML() + '</div>' +
      '</section>' +
      '<section class="king-panel">' +
      '<div class="king-panel-head"><div><span class="king-step">02</span><h2>写下你的计划</h2></div>' +
      '<span class="king-private">仅申请人与审核人可见</span></div>' +
      '<label class="ka-field big"><span>为什么想成为这个山头的负责人？<em>20–1000 字</em></span>' +
      '<textarea id="kaReason" class="ka-edit" maxlength="1000" placeholder="写你真实走过的路、熟悉的季节与路况，以及为什么愿意长期照看这里。"></textarea>' +
      '<small id="kaReasonCount">0 / 20 字</small></label>' +
      '<label class="ka-field big"><span>作为负责人，你有什么经营计划？<em>20–2000 字</em></span>' +
      '<textarea id="kaPlan" class="ka-edit" maxlength="2000" placeholder="例如：多久更新一次路况、如何核验留言、雨季标注哪些风险、怎样和成员分工。"></textarea>' +
      '<small id="kaPlanCount">0 / 20 字</small></label>' +
      '<div class="ka-two">' +
      '<label class="ka-field"><span>预计维护频率</span><select id="kaVisits" class="ka-edit">' +
      '<option value="1">1–2 次 / 月</option><option value="4" selected>3–5 次 / 月</option>' +
      '<option value="8">6–10 次 / 月</option><option value="12">10 次以上 / 月</option></select></label>' +
      '<label class="ka-field"><span>昵称</span><input id="kaNick" class="ka-edit" maxlength="80" placeholder="审核通过后展示的名字"></label>' +
      '</div>' +
      '<label class="ka-field"><span>联系方式（选填）<em>不会公开</em></span><input id="kaContact" class="ka-edit" maxlength="200" placeholder="微信号 / 手机 / 邮箱，仅在审核沟通时使用"></label>' +
      '<div id="kaError" class="ka-error"></div>' +
      '<div id="kaSaveState" class="ka-save-state">正式提交前会自动保存账号草稿；换设备登录后继续。</div>' +
      '<div class="king-actions"><button class="btn ghost" data-act="ka-save">保存草稿</button>' +
      '<button class="btn coral" data-act="ka-submit">提交申请<em class="btn-note">重复点击不会产生第二份申请</em></button></div>' +
      '</section>' +
      '<div class="king-footnote">联系方式只对申请人和有权审核人员可见。审核到期只会标为延迟，不会自动通过；新山头在通过前不公开。</div>' +
      '</div>';
  }

  function fillApplyForm() {
    var app = A.app;
    if (!app) return;
    function val(id, value) { var el = document.getElementById(id); if (el && value != null) el.value = value; }
    val('kaReason', app.reason && !/草稿占位/.test(app.reason) ? app.reason : '');
    val('kaPlan', app.expectations && !/草稿占位/.test(app.expectations) ? app.expectations : '');
    val('kaVisits', app.visitsPerMonth || 4);
    val('kaNick', app.nickname || '');
    val('kaContact', app.contact || '');
    val('kaNewName', app.newName || '');
    val('kaNewRegion', app.newRegion || '');
    val('kaNewLocation', app.newLocationText || '');
    val('kaNewAltitude', app.newAltitude || '');
    val('kaNewIntro', app.newIntro || '');
    A.mode = app.targetKind === 'new' ? 'new' : 'existing';
    A.type = app.newPointType || app.pointType || 'peak';
    if (app.targetKind === 'new') {
      A.target = null;
    } else {
      A.target = {
        mountainId: app.mountainId, name: app.mountainName, pointType: app.pointType,
        pointCode: app.pointCode, ownerName: app.ownerName, clanName: app.clanName,
        clanStatus: app.clanStatus, region: app.region, altitude: app.altitude
      };
    }
    A.gpxRef = app.newGpxRef || null;
    paintApply();
  }

  function paintApply() {
    if (!document.querySelector('.king-apply-page')) return;
    U.$$('.ka-mode button').forEach(function (b) {
      b.className = b.getAttribute('data-val') === A.mode ? 'on' : '';
    });
    var ex = document.querySelector('[data-ka-existing]');
    var nw = document.querySelector('[data-ka-new]');
    if (ex) ex.style.display = A.mode === 'existing' ? 'block' : 'none';
    if (nw) nw.style.display = A.mode === 'new' ? 'block' : 'none';
    var sel = document.getElementById('kaSelected');
    if (sel) sel.innerHTML = selectedHTML();
    var intent = document.getElementById('kaIntent');
    if (intent) intent.innerHTML = intentHTML();
    count('kaReason', 'kaReasonCount', 20);
    count('kaPlan', 'kaPlanCount', 20);
    var typeSel = document.getElementById('kaNewType');
    if (typeSel) typeSel.value = A.type;
    if (A.app && A.app.status !== 'draft' && A.app.status !== 'needs_info') {
      U.$$('.ka-edit').forEach(function (el) { el.disabled = true; });
      var submit = document.querySelector('[data-act="ka-submit"]');
      var save = document.querySelector('[data-act="ka-save"]');
      if (submit) submit.disabled = true;
      if (save) save.disabled = true;
    }
  }

  function count(inputId, hintId, need) {
    var input = document.getElementById(inputId);
    var hint = document.getElementById(hintId);
    if (!input || !hint) return;
    var n = input.value.trim().length;
    hint.textContent = n + ' / ' + need + ' 字' + (n >= need ? ' ✓' : '');
    hint.className = n >= need ? 'ok' : '';
  }

  function searchHTML(items) {
    if (!items.length) return '<div class="ka-search-hint">没有找到。可以换一个关键词，或直接申请新山头。</div>';
    return items.map(function (t) {
      return '<button class="ka-result" data-act="ka-pick" data-mid="' +
        (t.mountainId == null ? '' : t.mountainId) + '" data-code="' + esc(t.pointCode || '') + '">' +
        '<span class="ka-result-icon">' + (t.pointType === 'junction' ? '↗' : '⛰') + '</span>' +
        '<span><b>' + esc(t.name || '名称待定') + '</b><small>' + esc(t.region || '地区待补') +
        (t.altitude ? ' · ' + t.altitude + ' m' : '') + (t.pointCode ? ' · ' + esc(t.pointCode) : '') +
        '</small><em>' + (t.ownerName ? '负责人 ' + esc(t.ownerName) : '暂无负责人') +
        (t.clanName ? ' · ' + esc(t.clanName) : '') + '</em></span>' +
        '<span class="ka-result-go">›</span></button>';
    }).join('');
  }

  function localSearch(q) {
    var kw = (q || '').trim().toLowerCase();
    if (!kw) return [];
    var rows = [];
    (g.HIKES.points || []).forEach(function (p) {
      var hit = ((p.name || '') + ' ' + (p.code || '') + ' ' + (p.route_name || ''))
        .toLowerCase().indexOf(kw) >= 0;
      if (hit && p.status !== 'draft') {
        rows.push({
          mountainId: null, name: p.name || p.code, pointCode: p.code,
          pointId: p.id, pointType: p.type || 'peak', altitude: p.altitude,
          region: p.city || '', ownerName: null, clanName: null, clanStatus: null,
          intent: 'owner', localFallback: true
        });
      }
    });
    (g.HIKES.peaks || []).forEach(function (p) {
      var hit = ((p.name || '') + ' ' + (p.code || '') + ' ' + (p.trailName || '') + ' ' +
        (p.city || '')).toLowerCase().indexOf(kw) >= 0;
      if (hit && p.code) {
        rows.push({
          mountainId: null, name: p.name || p.code, pointCode: p.code,
          pointId: p.pointId, pointType: 'peak', altitude: p.alt,
          region: p.city || '', ownerName: null, clanName: null, clanStatus: null,
          intent: 'owner', localFallback: true
        });
      }
    });
    var seen = {};
    return rows.filter(function (r) {
      var key = r.pointCode || (r.name + ':' + r.pointId);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 20);
  }

  function doSearch(q) {
    var box = document.getElementById('kaResults');
    if (!box) return;
    if (!q.trim()) {
      A.results = [];
      box.innerHTML = '<div class="ka-search-hint">输入关键词，从服务端全库搜索。</div>';
      return;
    }
    box.innerHTML = '<div class="ka-search-hint">正在搜索…</div>';
    A.lastQuery = q.trim();
    function serverSearch() {
      return request('/api/mountains/search?q=' + encodeURIComponent(q.trim()) + '&limit=20');
    }
    serverSearch()
      .catch(function () {
        /* 服务重启/弱网时给一次短暂重试，之后退回本地已加载的点位。 */
        return new Promise(function (resolve) { setTimeout(resolve, 420); })
          .then(serverSearch);
      })
      .then(function (data) {
        A.results = (data && data.items) || [];
        if (document.getElementById('kaResults')) box.innerHTML = searchHTML(A.results);
      })
      .catch(function (error) {
        if (!document.getElementById('kaResults')) return;
        var local = localSearch(q);
        if (local.length) {
          A.results = local;
          box.innerHTML = '<div class="ka-search-hint">网络暂不可用，先用本地已加载结果；提交时会再由服务端核对。</div>' +
            searchHTML(local);
        } else {
          box.innerHTML = '<div class="ka-search-hint error">搜索失败：' + esc(errText(error)) +
            '</div><button class="btn ghost mini" data-act="ka-search-retry">重新搜索</button>';
        }
      });
  }

  function gather() {
    function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    var data = {
      targetKind: A.mode,
      reason: val('kaReason'),
      expectations: val('kaPlan'),
      visitsPerMonth: Number(val('kaVisits') || 4),
      nickname: val('kaNick') || null,
      contact: val('kaContact') || null
    };
    if (A.mode === 'existing') {
      if (A.target) data.mountainId = A.target.mountainId;
      if (A.selectedPointCode) data.pointCode = A.selectedPointCode;
    } else {
      data.newPointType = val('kaNewType') || A.type || 'peak';
      data.newName = val('kaNewName');
      data.newRegion = val('kaNewRegion');
      data.newLocationText = val('kaNewLocation');
      data.newAltitude = val('kaNewAltitude') ? Number(val('kaNewAltitude')) : null;
      data.newIntro = val('kaNewIntro') || null;
      data.newGpxRef = A.gpxRef;
    }
    var loc = document.getElementById('kaLocateState');
    if (loc && A.lat != null) { data.newLat = A.lat; data.newLng = A.lng; }
    return data;
  }

  function saveLocal() {
    try {
      localStorage.setItem('hikes.king.form', JSON.stringify({
        mode: A.mode, type: A.type, target: A.target, gpxRef: A.gpxRef,
        data: gather(), at: Date.now()
      }));
    } catch (e) { /* 隐身模式 */ }
  }

  function restoreLocal() {
    var raw = null;
    try { raw = localStorage.getItem('hikes.king.form'); } catch (e) { raw = null; }
    if (!raw) return false;
    var saved = null;
    try { saved = JSON.parse(raw); } catch (e) { return false; }
    if (!saved || !saved.data) return false;
    A.mode = saved.mode || 'existing';
    A.type = saved.type || 'peak';
    A.target = saved.target || null;
    A.gpxRef = saved.gpxRef || null;
    var d = saved.data;
    setTimeout(function () {
      function set(id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; }
      set('kaReason', d.reason); set('kaPlan', d.expectations);
      set('kaVisits', d.visitsPerMonth || 4); set('kaNick', d.nickname); set('kaContact', d.contact);
      set('kaNewName', d.newName); set('kaNewRegion', d.newRegion);
      set('kaNewLocation', d.newLocationText); set('kaNewAltitude', d.newAltitude);
      set('kaNewIntro', d.newIntro);
      paintApply();
    }, 0);
    return true;
  }

  function setError(message) {
    var box = document.getElementById('kaError');
    if (!box) { U.toast(message); return; }
    box.textContent = message || '';
    box.className = 'ka-error' + (message ? ' on' : '');
  }

  function saveDraft(silent) {
    if (!requireLogin()) return Promise.resolve(null);
    var data = gather();
    if (!data.mountainId && data.targetKind === 'existing') {
      if (!silent) setError('先选择一座已有山头，或切到「申请新山头」。');
      return Promise.resolve(null);
    }
    if (data.targetKind === 'new' && !data.newName) {
      if (!silent) setError('先填写新山头名称，才能保存草稿。');
      return Promise.resolve(null);
    }
    saveLocal();
    if (A.busy) return Promise.resolve(null);
    if (A.app && A.app.status !== 'draft') return Promise.resolve(A.app);
    A.busy = true;
    var isNew = !A.app;
    var path = isNew ? '/api/me/king-application-drafts' :
      '/api/me/king-application-drafts/' + A.app.id;
    if (!isNew) data.version = A.app.version;
    return request(path, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(data) })
      .then(function (app) {
        A.app = app;
        if (!isNew && A.app.version) {
          var url = '#/king/apply?draft=' + app.id;
          if (location.hash.indexOf('draft=') < 0) history.replaceState(null, '', url);
        }
        var state = document.getElementById('kaSaveState');
        if (state) state.textContent = '草稿已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        if (!silent) U.toast('草稿已保存');
        return app;
      })
      .catch(function (error) {
        if (error.status === 401) { requireLogin(); return null; }
        if (!silent) setError(errText(error));
        return null;
      })
      .then(function (app) { A.busy = false; return app; });
  }

  function scheduleDraft() {
    saveLocal();
    clearTimeout(A.autosaveTimer);
    if (!isLoggedIn()) return;
    A.autosaveTimer = setTimeout(function () { saveDraft(true); }, 1500);
  }

  function submitApplication() {
    if (!requireLogin()) return;
    clearTimeout(A.autosaveTimer);
    if (A.busy) {
      A.submitWait = (A.submitWait || 0) + 1;
      if (A.submitWait <= 8) {
        if (A.submitWait === 1) U.toast('草稿正在保存，马上提交');
        setTimeout(submitApplication, 450);
      } else {
        A.submitWait = 0;
        setError('保存还没完成，请检查网络后再试。');
      }
      return;
    }
    A.submitWait = 0;
    var data = gather();
    setError('');
    if (data.targetKind === 'existing' && !data.mountainId) {
      setError('先选择一座已有山头。'); return;
    }
    if (data.targetKind === 'new' && (!data.newName || !data.newRegion || !data.newLocationText)) {
      setError('新山头要填写名称、地区和准确位置。'); return;
    }
    if (data.reason.length < 20) { setError('「为什么想成为负责人」至少 20 字。'); return; }
    if (data.expectations.length < 20) { setError('经营计划至少 20 字。'); return; }
    if (A.busy) return;
    A.busy = true;
    var submit = document.querySelector('[data-act="ka-submit"]');
    if (submit) { submit.disabled = true; submit.textContent = '提交中…'; }
    if (A.app && A.app.id) data.id = A.app.id;
    request('/api/king-applications', { method: 'POST', body: JSON.stringify(data) })
      .then(function (app) {
        A.app = app;
        try { localStorage.removeItem('hikes.king.form'); } catch (e) { /* ignore */ }
        U.toast(app.status === 'waiting_clan' ? '已记录加入意向' : '申请已提交');
        go('#/king/application/' + app.id);
      })
      .catch(function (error) {
        if (error.status === 401) { requireLogin(); return; }
        setError(errText(error));
        if (submit) { submit.disabled = false; submit.innerHTML = '提交申请<em class="btn-note">重复点击不会产生第二份申请</em>'; }
      })
      .then(function () { A.busy = false; });
  }

  function loadApplicationIntoForm(id) {
    return request('/api/king-applications/' + id).then(function (app) {
      A.app = app; fillApplyForm(); saveLocal(); return app;
    }).catch(function (error) {
      setError(errText(error));
    });
  }

  function mountApply() {
    var q = query();
    var draftId = q.get('draft');
    var target = q.get('target');
    var type = q.get('type');
    if (type === 'junction') A.type = 'junction';
    if (draftId) {
      if (!A.app || String(A.app.id) !== String(draftId)) loadApplicationIntoForm(draftId);
    } else if (!A.app && !restoreLocal()) {
      saveLocal();
    }
    if (target) {
      request('/api/mountains/search?q=' + encodeURIComponent(target) + '&limit=10')
        .then(function (data) {
          var items = (data && data.items) || [];
          var hit = items.filter(function (t) { return t.pointCode === target; })[0] || items[0];
          if (hit) { A.target = hit; A.mode = 'existing'; A.selectedPointCode = hit.pointCode; paintApply(); }
        }).catch(function () { /* 搜索不到仍可手填新山 */ });
    }
    var search = document.getElementById('kaSearch');
    if (search) {
      search.addEventListener('input', function () {
        clearTimeout(A.searchTimer);
        var value = this.value;
        A.searchTimer = setTimeout(function () { doSearch(value); }, 260);
      });
    }
    U.$$('textarea.ka-edit, input.ka-edit, select.ka-edit').forEach(function (el) {
      el.addEventListener('input', scheduleDraft);
      el.addEventListener('change', scheduleDraft);
    });
    var gpx = document.getElementById('kaNewGpx');
    if (gpx) gpx.addEventListener('change', readGpx);
    count('kaReason', 'kaReasonCount', 20);
    count('kaPlan', 'kaPlanCount', 20);
  }

  function readGpx(event) {
    var file = event.target.files && event.target.files[0];
    var state = document.getElementById('kaGpxState');
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (state) state.textContent = 'GPX 超过 10MB，请先精简轨迹。';
      event.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var elevations = [];
      var re = /<ele[^>]*>\s*(-?\d+(?:\.\d+)?)\s*<\/ele>/gi;
      var m;
      while ((m = re.exec(text)) && elevations.length < 20000) elevations.push(Number(m[1]));
      if (elevations.length) {
        var max = Math.max.apply(null, elevations);
        var alt = document.getElementById('kaNewAltitude');
        if (alt && !alt.value) alt.value = Math.round(max);
      }
      function digest() {
        if (!(g.crypto && g.crypto.subtle)) return Promise.resolve('');
        var bytes = new TextEncoder().encode(String(reader.result || ''));
        return g.crypto.subtle.digest('SHA-256', bytes)
          .then(function (hash) {
            return Array.prototype.map.call(new Uint8Array(hash), function (b) {
              return ('0' + b.toString(16)).slice(-2);
            }).join('');
          }).catch(function () { return ''; });
      }
      digest().then(function (sha) {
        A.gpxRef = JSON.stringify({
          name: file.name, size: file.size, sha256: sha,
          elevationSamples: elevations.length,
          altitudeMax: elevations.length ? Math.round(Math.max.apply(null, elevations)) : null,
          referencedAt: new Date().toISOString()
        });
        if (state) state.textContent = '✓ ' + file.name + ' · ' + elevations.length + ' 个海拔采样已读取';
        scheduleDraft();
      });
    };
    reader.readAsText(file);
  }

  function applicationCard(a) {
    var s = STATUS[a.status] || [a.status, ''];
    return '<a class="king-app-card" href="#/king/application/' + a.id + '">' +
      '<div class="king-app-top">' + statusBadge(a.status) +
      '<span class="king-app-kind">' + (a.targetKind === 'new' ? '新山头' : a.intent === 'join' ? '加入山寨' : '已有山头') + '</span>' +
      (a.version ? '<span class="king-app-version">v' + a.version + '</span>' : '') + '</div>' +
      '<h3>' + esc(targetName(a)) + '</h3>' +
      '<p>' + esc(s[1]) + '</p>' +
      '<div class="king-app-meta"><span>' + esc((a.updatedAt || a.createdAt || '').slice(0, 10)) + '</span>' +
      '<span>' + (a.ownerName ? '负责人 ' + esc(a.ownerName) : '等待平台处理') + '</span><b>›</b></div></a>';
  }

  function applicationsShell() {
    return '<div class="king-apps-page"><a class="king-back" href="#/places">‹ 回占山为王</a>' +
      '<header class="king-simple-head"><span class="eyebrow">MY APPLICATIONS</span><h1>我的申请</h1>' +
      '<p>草稿、待审、需补充和已通过的申请都在这里；刷新或换设备登录后仍能继续。</p></header>' +
      '<div id="kingAppList" class="king-app-list"><div class="king-loading">正在读取申请…</div></div></div>';
  }

  function loadApplications() {
    var box = document.getElementById('kingAppList');
    if (!box) return;
    request('/api/me/king-applications').then(function (rows) {
      if (!rows || !rows.length) {
        box.innerHTML = '<div class="king-empty"><b>还没有申请</b><p>选一座想长期照看的山，写清为什么想做和准备怎么经营。</p>' +
          '<a class="btn coral" href="#/king/apply">开始统一申请</a></div>';
        return;
      }
      var active = rows.filter(function (a) { return ['draft', 'pending', 'needs_info', 'waiting_clan', 'pending_confirmation'].indexOf(a.status) >= 0; });
      var past = rows.filter(function (a) { return active.indexOf(a) < 0; });
      box.innerHTML = (active.length ? '<div class="king-list-label">进行中 · ' + active.length + '</div>' +
        active.map(applicationCard).join('') : '') +
        (past.length ? '<div class="king-list-label">已有结论 · ' + past.length + '</div>' + past.map(applicationCard).join('') : '');
    }).catch(function (error) {
      box.innerHTML = '<div class="king-empty"><b>申请读取失败</b><p>' + esc(errText(error)) + '</p>' +
        '<button class="btn ghost" data-act="king-retry-apps">重试</button></div>';
    });
  }

  function applicationShell(r) {
    return '<div class="king-detail-page" id="kingApplicationDetail" data-id="' + esc(r.id || '') + '">' +
      '<div class="king-loading">正在读取申请…</div></div>';
  }

  function timeline(a) {
    var steps = [
      ['提交', a.submittedAt || a.createdAt, true],
      ['平台处理', a.decidedAt || a.updatedAt, ['approved', 'rejected'].indexOf(a.status) >= 0],
      ['授权生效', a.status === 'approved' ? a.decidedAt : null, a.status === 'approved']
    ];
    return '<div class="king-timeline">' + steps.map(function (s) {
      return '<div class="' + (s[2] ? 'on' : '') + '"><i></i><b>' + s[0] + '</b><span>' +
        (s[1] ? esc(String(s[1]).slice(0, 10)) : '等待') + '</span></div>';
    }).join('') + '</div>';
  }

  function loadApplicationDetail(id) {
    var box = document.getElementById('kingApplicationDetail');
    if (!box) return;
    request('/api/king-applications/' + id).then(function (a) {
      var s = STATUS[a.status] || [a.status, ''];
      var canEdit = ['draft', 'needs_info', 'rejected', 'expired', 'withdrawn'].indexOf(a.status) >= 0;
      box.innerHTML = '<a class="king-back" href="#/king/applications">‹ 我的申请</a>' +
        '<header class="king-status-head">' + statusBadge(a.status) +
        (a.isDelayed ? '<span class="king-status needs_info">已延迟</span>' : '') +
        '<h1>' + esc(targetName(a)) + '</h1><p>' + esc(s[1]) +
        (a.isDelayed ? ' · 已超过 3 天处理目标，平台会继续处理；不会自动失效或通过。' : '') + '</p></header>' +
        timeline(a) +
        (a.reviewNote || a.needsInfoNote ? '<div class="king-review-note"><b>' +
          (a.status === 'needs_info' ? '需要补充' : '平台说明') + '</b><p>' +
          esc(a.needsInfoNote || a.reviewNote) + '</p></div>' : '') +
        (a.ownerOpinion ? '<div class="king-review-note"><b>负责人意见 · 仅供参考</b><p>' +
          esc(a.ownerOpinion) + '</p><small>负责人意见不会直接授予成员身份。</small></div>' : '') +
        '<section class="king-detail-block"><h2>这次申请</h2>' +
        '<dl class="king-dl">' +
        '<div><dt>目标</dt><dd>' + esc(a.targetKind === 'new' ? '新山头' : a.mountainName || a.pointCode) + '</dd></div>' +
        '<div><dt>意向</dt><dd>' + (a.intent === 'join' ? '加入山寨' : '成为负责人') + '</dd></div>' +
        '<div><dt>预计维护</dt><dd>' + a.visitsPerMonth + ' 次 / 月</dd></div>' +
        '<div><dt>昵称</dt><dd>' + esc(a.nickname || '未填写') + '</dd></div>' +
        (a.contact ? '<div><dt>联系方式</dt><dd>' + esc(a.contact) + ' <small>仅你与审核人可见</small></dd></div>' : '') +
        (a.pointCode && a.status === 'approved' ? '<div><dt>点位编号</dt><dd>' + esc(a.pointCode) + '</dd></div>' : '') +
        '</dl></section>' +
        '<section class="king-detail-block"><h2>为什么申请</h2><p class="king-long">' + esc(a.reason) + '</p></section>' +
        '<section class="king-detail-block"><h2>经营计划</h2><p class="king-long">' + esc(a.expectations) + '</p></section>' +
        '<div class="king-actions">' +
        (a.status === 'approved' ? '<a class="btn coral" href="#/me/managed' + (a.mountainId ? '/' + a.mountainId : '') + '">进入我管理的留言版</a>' : '') +
        (canEdit ? '<a class="btn ' + (a.status === 'needs_info' ? 'coral' : 'ghost') + '" href="#/king/apply?draft=' + a.id + '">' +
          (a.status === 'needs_info' ? '补充资料并重新提交' : '继续修改并提交') + '</a>' : '') +
        (a.status === 'pending_confirmation' ? '<button class="btn coral" data-act="km-confirm-join" data-id="' + a.id + '">我确认继续加入</button>' : '') +
        (['pending', 'needs_info', 'waiting_clan', 'pending_confirmation'].indexOf(a.status) >= 0 ?
          '<button class="btn ghost" data-act="km-withdraw" data-id="' + a.id + '">撤回申请</button>' : '') +
        '</div>';
    }).catch(function (error) {
      box.innerHTML = '<div class="king-empty"><b>申请读取失败</b><p>' + esc(errText(error)) + '</p>' +
        '<button class="btn ghost" data-act="king-retry-detail" data-id="' + esc(id) + '">重试</button></div>';
    });
  }

  function boardBlock() {
    return '<section class="managed-board-block" id="managedBoardBlock">' +
      '<div class="managed-board-head"><div><span class="eyebrow">MY BOARDS</span><h2>我管理的留言版</h2></div>' +
      '<a href="#/me/managed">全部管理 ›</a></div>' +
      '<div class="managed-board-body"><div class="king-loading">正在读取管理身份…</div></div></section>';
  }

  function noticesBlock() {
    return '<section class="king-notices" id="kingNotices" hidden></section>';
  }

  function loadNotices() {
    var box = document.getElementById('kingNotices');
    if (!box || !isLoggedIn()) return;
    request('/api/me/king-notifications?limit=8').then(function (rows) {
      if (!rows || !rows.length) return;
      box.hidden = false;
      box.innerHTML = '<div class="king-notices-head"><b>山头申请与协作</b>' +
        '<button data-act="king-read-notices">全部已读</button></div>' +
        rows.map(function (n) {
          return '<a class="king-notice' + (n.readAt ? '' : ' unread') + '" href="' + esc(n.link || '#/me') + '">' +
            '<span></span><div><b>' + esc(n.title) + '</b>' +
            (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
            '<small>' + esc(String(n.createdAt || '').slice(0, 16).replace('T', ' ')) + '</small></div></a>';
        }).join('');
    }).catch(function () { /* 通知失败不影响消息页主内容 */ });
  }

  function managedCompact(rows) {
    if (!rows || !rows.length) {
      return '<div class="managed-empty"><div><b>还没有获批的留言版</b><p>先提交统一申请；通过后无需退出重登，这里会直接出现管理卡。</p></div>' +
        '<a class="btn ghost mini" href="#/king/applications">看申请进度</a></div>';
    }
    return rows.map(function (b) {
      return '<a class="managed-board-card" href="#/me/managed/' + b.mountainId + '">' +
        '<span class="managed-role">' + (b.role === 'owner' ? '负责人' : '成员') + '</span>' +
        '<b>' + esc(b.mountainName || '名称待定') + '</b>' +
        '<small>' + esc(b.region || '') + (b.clanName ? ' · ' + esc(b.clanName) : '') + '</small>' +
        '<div><span>待处理留言 ' + b.pendingComments + '</span><span>申请提醒 ' + b.pendingApplications + '</span>' +
        (b.unread ? '<span class="hot">新留言 ' + b.unread + '</span>' : '') + '</div></a>';
    }).join('');
  }

  function loadManagedBlock() {
    var block = document.getElementById('managedBoardBlock');
    if (!block) return;
    var body = block.querySelector('.managed-board-body');
    if (!isLoggedIn()) {
      body.innerHTML = '<div class="managed-empty"><div><b>登录后查看管理身份</b><p>获批后管理卡会固定出现在留言版一级页面。</p></div>' +
        '<button class="btn ghost mini" data-act="king-login">去登录</button></div>';
      return;
    }
    request('/api/me/managed-boards').then(function (rows) {
      A.managed = rows;
      body.innerHTML = managedCompact(rows);
    }).catch(function () {
      body.innerHTML = '<div class="managed-empty"><div><b>管理身份暂时读不到</b><p>网络恢复后会重新读取。</p></div>' +
        '<button class="btn ghost mini" data-act="king-retry-managed">重试</button></div>';
    });
  }

  function loadKingProgress() {
    var box = document.getElementById('kingProgress');
    if (!box) return;
    if (!isLoggedIn()) {
      box.innerHTML = '<span>登录后查看你的申请进度</span><a href="#/king/apply">统一申请 ›</a>';
      return;
    }
    request('/api/me/king-applications').then(function (rows) {
      var active = (rows || []).filter(function (a) {
        return ['draft', 'pending', 'needs_info', 'waiting_clan', 'pending_confirmation'].indexOf(a.status) >= 0;
      })[0] || (rows || [])[0];
      if (!active) {
        box.innerHTML = '<span>还没有申请</span><a href="#/king/apply">开始申请 ›</a>';
      } else {
        box.innerHTML = '<span>' + statusBadge(active.status) + ' ' + esc(targetName(active)) + '</span>' +
          '<a href="#/king/application/' + active.id + '">继续 ›</a>';
      }
    }).catch(function () {
      box.innerHTML = '<span>申请进度暂时读不到</span><a href="#/king/applications">重试 ›</a>';
    });
  }

  function managedShell(r) {
    return '<div class="managed-page" id="managedRoot" data-id="' + esc(r.id || '') + '">' +
      '<div class="king-loading">正在读取留言版…</div></div>';
  }

  function loadManagedPage(id) {
    var root = document.getElementById('managedRoot');
    if (!root) return;
    if (!isLoggedIn()) {
      root.innerHTML = '<div class="king-empty"><b>先登录</b><p>管理权限与账号绑定，未登录不会显示任何管理数据。</p>' +
        '<button class="btn coral" data-act="king-login">去登录</button></div>';
      return;
    }
    if (!id) {
      if (A.managed) { renderManagedList(root, A.managed); return; }
      request('/api/me/managed-boards').then(function (rows) {
        A.managed = rows; renderManagedList(root, rows);
      }).catch(function (error) {
        root.innerHTML = '<div class="king-empty"><b>管理列表读取失败</b><p>' + esc(errText(error)) + '</p></div>';
      });
      return;
    }
    request('/api/me/managed-boards/' + id).then(function (d) {
      A.detail = d; renderManagedDetail(root, d);
    }).catch(function (error) {
      root.innerHTML = '<div class="king-empty"><b>没有管理权限</b><p>' + esc(errText(error)) + '</p>' +
        '<a class="btn ghost" href="#/me/managed">回我的留言版</a></div>';
    });
  }

  function renderManagedList(root, rows) {
    root.innerHTML = '<a class="king-back" href="#/board">‹ 回留言版</a>' +
      '<header class="king-simple-head"><span class="eyebrow">MY BOARDS</span><h1>我管理的留言版</h1>' +
      '<p>每个山头一块留言板；成员共享原有留言、二维码与打卡记录，不另建板。</p></header>' +
      (!rows.length ? '<div class="king-empty"><b>还没有获批的留言版</b><p>未获批时只显示空态和申请入口；通过后无需重新登录。</p>' +
        '<a class="btn coral" href="#/king/applications">查看申请进度</a></div>' :
        '<div class="managed-list">' + rows.map(function (b) {
          return '<a class="managed-card" href="#/me/managed/' + b.mountainId + '">' +
            '<div class="managed-card-top"><span class="managed-role">' + (b.role === 'owner' ? '负责人' : '成员') + '</span>' +
            '<span>' + (b.clanStatus === 'active' ? '山寨已成立' : b.clanStatus === 'pending' ? '山寨待审核' : '未组建山寨') + '</span></div>' +
            '<h3>' + esc(b.mountainName || '名称待定') + '</h3>' +
            '<p>' + esc(b.region || '地区待补') + (b.altitude ? ' · ' + b.altitude + ' m' : '') + '</p>' +
            '<div class="managed-stats"><div><b>' + b.pendingComments + '</b><span>待处理留言</span></div>' +
            '<div><b>' + b.pendingApplications + '</b><span>申请提醒</span></div>' +
            '<div><b>' + b.unread + '</b><span>新留言</span></div></div></a>';
        }).join('') + '</div>');
  }

  function renderManagedDetail(root, d) {
    var owner = d.role === 'owner';
    var apps = (d.applications || []).filter(function (a) {
      return ['pending', 'pending_confirmation', 'needs_info'].indexOf(a.status) >= 0;
    });
    root.innerHTML = '<a class="king-back" href="#/me/managed">‹ 我管理的留言版</a>' +
      '<header class="managed-detail-head"><div><span class="managed-role">' + (owner ? '负责人' : '成员') + '</span>' +
      '<h1>' + esc(d.mountainName || '名称待定') + '</h1><p>留言版 #' + (d.boardId || '—') +
      ' · ' + (d.points || []).length + ' 个公开点位</p></div>' +
      '<a class="btn ghost mini" href="#/peaks/p-' + esc((d.points[0] || {}).code || '') + '">看公开页</a></header>' +
      '<div class="managed-nav"><a href="#mg-overview">概览</a><a href="#mg-apps">申请</a><a href="#mg-clan">山寨</a><a href="#mg-hidden">隐藏</a><a href="#mg-audit">记录</a></div>' +
      '<section class="king-detail-block" id="mg-overview"><div class="king-block-head"><h2>概览</h2>' +
      '<span>' + (owner ? '你可以编辑介绍、发公告、提交广告素材' : '成员可发路况、公告、置顶与有理由隐藏，不能改他人原文') + '</span></div>' +
      '<div class="managed-kpis"><div><b>' + apps.length + '</b><span>待处理申请</span></div>' +
      '<div><b>' + (d.hidden || []).filter(function (c) { return c.status === 'flagged'; }).length + '</b><span>待核验留言</span></div>' +
      '<div><b>' + ((d.clan && d.clan.status === 'active') ? d.clan.members.length : 0) + '</b><span>山寨成员</span></div></div>' +
      '<label class="ka-field"><span>发布公告（会置顶到本山头留言板）</span><textarea id="kmNotice" maxlength="200" placeholder="例如：本周北坡结冰，请从南侧林道上山。"></textarea></label>' +
      '<button class="btn coral mini" data-act="km-notice" data-board="' + (d.boardId || '') + '">发布公告</button>' +
      (owner ? '<div class="managed-owner-tools"><h3>负责人操作</h3><p>核心坐标、合并山头、负责人移交和成员移除都由平台审批；前端按钮不能替代后端鉴权。</p>' +
        '<label class="ka-field"><span>移交给成员账号</span><input id="kmTransferUser" placeholder="接任人的账号用户名"></label>' +
        '<label class="ka-field"><span>移交说明（至少 20 字）</span><textarea id="kmTransferNote" maxlength="1000"></textarea></label>' +
        '<button class="btn ghost mini" data-act="km-transfer" data-mid="' + d.mountainId + '">提交移交申请</button></div>' : '') +
      '<details class="managed-suggestion"><summary>提交资料修改建议</summary>' +
      '<p>成员不能直接改他人原文；建议会交平台审核，核心坐标与山头合并也必须走平台。</p>' +
      '<label class="ka-field"><span>字段</span><select id="kmSuggestField">' +
      '<option value="intro">山头介绍</option><option value="guide">现场说明</option>' +
      '<option value="first_ascent">首登信息</option><option value="ascent_method">登顶方式</option></select></label>' +
      '<label class="ka-field"><span>建议内容</span><textarea id="kmSuggestValue" maxlength="2000"></textarea></label>' +
      '<label class="ka-field"><span>依据（至少 8 字）</span><input id="kmSuggestReason" maxlength="500" placeholder="例如：本周实地复核了旧标牌与岔路"></label>' +
      '<button class="btn ghost mini" data-act="km-suggest" data-point="' + ((d.points[0] || {}).id || '') + '">提交审核</button></details>' +
      '</section>' +
      '<section class="king-detail-block" id="mg-apps"><div class="king-block-head"><h2>加入申请</h2><span>负责人意见仅供参考，平台最终审核</span></div>' +
      (apps.length ? apps.map(function (a) {
        return '<div class="king-join-app"><div><b>' + esc(a.applicantName || '申请人') + '</b> ' + statusBadge(a.status) +
          '<p>' + esc(a.reason) + '</p><small>' + (a.intent === 'join' ? '加入山寨' : '申请负责人') + ' · ' +
          a.visitsPerMonth + ' 次 / 月</small></div>' +
          (owner ? '<div class="king-join-actions"><button class="btn ghost mini" data-act="km-opinion" data-id="' + a.id + '">写负责人意见</button>' +
            '<a class="btn ghost mini" href="#/king/application/' + a.id + '">看详情</a></div>' : '') + '</div>';
      }).join('') : '<div class="king-empty small"><b>没有待处理申请</b><p>新申请会显示在这里和留言版管理卡上。</p></div>') +
      '</section>' +
      '<section class="king-detail-block" id="mg-clan"><div class="king-block-head"><h2>山寨</h2>' +
      '<span>山寨共享原留言板和记录，不另建板</span></div>' + clanSection(d, owner) + '</section>' +
      '<section class="king-detail-block" id="mg-hidden"><div class="king-block-head"><h2>待处理与已隐藏</h2>' +
      '<span>原文保留，可申诉</span></div>' +
      ((d.hidden || []).length ? d.hidden.map(function (c) {
        return '<div class="managed-comment"><div><b>' + esc(c.nickname || '山友') + '</b><span>' +
          esc(c.status === 'hidden' ? '已隐藏' : '待核验') + (c.pinned ? ' · 置顶' : '') + '</span>' +
          '<p>' + esc(c.text) + '</p>' + (c.reason ? '<small>理由：' + esc(c.reason) + '</small>' : '') + '</div></div>';
      }).join('') : '<div class="king-empty small"><b>没有待处理留言</b><p>被隐藏的留言与理由会保留在这里。</p></div>') +
      '</section>' +
      '<section class="king-detail-block" id="mg-audit"><div class="king-block-head"><h2>操作记录</h2><span>每一次权限动作都可追溯</span></div>' +
      ((d.audit || []).length ? d.audit.map(function (a) {
        return '<div class="managed-audit"><b>' + esc(a.actor || '系统') + '</b><span>' + esc(a.action) + '</span>' +
          '<small>' + esc(String(a.createdAt || '').slice(0, 16).replace('T', ' ')) + '</small>' +
          (a.reason ? '<p>' + esc(a.reason) + '</p>' : '') + '</div>';
      }).join('') : '<div class="king-empty small"><b>还没有操作记录</b><p>审核、隐藏、公告与移交都会写入记录。</p></div>') +
      '</section>';
  }

  function clanSection(d, owner) {
    var clan = d.clan;
    if (!clan) {
      if (!owner) return '<div class="king-empty small"><b>还没有山寨</b><p>负责人提交组建申请并经平台审核后，成员才能加入。</p></div>';
      return '<div class="king-empty small"><b>还没有组建山寨</b><p>先写清名称、介绍、协作计划与招募要求，平台审核通过后才开放加入。</p></div>' +
        '<div class="ka-new-grid"><label class="ka-field"><span>山寨名称</span><input id="kmClanName" maxlength="40"></label>' +
        '<label class="ka-field"><span>招募要求</span><input id="kmClanReq" maxlength="1000" placeholder="希望成员能承担什么"></label></div>' +
        '<label class="ka-field"><span>山寨介绍（20–2000 字）</span><textarea id="kmClanIntro" maxlength="2000"></textarea></label>' +
        '<label class="ka-field"><span>协作计划（20–2000 字）</span><textarea id="kmClanPlan" maxlength="2000"></textarea></label>' +
        '<button class="btn coral mini" data-act="km-clan-create" data-mid="' + d.mountainId + '">提交组建申请</button>';
    }
    var members = clan.members || d.members || [];
    return '<div class="clan-head"><div><span class="king-status ' + (clan.status === 'active' ? 'approved' : 'pending') + '">' +
      (clan.status === 'active' ? '山寨已成立' : '待平台审核') + '</span><h3>' + esc(clan.name) + '</h3>' +
      '<p>' + esc(clan.intro) + '</p></div>' +
      (owner && clan.status === 'active' ? '<button class="btn ghost mini" data-act="km-recruit" data-clan="' + clan.id + '" data-on="' + (clan.recruiting ? '0' : '1') + '">' +
        (clan.recruiting ? '暂停招募' : '重新开放招募') + '</button>' : '') + '</div>' +
      '<div class="clan-members">' + members.map(function (m) {
        return '<div><span class="av a1">' + esc((m.nickname || '山')[0]) + '</span><b>' + esc(m.nickname || '山友') + '</b>' +
          '<small>' + (m.role === 'owner' ? '负责人' : '成员') + '</small>' +
          (owner && m.role === 'member' ? '<button class="clan-remove" data-act="km-remove" data-mid="' +
            d.mountainId + '" data-user="' + m.userId + '">申请移除</button>' : '') + '</div>';
      }).join('') + '</div>' +
      (clan.collaborationPlan ? '<details class="clan-plan"><summary>协作计划与招募要求</summary><p>' +
        esc(clan.collaborationPlan) + '</p><p><b>招募要求：</b>' + esc(clan.recruitRequirements) + '</p></details>' : '') +
      (!owner ? '<button class="btn ghost mini" data-act="km-leave" data-clan="' + clan.id + '">退出山寨</button>' : '');
  }

  function refreshManagedDetail() {
    var root = document.getElementById('managedRoot');
    if (!root) return;
    loadManagedPage(root.getAttribute('data-id') || null);
  }

  function handleAction(act, el, info) {
    if (act === 'king-login') { requireLogin(); return true; }
    if (act === 'king-retry-apps') { loadApplications(); return true; }
    if (act === 'king-retry-detail') { loadApplicationDetail(info.id); return true; }
    if (act === 'king-retry-managed') { loadManagedBlock(); return true; }
    if (act === 'king-read-notices') {
      request('/api/me/king-notifications/read', { method: 'POST', body: '{}' })
        .then(function () { loadNotices(); U.toast('已全部标记已读'); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'ka-mode') {
      A.mode = info.val === 'new' ? 'new' : 'existing';
      if (A.mode === 'existing' && A.target === null) A.selectedPointCode = null;
      paintApply(); scheduleDraft(); return true;
    }
    if (act === 'ka-pick') {
      var mid = Number(el.getAttribute('data-mid'));
      var code = el.getAttribute('data-code') || '';
      A.target = A.results.filter(function (t) {
        return (mid && Number(t.mountainId) === mid) ||
          (!mid && code && t.pointCode === code);
      })[0] || null;
      A.selectedPointCode = A.target && A.target.pointCode;
      A.mode = 'existing';
      A.results = [];
      var resultBox = document.getElementById('kaResults');
      var searchBox = document.getElementById('kaSearch');
      if (resultBox) resultBox.innerHTML = '<div class="ka-search-hint">已选中；要换一座时重新输入关键词。</div>';
      if (searchBox) searchBox.value = '';
      paintApply(); saveLocal(); return true;
    }
    if (act === 'ka-search-retry') {
      doSearch(A.lastQuery || '');
      return true;
    }
    if (act === 'ka-clear-target') {
      A.target = null; A.selectedPointCode = null; paintApply(); saveLocal(); return true;
    }
    if (act === 'ka-save') { saveDraft(false); return true; }
    if (act === 'ka-submit') { submitApplication(); return true; }
    if (act === 'ka-locate') {
      if (!navigator.geolocation) { U.toast('这个浏览器不支持定位'); return true; }
      var state = document.getElementById('kaLocateState');
      if (state) state.textContent = '正在取位置…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        A.lat = Number(pos.coords.latitude.toFixed(6));
        A.lng = Number(pos.coords.longitude.toFixed(6));
        if (state) state.textContent = '已取到 ' + A.lat + ', ' + A.lng + '（审核用，不公开）';
        scheduleDraft();
      }, function () {
        if (state) state.textContent = '取不到定位，可以只填文字位置';
      }, { enableHighAccuracy: true, timeout: 12000 });
      return true;
    }
    if (act === 'km-withdraw') {
      if (!confirm('确认撤回这份申请？撤回后可以重新提交。')) return true;
      request('/api/king-applications/' + info.id + '/withdraw', { method: 'POST', body: '{}' })
        .then(function () { U.toast('已撤回'); loadApplicationDetail(info.id); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-confirm-join') {
      request('/api/king-applications/' + info.id + '/confirm-join', { method: 'POST', body: '{}' })
        .then(function () { U.toast('已确认继续加入，等待平台审核'); loadApplicationDetail(info.id); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-notice') {
      var text = (document.getElementById('kmNotice') || {}).value || '';
      if (text.trim().length < 4) { U.toast('公告至少写 4 个字'); return true; }
      el.disabled = true;
      request('/api/boards/' + el.getAttribute('data-board') + '/notices', {
        method: 'POST', body: JSON.stringify({ text: text.trim() })
      }).then(function () { U.toast('公告已置顶'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); el.disabled = false; });
      return true;
    }
    if (act === 'km-clan-create') {
      var body = {
        name: (document.getElementById('kmClanName') || {}).value || '',
        intro: (document.getElementById('kmClanIntro') || {}).value || '',
        collaborationPlan: (document.getElementById('kmClanPlan') || {}).value || '',
        recruitRequirements: (document.getElementById('kmClanReq') || {}).value || ''
      };
      el.disabled = true;
      request('/api/mountains/' + el.getAttribute('data-mid') + '/clan-applications', {
        method: 'POST', body: JSON.stringify(body)
      }).then(function () { U.toast('山寨组建申请已提交'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); el.disabled = false; });
      return true;
    }
    if (act === 'km-recruit') {
      request('/api/clans/' + el.getAttribute('data-clan') + '/recruiting', {
        method: 'POST', body: JSON.stringify({ recruiting: el.getAttribute('data-on') === '1' })
      }).then(function () { U.toast('招募状态已更新'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-opinion') {
      var opinion = prompt('负责人意见（至少 8 字，会交给平台参考）');
      if (opinion == null) return true;
      if (opinion.trim().length < 8) { U.toast('请写至少 8 字'); return true; }
      request('/api/clan-join-applications/' + info.id + '/owner-opinion', {
        method: 'POST', body: JSON.stringify({ opinion: opinion.trim() })
      }).then(function () { U.toast('负责人意见已记录，最终仍由平台审核'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-leave') {
      if (!confirm('退出后会立即失去这个山头的管理权限；历史内容与二维码保留。')) return true;
      request('/api/clans/' + el.getAttribute('data-clan') + '/leave', { method: 'POST', body: '{}' })
        .then(function () { U.toast('已退出山寨'); go('#/me/managed'); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-transfer') {
      var user = (document.getElementById('kmTransferUser') || {}).value || '';
      var note = (document.getElementById('kmTransferNote') || {}).value || '';
      if (!user.trim()) { U.toast('请填写接任人的账号用户名'); return true; }
      request('/api/mountains/' + el.getAttribute('data-mid') + '/transfer-applications', {
        method: 'POST', body: JSON.stringify({ toUsername: user.trim(), note: note.trim() })
      }).then(function () { U.toast('移交申请已发出，接任人确认后交平台审核'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-suggest') {
      var pointId = el.getAttribute('data-point');
      var fieldName = (document.getElementById('kmSuggestField') || {}).value || '';
      var proposed = (document.getElementById('kmSuggestValue') || {}).value || '';
      var why = (document.getElementById('kmSuggestReason') || {}).value || '';
      if (!pointId) { U.toast('这块留言版没有可提交建议的点位'); return true; }
      request('/api/points/' + pointId + '/suggestions', {
        method: 'POST', body: JSON.stringify({
          field: fieldName, value: proposed.trim(), reason: why.trim()
        })
      }).then(function () { U.toast('修改建议已提交平台审核'); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    if (act === 'km-remove') {
      var whyRemove = prompt('移除理由（至少 8 字，平台会审核）');
      if (whyRemove == null) return true;
      if (whyRemove.trim().length < 8) { U.toast('请写至少 8 字'); return true; }
      request('/api/mountains/' + el.getAttribute('data-mid') + '/member-removal-applications', {
        method: 'POST', body: JSON.stringify({
          memberUserId: Number(el.getAttribute('data-user')),
          reason: whyRemove.trim()
        })
      }).then(function () { U.toast('移除申请已提交平台审核'); refreshManagedDetail(); })
        .catch(function (error) { U.toast(errText(error)); });
      return true;
    }
    return false;
  }

  function mount(r) {
    if (r.name === 'board') { loadManagedBlock(); return; }
    if (r.name === 'messages') { loadNotices(); return; }
    if (r.name === 'places') { loadKingProgress(); return; }
    if (r.name === 'king-apply') { mountApply(); return; }
    if (r.name === 'king-applications') { loadApplications(); return; }
    if (r.name === 'king-application' && r.id) { loadApplicationDetail(r.id); return; }
    if (r.name === 'me-managed') { loadManagedPage(r.id); return; }
  }

  function view(r) {
    if (r.name === 'king-apply') return applyShell();
    if (r.name === 'king-applications') return applicationsShell();
    if (r.name === 'king-application') return applicationShell(r);
    if (r.name === 'me-managed') return managedShell(r);
    return '<div class="king-loading">页面加载中…</div>';
  }

  g.KING_APP = {
    view: view, mount: mount, handleAction: handleAction, boardBlock: boardBlock,
    noticesBlock: noticesBlock,
    _state: A,
    reset: function () {
      A.app = null; A.target = null; A.results = []; A.mode = 'existing';
      A.type = 'peak'; A.gpxRef = null; A.lat = null; A.lng = null;
    }
  };
})(window);
