const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const difficulty = require(path.join(__dirname, '..', 'js', 'public-difficulty.js'));

test('missing V2 response selects the unchanged legacy fallback', () => {
  assert.equal(difficulty.normalizeResponse(null), null);
  assert.equal(difficulty.normalizeResponse(undefined), null);
});

test('direction URL state defaults safely and survives unrelated parameters', () => {
  assert.equal(difficulty.directionFromHash('#/trails/sanfeng?direction=sideways'), 'forward');
  assert.equal(
    difficulty.withDirection('#/trails/sanfeng?tab=comments&direction=forward', 'reverse'),
    '#/trails/sanfeng?tab=comments&direction=reverse'
  );
});

test('normalization removes internal scoring fields recursively from public segments', () => {
  const result = difficulty.normalizeResponse({
    direction: 'forward',
    publicationVersion: 7,
    segments: [{
      segmentId: 12,
      stableKey: 'physical-12',
      displayOrder: 1,
      forwardOrder: 1,
      reverseOrder: 3,
      fromKm: 0,
      toKm: 2.4,
      distanceKm: 2.4,
      ascentM: 380,
      descentM: 20,
      grade: { key: 'hard', label: '困难', internalScore: 53 },
      internalScore: 53,
      load: 461
    }]
  });

  assert.deepEqual(result.segments[0].grade, { key: 'hard', label: '困难' });
  assert.equal('internalScore' in result.segments[0], false);
  assert.equal('load' in result.segments[0], false);
});

test('normalization retains published point identity and named segment endpoints', () => {
  const start = { pointId: 1, stableKey: 'p1', name: '起点', pointType: 'start', forwardKm: 0, displayKm: 0 };
  const end = { pointId: 2, stableKey: 'p2', name: '萝芭地北尖', pointType: 'peak', forwardKm: 4.9, displayKm: 4.9 };
  const result = difficulty.normalizeResponse({
    direction: 'forward',
    points: [start, end],
    activeAlerts: [],
    segments: [{
      segmentId: 9, stableKey: 's1', displayOrder: 1, forwardOrder: 1, reverseOrder: 1,
      fromKm: 0, toKm: 4.9, trackFromKm: 0, trackToKm: 4.9, distanceKm: 4.9,
      ascentM: 971, descentM: 10, grade: { key: 'hard', label: '困难' },
      fromPoint: start, toPoint: end
    }]
  });
  assert.equal(result.points[1].name, '萝芭地北尖');
  assert.equal(result.segments[0].fromPoint.pointId, 1);
  assert.equal(result.segments[0].toPoint.pointId, 2);
});

test('route map profile and cards share clickable physical identities', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /routeSelection\s*=\s*\{/);
  assert.match(app, /data-act="route-point-select"/);
  assert.match(app, /data-route-point-id=/);
  assert.match(app, /data-physical-segment-id=/);
  assert.match(app, /route-point-selected/);
});

test('route feedback separates lasting terrain from temporary alerts', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /name="feedbackType"/);
  assert.match(app, /当前路线提醒/);
  assert.match(app, /activeAlerts/);
});

test('offline shell ships the V2 contract before cache version is released', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(sw, /\.\/js\/public-difficulty\.js/);
  assert.match(sw, /hikes-shell-v11-difficulty-v2/);
  assert.match(html, /public-difficulty\.js\?v=20261114v2/);
  assert.match(html, /app\.js\?v=20261114v2/);
  assert.doesNotMatch(html, /app\.js\?v=20261026n/);
});

test('map legend names segment difficulty and never reuses the slope legend', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /function trackLegend\(t\)/);
  assert.match(app, /function profileLegend\(t\)/);
  assert.match(app, /<b>分段难度<\/b>/);
  assert.match(app, /<b>底部色条＝分段难度<\/b>/);
  assert.match(app, /<b>折线颜色＝局部坡度<\/b>/);
});

test('public point labels fall back to nothing instead of 待命名', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // 地图与坡度图上的新版点位：没有确认名称就只画定位点，不写"待命名"
  assert.doesNotMatch(app, /esc\(point\.name \|\| '待命名'\)/);
  // 分段卡片端点没有名称时回退到里程，不写"未命名点"
  assert.doesNotMatch(app, /'未命名点'/);
  assert.match(app, /pointTypeLabel\(point\.pointType, data\.direction\)/);
});

test('profile bottom bar uses segment difficulty and forward display km once', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // 后端已按方向换算 fromKm/toKm，前端不能再减一次总里程
  assert.match(app, /var bx0 = L \+ s\.fromKm \/ routeKm/);
  assert.doesNotMatch(app, /routeKm - s\.toKm/);
  assert.match(app, /fill="' \+ window\.PUBLIC_DIFFICULTY\.colorForGrade\(s\.grade\.key\)/);
  assert.match(app, /if \(publicSegments\) return;/);
});

test('direction switch keeps the page on V2 and explains loading plus fallback', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /function publicDifficultyStatus\(t\)/);
  assert.match(app, /正在按/);
  assert.match(app, /重算分段难度…/);
  assert.match(app, /新版分段暂不可用/);
  // 切换时保留上一版数据、只标 pending，不再先把 difficultyV2 清空回退旧版
  assert.match(app, /currentTrail\.difficultyV2Pending = wantedDir;/);
  assert.doesNotMatch(app, /difficultyV2LoadingDirection/);
});

test('clicking a segment highlights map, profile interval and card together', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /onSegment = !!publicSegments && String\(routeSelection\.segmentId\)/);
  assert.match(app, /data-act="route-segment-select" data-physical-segment-id=/);
  assert.match(app, /onSegment = String\(routeSelection\.segmentId\) === String\(s\.segmentId\)/);
});

test('guests are asked to sign in before filling a terrain feedback form', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /if \(window\.API\.accountState !== 'authenticated'\) \{ sheetSignup\('feedback'\); return; \}/);
  assert.match(app, /feedback: '路况反馈要追溯到具体分段并进入审核队列/);
  assert.match(app, /不会立即改变公开难度/);
});

test('unpublished routes offer crowd confirmation instead of curator edit UI', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /function pointConfirmSection\(t\)/);
  assert.match(app, /data-act="point-confirm"/);
  assert.match(app, /帮忙核对这条线的峰谷/);
  assert.match(app, /不会因为投票直接改变公开内容/);
  // 管理员维护入口不放在公共 H5 里
  assert.doesNotMatch(app, /route-point-maintenance/);
});

test('V2 detail replaces duplicate legacy peak and segment sections', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /!t\.difficultyV2 && \(t\.peakList \|\| \[\]\)\.length/);
  // 移植到线上基线后，旧「分段路书」在三元的 else 分支里
  assert.match(app, /t\.difficultyV2\s*\?\s*publicSegmentCards\(t\) \+ routePointsSection\(t\)/);
  assert.match(app, /"sec-head"><h3>分段路书<\/h3>/);
});

test('temporary alerts show direction-aware display order instead of physical ids', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /function alertDisplayOrder\(alert\)/);
  assert.match(app, /segment \? segment\.displayOrder : alert\.segmentId/);
});
