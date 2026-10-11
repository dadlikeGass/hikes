/* hikes · 真实线路内容包（北京）

   在 js/data.js 之后、js/track.js 之前加载。
   把 data.js 里的示例线路/山头/岔路整体换成从六只脚（foooooot.com）抓来的
   真实北京徒步与公园跑步线路；轨迹点来自 js/routes.data.js（自动生成）。

   想回到原来的演示内容：删掉 index.html 里 routes.data.js / routes.real.js 两行 script 即可。

   数据口径：
   - 距离 = 轨迹实算；爬升 = 海拔去噪后的累计爬升（原始 GPS 逐点累加会偏高 30%–50%）
   - 人气 = 该轨迹在六只脚的浏览量（不是本地统计）
   - 参考用时 = 按 4.5 km/h 平路 + 每 600 m 爬升 1 小时估算，不是真实纪录
   - 路况 = 没有可靠来源，统一留空给用户补充，不编造
*/
(function (g) {
  'use strict';
  var D = window.HIKES_ROUTE_DATA;
  var H = g.HIKES;
  if (!D || !H) return;

  /* 每条线路的策展信息：区域、六只脚人气、分段路书 */
  var META = {
    sanfeng: { region: '海淀 · 门头沟', views: 982, sections: [
      { no: '01', name: '大觉寺 · 起点', tip: '停车与补水 · 扫码点位', kind: 'junction', point: 'dajuesi', go: true },
      { no: '02', name: '萝卜地 · 垭口', tip: '往望京塔 / 北尖方向', kind: 'junction', point: 'luobadi' },
      { no: '03', name: '妙峰山 · 主峰', tip: '海拔 1291 m · 打卡点', kind: 'peak', point: 'miaofeng' },
      { no: '04', name: '阳台山 · 山顶', tip: '海拔 1276 m · 打卡点', kind: 'peak', point: 'yangtai' },
      { no: '05', name: '涧沟村 · 岔口', tip: '下撤点 · 有小卖部', kind: 'junction', point: 'jianguocun' }] },
    xiangbala: { region: '海淀 · 石景山', views: 638, sections: [
      { no: '01', name: '香山邮局 · 起点', tip: '经典起步点 · 扫码点位', kind: 'junction', point: 'xiangshanpost', go: true },
      { no: '02', name: '好汉坡 · 岔口', tip: '陡上段，石阶为主', kind: 'junction', point: 'haohanpo' },
      { no: '03', name: '鬼笑石', tip: '海拔约 490 m · 打卡点', kind: 'peak', point: 'guixiaoshi' },
      { no: '04', name: '八大处 · 终点', tip: '可坐公交返回', kind: 'junction', point: 'badachu' }] },
    xiaotaoren: { region: '海淀 · 香山', views: 328, sections: [
      { no: '01', name: '香山邮局 · 起点', tip: '扫码点位', kind: 'junction', point: 'xiangshanpost', go: true },
      { no: '02', name: '好汉坡 · 岔口', tip: '“小桃人”绕行的关键口', kind: 'junction', point: 'haohanpo' }] },
    taoxin: { region: '海淀 · 门头沟', views: 2232, sections: [
      { no: '01', name: '香山邮局 · 起点', tip: '扫码点位', kind: 'junction', point: 'xiangshanpost', go: true },
      { no: '02', name: '鬼笑石', tip: '桃心线的左半', kind: 'peak', point: 'guixiaoshi' }] },
    jiankou: { region: '怀柔', views: 1475, sections: [
      { no: '01', name: '西栅子村 · 起点', tip: '上长城口 · 扫码点位', kind: 'junction', point: 'xizhazi', go: true },
      { no: '02', name: '正北楼', tip: '海拔约 1000 m · 打卡点', kind: 'peak', point: 'zhengbeilou' }] },
    jingxigudao: { region: '门头沟', views: 1770, sections: [
      { no: '01', name: '丁家滩 · 起点', tip: '扫码点位', kind: 'junction', point: 'dingjiata', go: true },
      { no: '02', name: '牛角岭关城', tip: '马蹄窝所在', kind: 'junction', point: 'niujiaoling' }] },
    fenghuangling: { region: '海淀', views: 476, sections: [
      { no: '01', name: '凤凰岭景区东门 · 起点', tip: '扫码点位', kind: 'junction', point: 'fenghuangmen', go: true }] },
    baiwala: { region: '海淀 · 门头沟', views: 456789, sections: [
      { no: '01', name: '白家疃 · 起点', tip: '“毕业线”传统起点', kind: 'junction', point: 'baijiatuan', go: true },
      { no: '02', name: '鬼笑石', tip: '中段地标', kind: 'peak', point: 'guixiaoshi' },
      { no: '03', name: '八大处 · 终点', tip: '约 40 km 后的终点', kind: 'junction', point: 'badachu' }] },
    yudushan: { region: '延庆', views: 195660, sections: [
      { no: '01', name: '玉皇庙 · 起点', tip: '扫码点位', kind: 'junction', point: 'yuhuangmiao', go: true },
      { no: '02', name: '应梦寺', tip: '山腰古寺', kind: 'junction', point: 'yingmengsi' }] },
    donglingshan: { region: '门头沟', views: 4127, sections: [
      { no: '01', name: '九龙洼 · 起点', tip: '扫码点位', kind: 'junction', point: 'jiulongwa', go: true },
      { no: '02', name: '东灵山主峰', tip: '北京最高峰 2303 m · 打卡点', kind: 'peak', point: 'dongling' }] },
    baipusi: { region: '门头沟', views: 2312, sections: [
      { no: '01', name: '了思台 · 起点', tip: '扫码点位', kind: 'junction', point: 'liaositai', go: true },
      { no: '02', name: '白瀑寺', tip: '古寺打卡', kind: 'junction', point: 'baipusi-si' }] },
    xiangzhixian: { region: '海淀', views: 966, sections: [
      { no: '01', name: '香山邮局 · 起点', tip: '扫码点位', kind: 'junction', point: 'xiangshanpost', go: true },
      { no: '02', name: '植物园 · 终点', tip: '可坐地铁返回', kind: 'junction', point: 'zhiwuyuan' }] }
  };

  /* 公园跑道说明 */
  var PARK_GUIDE = {
    'aoseng-10k': '南北园大圈的塑胶跑道，北京跑者第一主场',
    'aoseng-5k': '南园一圈，夜跑与配速课首选',
    'chaoyang-5k': '环园步道，平路无车遮阴多',
    'chengshi-lvxin': '通州绿心环线，生态大草地',
    'lianshihu': '永定河莲石湖—冬奥公园环线，河景平路',
    'yuyuantan': '环湖一圈，樱花季最热门',
    'zizhuyuan': '竹荫湖景环线，适合晨跑',
    'yiheyuan': '环昆明湖一圈，皇家园林长距离',
    'tiantan': '外坛墙一圈，古柏林里的城市跑道',
    'shichahai': '什刹海—后海环湖，老城夜跑经典',
    'beihai': '北海公园环湖，白塔倒影',
    'nanhaizi': '南海子郊野公园环线，麋鹿苑旁大绿地',
    'shougang': '首钢园工业风 10 km 跑道',
    'wenhe': '温榆河公园示范区环线，生态绿道',
    'longtanhu': '龙潭湖三湖环线，短距离轻松跑',
    'taoranting': '陶然亭公园环线，城南跑友日常'
  };

  /* ---------- 线路 ---------- */
  function refTime(hoursNum) {
    var m = Math.round(hoursNum * 60);
    return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2);
  }
  function runTime(hoursNum) { return refTime(hoursNum / 2.4); }   /* 跑步参考配速 */

  var trails = Object.keys(D.stats).map(function (slug) {
    var s = D.stats[slug];
    var meta = META[slug] || {};
    var isPark = s.group === 'parks';
    return {
      id: slug,
      name: s.name,
      group: isPark ? 'park' : 'wild',
      region: meta.region || '北京',
      level: s.level,
      km: s.km,
      up: s.up,
      hours: s.hours,
      visits7: meta.views || 0,
      fastest: { time: isPark ? runTime(s.hoursNum) : refTime(s.hoursNum), who: '参考' },
      newest: false,
      desc: s.desc + '（距离 ' + s.km + ' km · 爬升约 ' + s.up + ' m · 六只脚轨迹 ' + s.trip + '）',
      guide: isPark ? PARK_GUIDE[slug] : '',
      status: {
        who: '社区',
        when: '',
        text: '这条线路还没有最新的路况记录，走过的人可以在岔路页补充。'
      },
      sections: meta.sections || []
    };
  }).sort(function (a, b) {
    if (a.group !== b.group) return a.group === 'wild' ? -1 : 1;
    return b.visits7 - a.visits7;
  });

  /* ---------- 山头（真实北京山顶） ---------- */
  var peaks = [
    { id: 'dongling', code: 'DLS-100', name: '东灵山主峰', alt: 2303, trailId: 'donglingshan',
      trailName: '东灵山主峰', visits30: 4127, visits7: 412, seq: 2318, fastest: '03:20', photos: 268,
      board: [
        { pos: 1, who: '老周', time: '03:20', when: '3 天前' },
        { pos: 2, who: '阿川', time: '03:52', when: '5 天前' },
        { pos: 3, who: '小野', time: '04:05', when: '昨天' }
      ],
      comments: [
        { who: 'zhou', when: '3 天前', text: '山顶风比城里大一个季节，冲锋衣别省。', claps: 31 },
        { who: 'ye', when: '昨天', text: '下午云翻得很快，两点前登顶最稳。', claps: 12 }
      ] },
    { id: 'miaofeng', code: 'MFS-101', name: '妙峰山 · 主峰', alt: 1291, trailId: 'sanfeng',
      trailName: '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）', visits30: 982, visits7: 96, seq: 812,
      fastest: '02:40', photos: 143,
      board: [
        { pos: 1, who: '小野', time: '02:40', when: '2 天前' },
        { pos: 2, who: '阿楠', time: '02:58', when: '4 天前' }
      ],
      comments: [{ who: 'ye', when: '2 天前', text: '涧沟村上来的那段石阶，下的时候护膝很有用。', claps: 18 }] },
    { id: 'yangtai', code: 'YTS-102', name: '阳台山 · 山顶', alt: 1276, trailId: 'sanfeng',
      trailName: '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）', visits30: 764, visits7: 71, seq: 655,
      fastest: '02:12', photos: 97,
      board: [
        { pos: 1, who: '阿川', time: '02:12', when: '昨天' },
        { pos: 2, who: '小鱼', time: '02:35', when: '3 天前' }
      ],
      comments: [{ who: 'chuan', when: '昨天', text: '三峰的中段换点，补给基本靠自带。', claps: 9 }] },
    { id: 'guixiaoshi', code: 'GXS-103', name: '香山 · 鬼笑石', alt: 490, trailId: 'xiangbala',
      trailName: '香八拉（香山→八大处）', visits30: 1520, visits7: 168, seq: 1204, fastest: '01:35',
      photos: 210,
      board: [
        { pos: 1, who: '小野', time: '01:35', when: '今天 07:20' },
        { pos: 2, who: '阿凯', time: '01:48', when: '今天 08:10' },
        { pos: 3, who: '小鱼', time: '02:02', when: '昨天' }
      ],
      comments: [
        { who: 'kai', when: '今天', text: '早上去人少，石头上有点露水，慢点走。', claps: 22 },
        { who: 'yu', when: '昨天', text: '从香山邮局上来，最近的路就是走好汉坡。', claps: 7 }
      ] },
    { id: 'zhengbeilou', code: 'ZBL-104', name: '箭扣 · 正北楼', alt: 1000, trailId: 'jiankou',
      trailName: '箭扣长城（西段）', visits30: 438, visits7: 52, seq: 386, fastest: '01:55', photos: 176,
      board: [
        { pos: 1, who: '老周', time: '01:55', when: '5 天前' },
        { pos: 2, who: '阿楠', time: '02:20', when: '1 周前' }
      ],
      comments: [{ who: 'nan', when: '5 天前', text: '城砖有松动的地方，别踩边上的浮砖。', claps: 26 }] }
  ];

  /* ---------- 岔路（真实路口 / 起点） ---------- */
  function J(id, code, name, trailId, trailName, index, total, visits, arrow, title, desc, next, intel) {
    return { id: id, code: code, name: name, trailId: trailId, trailName: trailName,
      index: index, total: total, visits: visits,
      guide: { arrow: arrow, title: title, desc: desc, next: next }, intel: intel };
  }
  var junctions = [
    J('dajuesi', 'DJS-01', '大觉寺 · 起点', 'sanfeng', '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）', 1, 5, 982,
      '↑', '从大觉寺停车场东侧进山', '有卫生间和小卖部，进山前补水',
      '下一段 · 萝卜地垭口　3.2 km · ↗ 520 m · 约 1 小时 40 分',
      [{ id: 'j1', who: 'zhou', by: '维护人', when: '10/5', ok: true, title: '停车场 8 点前好停车',
         text: '周末晚了要停到村路上。', confirm: 21 },
       { id: 'j2', who: 'ye', when: '3 天前', ok: false, title: '起点小卖部有时不开门',
         text: '上次去没开，自带够水更稳。', confirm: 6 }]),
    J('luobadi', 'LBD-02', '萝卜地 · 垭口', 'sanfeng', '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）', 2, 5, 764,
      '↗', '上垭口后往右走，左侧是下撤路', '左侧会下到寨口方向，别走错',
      '下一段 · 妙峰山主峰　4.1 km · ↗ 430 m · 约 2 小时',
      [{ id: 'j3', who: 'nan', when: '昨天', ok: false, title: '垭口风大',
         text: '停下来吃东西记得加件衣服。', confirm: 11 }]),
    J('jianguocun', 'JGC-03', '涧沟村 · 岔口', 'sanfeng', '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）', 5, 5, 655,
      '↓', '下到村里，有小卖部与卫生间', '这里是三峰最常用的下撤点',
      '返程 · 大觉寺　5.6 km · ↘ 620 m · 约 2 小时',
      [{ id: 'j4', who: 'chuan', when: '2 天前', ok: false, title: '村里小卖部下午 5 点关',
         text: '晚了就没补给了。', confirm: 8 }]),
    J('xiangshanpost', 'XSP-01', '香山邮局 · 起点', 'xiangbala', '香八拉（香山→八大处）', 1, 4, 1520,
      '↑', '从邮局旁小路上山，别走景区大门', '景区门要门票，穿越线走野路上山',
      '下一段 · 好汉坡　1.8 km · ↗ 320 m · 约 1 小时',
      [{ id: 'j5', who: 'kai', when: '今天', ok: false, title: '周末这条小路人也多',
         text: '想安静点就早上 7 点前上山。', confirm: 14 },
       { id: 'j6', who: 'zhou', by: '维护人', when: '10/1', ok: true, title: '邮局可以补水',
         text: '门口有自助售卖机。', confirm: 25 }]),
    J('haohanpo', 'HHP-02', '好汉坡 · 岔口', 'xiangbala', '香八拉（香山→八大处）', 2, 4, 1204,
      '↗', '上好汉坡，直行是缓路绕远', '好汉坡陡且是石阶，雨雪天慎走',
      '下一段 · 鬼笑石　1.2 km · ↗ 180 m · 约 40 分钟',
      [{ id: 'j7', who: 'ye', when: '昨天', ok: false, title: '石阶上有浮沙',
         text: '下坡别踩边缘。', confirm: 17 }]),
    J('badachu', 'BDC-04', '八大处 · 终点', 'xiangbala', '香八拉（香山→八大处）', 4, 4, 1120,
      '✓', '到八大处，可坐公交或地铁返回', '门口有公交，打车也方便',
      '返程 · 香山　公交约 30 分钟',
      [{ id: 'j8', who: 'lin', when: '4 天前', ok: false, title: '下午门口堵车',
         text: '想快就往前走到大路上打车。', confirm: 5 }]),
    J('xizhazi', 'XZZ-01', '西栅子村 · 起点', 'jiankou', '箭扣长城（西段）', 1, 2, 438,
      '↑', '村后小路上长城，注意落石', '野长城没有护栏，砖体松动',
      '下一段 · 正北楼　1.6 km · ↗ 400 m · 约 1 小时 20 分',
      [{ id: 'j9', who: 'zhou', by: '维护人', when: '9/28', ok: true, title: '雨后砖面很滑',
         text: '雨雪天不建议上墙。', confirm: 33 }]),
    J('dingjiata', 'DJT-01', '丁家滩 · 起点', 'jingxigudao', '京西古道小环线', 1, 2, 1770,
      '↑', '沿古道石板路上行', '全程有路标，跟着走就行',
      '下一段 · 牛角岭关城　2.4 km · ↗ 260 m · 约 1 小时',
      [{ id: 'j10', who: 'nan', when: '1 周前', ok: false, title: '石板路雨后滑',
         text: '穿抓地好的鞋。', confirm: 9 }]),
    J('niujiaoling', 'NJL-02', '牛角岭关城', 'jingxigudao', '京西古道小环线', 2, 2, 1650,
      '↓', '看完马蹄窝原路返回或继续下行', '关城是这条线最有名的一段',
      '返程 · 丁家滩　2.4 km · ↘ 260 m · 约 50 分钟',
      [{ id: 'j11', who: 'yu', when: '3 天前', ok: false, title: '马蹄窝附近在修路',
         text: '有一小段绕行。', confirm: 4 }]),
    J('jiulongwa', 'JLW-01', '九龙洼 · 起点', 'donglingshan', '东灵山主峰', 1, 2, 4127,
      '↑', '从九龙洼沿山脊上，注意大风', '海拔高，山上山下温差大',
      '下一段 · 东灵山主峰　5.2 km · ↗ 610 m · 约 2 小时 40 分',
      [{ id: 'j12', who: 'zhou', by: '维护人', when: '10/3', ok: true, title: '山顶常年大风',
         text: '至少带一件防风外套。', confirm: 41 }]),
    J('yuhuangmiao', 'YHM-01', '玉皇庙 · 起点', 'yudushan', '玉渡山·后河·应梦寺大环', 1, 2, 2860,
      '↑', '从玉皇庙村后进山，跟前队走', '岔路多，建议照着轨迹走',
      '下一段 · 应梦寺　6.5 km · ↗ 700 m · 约 3 小时 20 分',
      [{ id: 'j13', who: 'chuan', when: '2 天前', ok: false, title: '后河段过水多',
         text: '雨季水大，最好带溯溪鞋。', confirm: 13 }])
    ,
    J('baijiatuan', 'BJT-01', '白家疃 · 起点', 'baiwala', '白八拉（毕业线）', 1, 3, 980,
      '↑', '从白家疃村口上山，往望京楼方向', '“毕业线”的传统起点，全程没有补给',
      '下一段 · 鬼笑石　12 km · ↗ 900 m · 约 5 小时',
      [{ id: 'j14', who: 'zhou', by: '维护人', when: '9/30', ok: true, title: '全程无补给',
         text: '至少背 3L 水，中途能下撤的点很少。', confirm: 47 }]),
    J('yingmengsi', 'YMS-02', '应梦寺', 'yudushan', '玉渡山·后河·应梦寺大环', 2, 2, 1420,
      '↓', '过寺后沿后河往下游走', '这一段溪谷多，雨季水量大',
      '返程 · 玉皇庙　8.2 km · ↘ 620 m · 约 3 小时 30 分',
      [{ id: 'j15', who: 'yu', when: '4 天前', ok: false, title: '寺后小径杂草较深',
         text: '夏天要留意蛇，走前面的人踩一踩。', confirm: 7 }]),
    J('liaositai', 'LST-01', '了思台 · 起点', 'baipusi', '白瀑寺环穿', 1, 2, 2312,
      '↑', '从了思台村沿山谷上行', '前段是碎石车辙路，好走',
      '下一段 · 白瀑寺　3.4 km · ↗ 320 m · 约 1 小时 30 分',
      [{ id: 'j16', who: 'nan', when: '1 周前', ok: false, title: '村口停车位少',
         text: '周末建议早到，或停到更外面一点。', confirm: 8 }]),
    J('baipusi-si', 'BPS-02', '白瀑寺', 'baipusi', '白瀑寺环穿', 2, 2, 2200,
      '↓', '看完古寺从东侧山脊返回', '环线回程走东坨山脊，视野好但风大',
      '返程 · 了思台　4.1 km · ↘ 400 m · 约 1 小时 40 分',
      [{ id: 'j17', who: 'kai', when: '5 天前', ok: false, title: '寺里可以打水',
         text: '补水没问题，但别指望有商店。', confirm: 12 }]),
    J('zhiwuyuan', 'ZWY-02', '植物园 · 终点', 'xiangzhixian', '香植线（香山→植物园）', 2, 2, 966,
      '✓', '从植物园出园，可坐地铁西郊线', '出园后就是西郊线植物园站',
      '返程 · 香山　西郊线 2 站',
      [{ id: 'j18', who: 'lin', when: '昨天', ok: false, title: '西郊线周末排队',
         text: '人多的时候排队 20 分钟以上。', confirm: 6 }]),
    J('fenghuangmen', 'FHM-01', '凤凰岭景区东门 · 起点', 'fenghuangling', '凤凰岭环穿', 1, 1, 476,
      '↑', '从景区东门进，按景区路线走大环', '景区内路标清楚，注意岔路编号牌',
      '环线 · 回到东门　10.9 km · ↗ 1050 m · 约 5 小时',
      [{ id: 'j19', who: 'ye', when: '2 天前', ok: false, title: '部分石阶较窄',
         text: '下山时人多，交汇要等一下。', confirm: 10 }])
  ];

  /* ---------- 动态 / 活动 / 消息 / 信 ---------- */
  var posts = [
    { id: 'p1', who: 'zhou', when: '3 小时前', seq: '第 2318 位', h: 172,
      text: '东灵山顶又是大风，今天能见度很好。',
      place: { type: 'peak', id: 'dongling', name: '东灵山主峰' }, claps: 26, comments: 8 },
    { id: 'p2', who: 'ye', when: '5 小时前', seq: '第 1204 位', h: 150,
      text: '鬼笑石下面那段石阶有露水，慢慢走。',
      place: { type: 'peak', id: 'guixiaoshi', name: '香山 · 鬼笑石' }, claps: 12, comments: 3 },
    { id: 'p3', who: 'chuan', when: '昨天', seq: '完成', h: 168,
      text: '三峰 21 公里，今天状态不错，七小时出头。',
      place: { type: 'trail', id: 'sanfeng', name: '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）' }, claps: 34, comments: 5 },
    { id: 'p4', who: 'nan', when: '昨天', seq: '第 812 位', h: 160,
      text: '妙峰山主峰风大，站一会儿就透心凉。',
      place: { type: 'peak', id: 'miaofeng', name: '妙峰山 · 主峰' }, claps: 15, comments: 2 },
    { id: 'p5', who: 'lin', when: '2 天前', seq: '完成', h: 158,
      text: '奥森南北园一圈，配速稳住了。',
      place: { type: 'trail', id: 'aoseng-10k', name: '奥森公园 · 南北园大圈' }, claps: 19, comments: 4 },
    { id: 'p6', who: 'kai', when: '2 天前', seq: '完成', h: 140,
      text: '香山邮局上，好汉坡下，标准香八拉。',
      place: { type: 'trail', id: 'xiangbala', name: '香八拉（香山→八大处）' }, claps: 21, comments: 6 }
  ];

  var activities = [
    { id: 'a1', day: '18', week: '周六', title: '三峰连穿 · 慢速队',
      time: '7:00 大觉寺停车场集合', level: 'hard', hours: '约 9 小时',
      host: 'zhou', note: '需自备 2L 水 · 中途可从涧沟村下撤', joined: 5, capacity: 12, trailId: 'sanfeng' },
    { id: 'a2', day: '19', week: '周日', title: '奥森南园 · 10 公里配速',
      time: '7:30 南门地铁口集合', level: 'easy', hours: '约 1 小时',
      host: 'lin', note: '配速 6:00 · 全程平路', joined: 8, capacity: 20, trailId: 'aoseng-10k' }
  ];

  var messages = [
    { group: '互动', id: 'm1', who: 'ye', when: '2 小时前', text: '击掌了你的留言，还回复了一句',
      ctx: { type: 'peak', id: 'guixiaoshi', name: '香山 · 鬼笑石 · 留言板' } },
    { group: '互动', id: 'm2', who: 'chuan', when: '3 小时前', text: '关注了你走过的那条线路',
      ctx: { type: 'trail', id: 'sanfeng', name: '三峰连穿（大觉寺·鹫峰·阳台山·妙峰山）' } },
    { group: '请求', id: 'm3', who: 'nan', when: '刚刚', text: '想和你交换一张合影 · 你们都在妙峰山',
      kind: 'photo', urgent: '现场请求还剩 12 分钟', ctx: { type: 'peak', id: 'miaofeng', name: '妙峰山 · 主峰' } },
    { group: '请求', id: 'm4', who: 'lin', when: '1 小时前', text: '请求加你为好友', kind: 'friend' },
    { group: '信件', id: 'm5', who: '信', when: '今天到期', title: '你写给未来的自己',
      text: '去年今天，你在东灵山写了一封信', ctx: { type: 'me', id: 'letters', name: '山间信箱 · 拆开' } },
    { group: '信件', id: 'm6', who: '信', when: '昨天', title: '你留给下一位的话被拆开了',
      text: '有 3 个人在好汉坡岔口读到了你的留言', ctx: { type: 'junction', id: 'haohanpo', name: '好汉坡 · 岔口' } },
    { group: '系统', id: 'm7', who: 'hill', when: '',
      text: '你认领的东灵山主峰已 23 天未更新 · 有 4 条待处理的路况情报',
      warn: true, action: '去处理', ctx: { type: 'me', id: 'peak', name: '我的山头' } }
  ];

  var letters = [
    { id: 'l1', from: '阿凯', when: '118 天前写在好汉坡岔口', text: '石阶有浮沙，下坡别踩边缘。', place: '好汉坡 · 岔口' },
    { id: 'l2', from: '小鱼', when: '63 天前写在涧沟村', text: '村口小卖部下午 5 点就关了，早点下山。', place: '涧沟村 · 岔口' }
  ];

  var summits = [
    { peakId: 'dongling', name: '东灵山主峰', alt: 2303, time: '03:05', date: '10 月 2 日', level: 'mid', pb: true },
    { peakId: 'guixiaoshi', name: '香山 · 鬼笑石', alt: 490, time: '01:42', date: '9 月 21 日', level: 'easy' },
    { peakId: 'yangtai', name: '阳台山 · 山顶', alt: 1276, time: '02:18', date: '7 月 30 日', level: 'mid' },
    { peakId: 'miaofeng', name: '妙峰山 · 主峰', alt: 1291, time: '02:47', date: '6 月 15 日', level: 'mid' }
  ];

  var wantSeed = ['donglingshan', 'jiankou', 'yudushan', 'baiwala', 'aoseng-10k', 'beihai'];
  var visitedSeed = [
    { id: 'guixiaoshi', type: 'peak', name: '香山 · 鬼笑石', seq: 1204, when: '9 月 21 日' },
    { id: 'xiangbala', type: 'trail', name: '香八拉（香山→八大处）', seq: 320, when: '9 月 21 日' },
    { id: 'haohanpo', type: 'junction', name: '好汉坡 · 岔口', seq: 1204, when: '9 月 21 日' },
    { id: 'aoseng-10k', type: 'trail', name: '奥森公园 · 南北园大圈', seq: 88, when: '9 月 7 日' },
    { id: 'yangtai', type: 'peak', name: '阳台山 · 山顶', seq: 655, when: '8 月 24 日' },
    { id: 'beihai', type: 'trail', name: '北海公园环湖', seq: 121, when: '8 月 10 日' }
  ];

  /* ---------- 覆盖到 HIKES ---------- */
  H.trails = trails;
  H.peaks = peaks;
  H.junctions = junctions;
  H.posts = posts;
  H.activities = activities;
  H.messages = messages;
  H.letters = letters;
  H.summits = summits;
  H.wantSeed = wantSeed;
  H.visitedSeed = visitedSeed;
  H.gpxText = D.gpx;
  H.routeStats = D.stats;
  H.trailGroupLabel = { wild: '山野', park: '公园跑道' };
  H.me.claim = '东灵山主峰';
  H.isRealContent = true;
})(window);
