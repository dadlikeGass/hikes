const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const difficulty = require(path.join(__dirname, '..', 'js', 'public-difficulty.js'));

test('public difficulty exposes exactly seven labels', () => {
  assert.deepEqual(difficulty.LABELS, ['一般', '一般+', '中等', '中等+', '困难', '困难+', '极度困难']);
});

test('direction is read from and written to the route URL', () => {
  assert.equal(difficulty.directionFromHash('#/trails/sanfeng?direction=reverse'), 'reverse');
  assert.equal(difficulty.directionFromHash('#/trails/sanfeng'), 'forward');
  assert.equal(difficulty.withDirection('#/trails/sanfeng?foo=1', 'reverse'), '#/trails/sanfeng?foo=1&direction=reverse');
  assert.equal(difficulty.withDirection('#/trails/sanfeng?direction=reverse', 'forward'), '#/trails/sanfeng?direction=forward');
});

test('normalization keeps only the published display contract', () => {
  const normalized = difficulty.normalizeResponse({ direction: 'reverse', publicationVersion: 3, segments: [{
    segmentId: 9, stableKey: 'seg_x', displayOrder: 1, forwardOrder: 5, reverseOrder: 1,
    fromKm: 14.96, toKm: 21.09, distanceKm: 6.13, ascentM: 949, descentM: 76,
    grade: { key: 'moderate_plus', label: '中等+' }, terrainTags: ['碎石'], internalScore: 51
  }] });
  assert.equal(normalized.direction, 'reverse');
  assert.equal(normalized.segments[0].grade.label, '中等+');
  assert.equal('internalScore' in normalized.segments[0], false);
});

test('H5 loads V2 independently and retains legacy fallback', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(api, /loadSegmentDifficulties/);
  assert.match(app, /difficultyV2Error/);
  assert.match(app, /apiSegTable\(t\)/);
  assert.match(app, /data-act="route-direction"/);
  assert.match(app, /public-segment-card/);
  // 切换方向时不再先清空数据（清空会让页面闪回旧坡度分段），只在失败时回退旧版
  assert.match(app, /currentTrail\.difficultyV2Pending = wantedDir;[\s\S]*?loadSegmentDifficulties/);
  assert.match(app, /currentTrail\.difficultyV2 = null;[\s\S]*?currentTrail\.difficultyV2Error = true;/);
  assert.match(app, /difficultyV2\.direction === 'reverse' \? t\.down : t\.up/);
  assert.doesNotMatch(html, /route-sanfeng\.js/);
  assert.doesNotMatch(api, /difficultyPreview=1|previewSanfengTrail/);
});

test('public H5 does not present a route aggregate grade or numeric score', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /线路公共难度|routeSummary/);
  assert.doesNotMatch(app, /内部难度分|internalScore/);
});

test('terrain feedback captures facts and physical segment identity only', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /name="surface"/);
  assert.match(app, /data-segment-id/);
  assert.match(app, /data-direction/);
  assert.doesNotMatch(app, /name="(?:grade|shift|score)"/);
});
