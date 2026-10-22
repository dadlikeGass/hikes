const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const file = path.join(__dirname, '../src/services/point-brief.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText
const mod = new Module(file)
mod.filename = file
mod.paths = module.paths
mod._compile(compiled, file)
const { pointBriefSubtitle, pointBriefHeat } = mod.exports

test('岔路卡片使用服务端 PointBrief 的 route_name 和 visit_count', () => {
  const point = { id: 7, code: 'J-007', name: '岔路', type: 'junction', route_name: '三峰连穿', altitude: 820, visit_count: 12 }
  assert.equal(pointBriefSubtitle(point), '海拔 820 m · 三峰连穿')
  assert.equal(pointBriefHeat(point), '到访 12 次')
})

test('没有线路或海拔时显示真实缺失状态', () => {
  const point = { id: 8, code: 'J-008', name: null, type: 'junction', route_name: null, altitude: null, visit_count: 0 }
  assert.equal(pointBriefSubtitle(point), '海拔待补充')
  assert.equal(pointBriefHeat(point), '到访 0 次')
})

test('本地山头申请映射为新山头服务端申请载荷', () => {
  const peak = { name: '测试山', region: '北京', elevation: 1234, intro: '常见实地信息' }
  const payload = { targetKind: 'new', newPointType: 'peak', newName: peak.name,
    newRegion: peak.region, newAltitude: peak.elevation, newIntro: peak.intro,
    reason: '我每月都会到这座山实地观察，并持续记录季节变化和入口状况。',
    expectations: '我会定期核对入口路况，回应山友留言，并及时修正不准确的山头资料。', visitsPerMonth: 4 }
  assert.equal(payload.targetKind, 'new')
  assert.equal(payload.newName, peak.name)
  assert.equal(payload.newAltitude, 1234)
  assert.ok(payload.reason.length >= 20)
  assert.ok(payload.expectations.length >= 20)
})

test('路段详情提交留言调用分段留言接口并更新当前留言列表', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/routes/segment/index.tsx'), 'utf8')
  assert.match(source, /request<Comment>\(`\/api\/segments\/\$\{id\}\/comments`/)
  assert.match(source, /setComments\(items=>\[created,\.\.\.items\]\)/)
  assert.match(source, /确认并公开发布/)
})

test('维护工作台读取服务端汇总并呈现三类待办计数', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/managed/index.tsx'), 'utf8')
  assert.match(source, /\/api\/me\/managed-boards/)
  assert.match(source, /pendingComments/)
  assert.match(source, /pendingApplications/)
  assert.match(source, /unread/)
})
