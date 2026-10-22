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

function loadModule(relativePath) {
  const moduleFile = path.join(__dirname, relativePath)
  const output = ts.transpileModule(fs.readFileSync(moduleFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
  }).outputText
  const loaded = new Module(moduleFile)
  loaded.filename = moduleFile
  loaded.paths = module.paths
  loaded._compile(output, moduleFile)
  return loaded.exports
}

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

test('本地山头申请构造服务端要求的准确位置和新山头字段', () => {
  const { buildMountainApplication } = loadModule('../src/services/mountain-application.ts')
  const payload = buildMountainApplication({
    mountain: null,
    localPeak: { name: '测试山', region: '北京', elevation: 1234, intro: '常见实地信息' },
    locationText: '北京市门头沟区测试山主峰，东经 115.5 北纬 40.1',
    reason: '我每月都会到这座山实地观察，并持续记录季节变化和入口状况。',
    expectations: '我会定期核对入口路况，回应山友留言，并及时修正不准确的山头资料。',
    visitsPerMonth: 4
  })
  assert.equal(payload.targetKind, 'new')
  assert.equal(payload.newName, '测试山')
  assert.equal(payload.newAltitude, 1234)
  assert.equal(payload.newLocationText, '北京市门头沟区测试山主峰，东经 115.5 北纬 40.1')
})

test('路段留言发布器发送分段 ID 和留言正文到服务端契约', async () => {
  const { createSegmentComment } = loadModule('../src/services/segment-comments.ts')
  let call
  const expectedResponse = { id: 52, text: '北坡有积雪', created_at: '2026-10-22T00:00:00Z' }
  const response = await createSegmentComment(17, '北坡有积雪', async (...args) => {
    call = args
    return expectedResponse
  })
  assert.equal(call[0], '/api/segments/17/comments')
  assert.deepEqual(call[1], { method: 'POST', data: { text: '北坡有积雪' } })
  assert.equal(response, expectedResponse)
})

test('维护工作台按服务端 camelCase 响应读取待办数字', () => {
  const { managedBoardCounts } = loadModule('../src/services/managed-boards.ts')
  const response = { mountainId: 12, mountainName: '测试山', region: '北京', role: 'owner',
    pendingComments: 3, hiddenComments: 1, pendingApplications: 2, joinApplications: 1,
    unread: 7, pointCodes: ['P-12'], leadPointId: 120 }
  assert.deepEqual(managedBoardCounts(response), [
    { label: '待核验留言', value: 3 },
    { label: '待办申请', value: 2 },
    { label: '新留言', value: 7 }
  ])
})

test('浏览山头使用 tabBar 专用 switchTab 导航', () => {
  const { openPlacesTab } = loadModule('../src/services/tab-navigation.ts')
  let destination
  openPlacesTab(options => { destination = options })
  assert.deepEqual(destination, { url: '/pages/places/index' })
})

test('默认 API 地址指向配置确认的 FastAPI /api 根路径', () => {
  const { DEFAULT_API_ORIGIN, resolveApiOrigin } = loadModule('../src/services/api-origin.ts')
  assert.equal(DEFAULT_API_ORIGIN, 'https://www.fotowa.fun/api')
  assert.equal(resolveApiOrigin(undefined), '')
  assert.equal(resolveApiOrigin('https://api.example.com/'), 'https://api.example.com')
})

test('API 根地址已含 /api 时不会把接口路径重复拼成 /api/api', () => {
  const { joinApiUrl } = loadModule('../src/services/api-origin.ts')
  assert.equal(joinApiUrl('https://www.fotowa.fun/api', '/api/routes'), 'https://www.fotowa.fun/api/routes')
  assert.equal(joinApiUrl('https://www.fotowa.fun/api/', '/api/events'), 'https://www.fotowa.fun/api/events')
  assert.equal(joinApiUrl('https://www.fotowa.fun', '/api/guest'), 'https://www.fotowa.fun/api/guest')
})
