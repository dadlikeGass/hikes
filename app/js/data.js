/* hikes · 示例数据（全部为演示内容，非真实记录） */
(function (g) {
  var PEOPLE = {
    chuan: { id: 'chuan', name: '阿川', av: '川', tone: 'a1' },
    yu:    { id: 'yu',    name: '小鱼', av: '鱼', tone: 'a2' },
    zhou:  { id: 'zhou',  name: '老周', av: '周', tone: 'a4' },
    nan:   { id: 'nan',   name: '阿楠', av: '楠', tone: 'a4' },
    kai:   { id: 'kai',   name: '阿凯', av: '凯', tone: 'a2' },
    ye:    { id: 'ye',    name: '小野', av: '野', tone: 'a5' },
    lin:   { id: 'lin',   name: '小林', av: '林', tone: 'a3' },
    me:    { id: 'me',    name: '阿甘', av: '我', tone: 'a1' }
  };

  var LEVELS = {
    easy: { key: 'easy', shape: 'circle',   glyph: '●', label: '● 简单', short: '简单', en: 'Easy',      tip: '缓坡林道，2–3 小时，适合第一次上山' },
    mid:  { key: 'mid',  shape: 'triangle', glyph: '▲', label: '▲ 中等', short: '中等', en: 'Moderate',  tip: '持续爬升或较长距离，需要一定体力' },
    hard: { key: 'hard', shape: 'diamond',  glyph: '◆', label: '◆ 困难', short: '困难', en: 'Strenuous', tip: '长距离或复杂地形，建议结伴并预留整日' },
    hidden: { key: 'hidden', shape: 'hexagon', glyph: '⬢', label: '⬢ 隐藏', short: '隐藏', en: 'Exposed',
      tip: '需要绳索、冰爪等保护措施，只在具备技术条件时开放' }
  };

  var TRAILS = [
    { id: 'xigu', name: '溪谷森林步道', level: 'easy', km: 5.2, up: 180, hours: '约 2 小时',
      visits7: 214, fastest: { time: '01:12', who: '小野' }, newest: false,
      desc: '林荫缓坡，沿途有溪谷平台，适合轻量出行与第一次上山。',
      status: { who: '老周', when: '9 月 28 日', text: '林道口补给点开放，溪谷段有倒木已清理。' },
      sections: [
        { no: '01', name: '起点 · 停车场东侧标牌', tip: '扫码点位 #1 · 有卫生间与补水', kind: 'junction', point: 'qsd01', go: true },
        { no: '02', name: '林道岔口', tip: '左转上山，别走右边的作业道', kind: 'junction', point: 'qsd02' },
        { no: '03', name: '溪谷平台', tip: '午餐点 · 石阶结露时慢行', kind: 'junction', point: 'qsd03' },
        { no: '04', name: '终点 · 观景平台', tip: '扫码点位 #5 · 日落 18:24', kind: 'junction', point: 'qsd05' }
      ] },
    { id: 'qingshan-ridge', name: '青山山脊环线', level: 'mid', km: 12, up: 800, hours: '约 5 小时',
      visits7: 96, fastest: { time: '03:28', who: '阿川' }, newest: false,
      desc: '山脊与石阶交替，持续爬升，途中经过青山顶。',
      status: { who: '阿楠', when: '10 月 8 日', text: '山脊段风大，石阶有青苔，建议登山鞋。' },
      sections: [
        { no: '01', name: '起点 · 村口石阶', tip: '扫码点位 #1', kind: 'junction', point: 'qsd11', go: true },
        { no: '02', name: '山脊三岔口', tip: '向右上山脊，直行是下撤路', kind: 'junction', point: 'qsd12' },
        { no: '03', name: '青山顶', tip: '扫码点位 #3 · 打卡点', kind: 'peak', point: 'qingshan' },
        { no: '04', name: '终点 · 观景平台', tip: '扫码点位 #4 · 日落 18:24', kind: 'junction', point: 'qsd14' }
      ] },
    { id: 'qunfeng', name: '群峰长线穿越', level: 'hard', km: 24, up: 1700, hours: '约 11 小时 / 需两天',
      visits7: 31, fastest: { time: '07:05', who: '老周' }, newest: false,
      desc: '长距离穿越，需过夜与补给规划，复杂地形。',
      status: { who: '老周', when: '10 月 2 日', text: '第二营地水源不稳定，建议背 3L 以上。' },
      sections: [
        { no: '01', name: '起点 · 林场检查站', tip: '扫码点位 #1', kind: 'junction', point: 'qsd21', go: true },
        { no: '02', name: '北壁碎石坡', tip: '横切时保持间距', kind: 'junction', point: 'qsd22' },
        { no: '03', name: '鹰嘴崖', tip: '扫码点位 #3 · 打卡点', kind: 'peak', point: 'yingzui' }
      ] },
    { id: 'songlin', name: '松林环湖小径', level: 'easy', km: 3.8, up: 90, hours: '约 1.5 小时',
      visits7: 168, fastest: { time: '00:52', who: '小林' }, newest: true,
      desc: '环湖平路，全程有树荫，推车与带娃都可行。',
      status: { who: '小林', when: '10 月 9 日', text: '湖边栏杆有一段松动，注意孩子。' },
      sections: [{ no: '01', name: '起点 · 湖堤入口', tip: '扫码点位 #1', kind: 'junction', point: 'qsd31', go: true }] },
    { id: 'wangchun', name: '望春台短坡', level: 'mid', km: 6.1, up: 320, hours: '约 2.5 小时',
      visits7: 142, fastest: { time: '01:20', who: '阿楠' }, newest: false,
      desc: '短距离但坡度集中，山顶视野开阔，日落很好。',
      status: { who: '阿楠', when: '10 月 5 日', text: '顶部平台加固完成，可正常使用。' },
      sections: [
        { no: '01', name: '起点 · 村道尽头', tip: '扫码点位 #1', kind: 'junction', point: 'qsd41', go: true },
        { no: '02', name: '望春台', tip: '扫码点位 #2 · 打卡点', kind: 'peak', point: 'wangchun' }
      ] },
    { id: 'beibi', name: '北壁碎石坡', level: 'hidden', km: 14, up: 1250, hours: '约 7 小时',
      visits7: 22, fastest: { time: '04:10', who: '老周' }, newest: false,
      desc: '碎石与陡坡为主，顶部需要手脚并用，冬季建议冰爪与头盔。',
      status: { who: '老周', when: '9 月 30 日', text: '雨后碎石松动，顶部结冰需要冰爪，务必结伴。' },
      sections: [{ no: '01', name: '起点 · 采石场路口', tip: '扫码点位 #1', kind: 'junction', point: 'qsd51', go: true }] },
    { id: 'yunhai', name: '云海观景台环线', level: 'mid', km: 9.4, up: 520, hours: '约 4 小时',
      visits7: 77, fastest: { time: '02:35', who: '小野' }, newest: true,
      desc: '环线可看云海，清晨出发概率最高。',
      status: { who: '小野', when: '10 月 7 日', text: '观景台木板更换完成。' },
      sections: [
        { no: '01', name: '起点 · 云海路口', tip: '扫码点位 #1', kind: 'junction', point: 'qsd61', go: true },
        { no: '02', name: '云海台', tip: '扫码点位 #2 · 打卡点', kind: 'peak', point: 'yunhai' }
      ] },
    { id: 'guyidao', name: '古驿道石板路', level: 'easy', km: 7.6, up: 260, hours: '约 3 小时',
      visits7: 121, fastest: { time: '01:58', who: '阿凯' }, newest: true,
      desc: '沿古驿道石板缓行，历史标牌与歇脚亭多。',
      status: { who: '阿凯', when: '10 月 6 日', text: '第三座歇脚亭屋瓦修补完成。' },
      sections: [{ no: '01', name: '起点 · 古驿道牌坊', tip: '扫码点位 #1', kind: 'junction', point: 'qsd71', go: true }] }
  ];

  var PEAKS = [
    { id: 'qingshan', name: '青山顶', alt: 1660, trailId: 'qingshan-ridge', trailName: '青山山脊环线',
      visits30: 486, visits7: 132, seq: 100, fastest: '01:12', photos: 214,
      board: [
        { pos: 1, who: '小野', time: '01:12', when: '今天 08:26' },
        { pos: 2, who: '阿楠', time: '01:28', when: '今天 09:03' },
        { pos: 3, who: '阿川', time: '01:36', when: '今天 07:41' },
        { pos: 4, who: '小鱼', time: '01:51', when: '今天 09:24' },
        { pos: 5, who: '阿凯', time: '02:04', when: '昨天 16:10' }
      ],
      comments: [
        { who: 'chuan', when: '3 小时前', text: '第 100 位登顶打卡的人，是我！', claps: 26 },
        { who: 'yu', when: '昨天', text: '第一次一个人上山，有点怕，但真的好看。', claps: 12 },
        { who: 'kai', when: '昨天', text: '一个人来，遇到超棒的伙伴，一起看了日出。', claps: 17 }
      ] },
    { id: 'wangchun', name: '望春台', alt: 1240, trailId: 'wangchun', trailName: '望春台短坡',
      visits30: 312, visits7: 88, seq: 64, fastest: '00:58', photos: 96,
      board: [
        { pos: 1, who: '小林', time: '00:58', when: '今天 07:10' },
        { pos: 2, who: '阿楠', time: '01:20', when: '今天 08:02' },
        { pos: 3, who: '阿凯', time: '01:33', when: '昨天 17:20' }
      ],
      comments: [{ who: 'nan', when: '5 小时前', text: '日落从右手边落，等一会儿很值。', claps: 8 }] },
    { id: 'yingzui', name: '鹰嘴崖', alt: 1880, trailId: 'qunfeng', trailName: '群峰长线穿越',
      visits30: 205, visits7: 41, seq: 41, fastest: '02:31', photos: 63,
      board: [
        { pos: 1, who: '老周', time: '02:31', when: '3 天前' },
        { pos: 2, who: '小野', time: '02:48', when: '5 天前' }
      ],
      comments: [{ who: 'zhou', when: '3 天前', text: '崖边风大，拍照别退太靠后。', claps: 21 }] },
    { id: 'baishi', name: '白石尖', alt: 1420, trailId: 'yunhai', trailName: '云海观景台环线',
      visits30: 168, visits7: 52, seq: 28, fastest: '01:47', photos: 41,
      board: [{ pos: 1, who: '小野', time: '01:47', when: '4 天前' }, { pos: 2, who: '小鱼', time: '02:12', when: '6 天前' }],
      comments: [{ who: 'ye', when: '4 天前', text: '白石头在下午会反光，很好找路。', claps: 6 }] },
    { id: 'yunhai', name: '云海台', alt: 1520, trailId: 'yunhai', trailName: '云海观景台环线',
      visits30: 143, visits7: 47, seq: 19, fastest: '02:05', photos: 88,
      board: [{ pos: 1, who: '小鱼', time: '02:05', when: '2 天前' }, { pos: 2, who: '阿川', time: '02:22', when: '昨天' }],
      comments: [{ who: 'yu', when: '2 天前', text: '五点半到，云刚好散开。', claps: 14 }] }
  ];

  var JUNCTIONS = [
    { id: 'qsd02', code: 'QSD-02', name: '林道岔口', trailId: 'xigu', trailName: '溪谷森林步道',
      index: 2, total: 5, visits: 176,
      guide: { arrow: '↰', title: '左转上山，别跟右边那条宽路',
        desc: '右侧是林场作业道，走进去会绕远 2 公里',
        next: '下一段 · 溪谷平台　1.8 km · ↗ 160 m · 约 40 分钟' },
      intel: [
        { id: 'i1', who: 'zhou', by: '维护人', when: '9/28', ok: true, title: '左转上山，右侧是作业道',
          text: '路口有蓝色标牌，跟着标牌走。', confirm: 12 },
        { id: 'i2', who: 'kai', when: '昨天', ok: false, title: '石阶有青苔，雨后很滑',
          text: '建议走左侧土路，或者踩点走。', confirm: 3 },
        { id: 'i3', who: 'yu', when: '2 小时前', ok: false, title: '岔口往上 200 m 有水源',
          text: '水流不大，可以补给，但建议先过滤。', confirm: 1 }
      ] },
    { id: 'qsd01', code: 'QSD-01', name: '起点 · 停车场东侧标牌', trailId: 'xigu', trailName: '溪谷森林步道',
      index: 1, total: 5, visits: 214,
      guide: { arrow: '↑', title: '穿过停车场，从东侧木栈道进山',
        desc: '入口有蓝色标牌与垃圾桶，栈道走到底就是林道',
        next: '下一段 · 林道岔口　2.4 km · ↗ 60 m · 约 45 分钟' },
      intel: [
        { id: 'i4', who: 'zhou', by: '维护人', when: '9/28', ok: true, title: '补给点开放',
          text: '停车场小卖部今天有水和简餐。', confirm: 8 },
        { id: 'i5', who: 'lin', when: '3 天前', ok: false, title: '停车位紧张',
          text: '周末早上 8 点后基本满了，建议早到。', confirm: 5 }
      ] },
    { id: 'qsd03', code: 'QSD-03', name: '溪谷平台', trailId: 'xigu', trailName: '溪谷森林步道',
      index: 3, total: 5, visits: 158,
      guide: { arrow: '→', title: '沿溪流右岸上行，穿过石桥',
        desc: '平台可以午餐，石桥后开始持续爬升',
        next: '下一段 · 终点观景平台　1.2 km · ↗ 90 m · 约 30 分钟' },
      intel: [
        { id: 'i6', who: 'yu', when: '2 小时前', ok: false, title: '石桥栏杆有一段松动',
          text: '靠内侧走，别倚栏杆。', confirm: 4 }
      ] },
    { id: 'qsd05', code: 'QSD-05', name: '终点 · 观景平台', trailId: 'xigu', trailName: '溪谷森林步道',
      index: 5, total: 5, visits: 198,
      guide: { arrow: '✓', title: '你到终点了，这里是最后一个扫码点位',
        desc: '原路返回或者从东侧林道下山，全程 2.6 km',
        next: '返程 · 停车场　2.6 km · ↘ 180 m · 约 50 分钟' },
      intel: [
        { id: 'i7', who: 'kai', when: '昨天', ok: false, title: '平台护栏外有一处塌方',
          text: '拍照不要越过护栏。', confirm: 7 }
      ] },
    { id: 'qsd12', code: 'QSD-12', name: '山脊三岔口', trailId: 'qingshan-ridge', trailName: '青山山脊环线',
      index: 2, total: 4, visits: 104,
      guide: { arrow: '↗', title: '向右上山脊，直行是下撤路',
        desc: '直行会下到谷底村道，想登顶必须右转',
        next: '下一段 · 青山顶　3.4 km · ↗ 620 m · 约 2 小时 20 分' },
      intel: [
        { id: 'i8', who: 'nan', when: '昨天', ok: false, title: '路标被风吹倒',
          text: '原本的蓝色路标倒在右边草丛里。', confirm: 6 },
        { id: 'i9', who: 'zhou', by: '维护人', when: '10/2', ok: true, title: '右转上山脊，方向没错',
          text: '路标预计本周重装。', confirm: 9 }
      ] }
  ];

  var POSTS = [
    { id: 'p1', who: 'chuan', when: '3 小时前', seq: '第 100 位', h: 172,
      text: '登顶打卡第 100 位，是我！', place: { type: 'peak', id: 'qingshan', name: '青山顶' }, claps: 26, comments: 8 },
    { id: 'p2', who: 'nan', when: '5 小时前', h: 128,
      text: '山脊上风大，石阶结露，慢慢走。', place: { type: 'trail', id: 'qingshan-ridge', name: '青山山脊环线' }, claps: 9, comments: 2 },
    { id: 'p3', who: 'yu', when: '2 小时前', h: 150,
      text: '第一次一个人上山，有点怕，但真的好看。', place: { type: 'trail', id: 'xigu', name: '溪谷森林步道' }, claps: 12, comments: 3 },
    { id: 'p4', who: 'kai', when: '昨天', h: 140,
      text: '一个人来，遇到超棒的伙伴，一起看了日出。', place: { type: 'peak', id: 'qingshan', name: '青山顶' }, claps: 17, comments: 4 },
    { id: 'p5', who: 'ye', when: '昨天', h: 120,
      text: '云海台五点半到的，云刚好散开。', place: { type: 'peak', id: 'yunhai', name: '云海台' }, claps: 21, comments: 6 },
    { id: 'p6', who: 'lin', when: '2 天前', h: 158,
      text: '带娃走完松林环湖，全程无坡，推车可行。', place: { type: 'trail', id: 'songlin', name: '松林环湖小径' }, claps: 14, comments: 5 }
  ];

  var ACTIVITIES = [
    { id: 'a1', day: '18', week: '周六', title: '溪谷步道 · 慢速队',
      time: '6:30 北门停车场集合', level: 'easy', hours: '约 3 小时',
      host: 'zhou', note: '可带新手 · 全程慢走不走散', joined: 5, capacity: 12, trailId: 'xigu' },
    { id: 'a2', day: '19', week: '周日', title: '青山山脊 · 中速队',
      time: '7:00 村口石阶集合', level: 'mid', hours: '约 5 小时',
      host: 'chuan', note: '需自备 1.5L 水 · 有石阶', joined: 3, capacity: 8, trailId: 'qingshan-ridge' }
  ];

  var MESSAGES = [
    { group: '互动', id: 'm1', who: 'yu', when: '2 小时前', text: '击掌了你的留言，还回复了一句',
      ctx: { type: 'peak', id: 'qingshan', name: '青山顶 · 留言板' } },
    { group: '互动', id: 'm2', who: 'chuan', when: '3 小时前', text: '关注了你走过的那条线路',
      ctx: { type: 'trail', id: 'xigu', name: '溪谷森林步道' } },
    { group: '请求', id: 'm3', who: 'nan', when: '刚刚', text: '想和你交换一张合影 · 你们都在青山顶',
      kind: 'photo', urgent: '现场请求还剩 12 分钟', ctx: { type: 'peak', id: 'qingshan', name: '青山顶' } },
    { group: '请求', id: 'm4', who: 'lin', when: '1 小时前', text: '请求加你为好友', kind: 'friend' },
    { group: '信件', id: 'm5', who: '信', when: '今天到期', title: '你写给未来的自己', text: '去年今天，你在青山顶写了一封信',
      ctx: { type: 'me', id: 'letters', name: '山间信箱 · 拆开' } },
    { group: '信件', id: 'm6', who: '信', when: '昨天', title: '你留给下一位的话被拆开了', text: '有 3 个人在溪谷岔口读到了你的留言',
      ctx: { type: 'junction', id: 'qsd02', name: '林道岔口' } },
    { group: '系统', id: 'm7', who: 'hill', when: '', text: '你认领的青山顶已 23 天未更新 · 有 4 条待处理的路况情报',
      warn: true, action: '去处理', ctx: { type: 'me', id: 'peak', name: '我的山头' } }
  ];

  var LETTERS = [
    { id: 'l1', from: '阿凯', when: '118 天前写在林道岔口', text: '右边那条不是路，别硬走。', place: '林道岔口' },
    { id: 'l2', from: '小鱼', when: '63 天前写在溪谷平台', text: '上面风大，记得带件外套。', place: '溪谷平台' }
  ];

  /* 想去 / 收藏：真实来源是服务端的 wants 表（api.js 灌进 S.want）。
    以前这里塞了 8 个 mock 线路 id，接口数据进来后全都对不上，页面就是空的。 */
  var WANT_SEED = [];
  var VISITED_SEED = [
    { id: 'xigu', type: 'trail', name: '溪谷森林步道', seq: 128, when: '9 月 21 日' },
    { id: 'qingshan', type: 'peak', name: '青山顶', seq: 100, when: '9 月 21 日' },
    { id: 'songlin', type: 'trail', name: '松林环湖小径', seq: 88, when: '9 月 7 日' },
    { id: 'qsd02', type: 'junction', name: '林道岔口', seq: 176, when: '9 月 21 日' },
    { id: 'wangchun', type: 'peak', name: '望春台', seq: 64, when: '8 月 24 日' },
    { id: 'guyidao', type: 'trail', name: '古驿道石板路', seq: 121, when: '8 月 10 日' }
  ];

  var PEOPLES = [
    { id: 'ye', name: '小野', pb: '01:12', visits: 46, tone: 'a5' },
    { id: 'nan', name: '阿楠', pb: '01:28', visits: 31, tone: 'a4' },
    { id: 'chuan', name: '阿川', pb: '01:36', visits: 28, tone: 'a1' },
    { id: 'yu', name: '小鱼', pb: '01:51', visits: 9, tone: 'a2' },
    { id: 'zhou', name: '老周', pb: '07:05', visits: 112, tone: 'a4' }
  ];

  /* 单段难度：只看两个数字，取高的那一档。线条本身标的就是"某一段难不难"，
     所以描述里不许再提总距离、总爬升——那是线路级的事，见 ROUTE_FACTORS。 */
  var DIFFICULTY_DOC = [
    { key: 'easy', title: '简单 · 蓝色圆形', body: '这一段爬升不超过 200 m，坡度不陡于 15%。缓坡林道、环湖路，路面明确，全程不用手。' },
    { key: 'mid', title: '中等 · 黄色三角形', body: '这一段爬升 200–500 m，或者坡度 15–25%。有持续爬升，需要体力和登山鞋，通常要留一上午。' },
    { key: 'hard', title: '困难 · 深红色菱形', body: '这一段爬升超过 500 m，或者坡度超过 25%。又陡又长，碎石、窄径、少树，建议结伴并留足时间。' },
    { key: 'hidden', title: '隐藏 · 黑色六边形', body: '出现需要绳索、冰爪或头盔的路段就归这一档——不是"更难"，而是"需要技术准备、需要人确认"。自动判定给不出这一档，只能由维护人设定。' }
  ];

  /* 线路综合难度：一个颜色装不下，要这几项一起看。
     单段难度是机器算的，综合难度是维护人判的——这两层必须分开讲。 */
  var ROUTE_FACTORS = [
    { key: 'time',   label: '平均完成时间',   hint: '大部队走完要多久。4 小时和 10 小时是两种运动。' },
    { key: 'peak',   label: '登顶难度',       hint: '取全线路最难的那一段，不是平均——最难的那一段决定你走不走得完。' },
    { key: 'dist',   label: '距离与累计爬升', hint: '决定要不要预留整日、要不要补给规划、膝盖扛不扛得住。' },
    { key: 'ground', label: '路况',           hint: '碎石、湿滑、塌方、灌木、岔路多易迷路，都会单独加分。' },
    { key: 'tech',   label: '技术动作',       hint: '要不要手脚并用、要不要绳索冰爪。这一项一旦有，整条线路都要另做说明。' }
  ];

  /* 难度的判定依据：维护人需要提供的三项信息 */
  var GRADE_INPUTS = [
    { key: 'ratio', label: '单段爬升 / 距离比', hint: '例如 180 m / km。数值越大，坡越陡、越窄。' },
    { key: 'terrain', label: '地形方式', hint: '简单徒步 / 需要手脚并用 / 需要保护措施' },
    { key: 'length', label: '总距离与累计爬升', hint: '决定是否需要预留整日、是否需要补给规划' }
  ];
  var TERRAINS = [
    { key: 'walk',      label: '简单徒步',     suggest: 'easy',   note: '全程有明确路面，不用手' },
    { key: 'handsfree', label: '需要手脚并用', suggest: 'mid',    note: '部分路段要扶岩壁或抓树根' },
    { key: 'pro',       label: '需要保护措施', suggest: 'hidden', note: '绳子、冰爪、头盔，缺一不可' }
  ];

  /* 其他国家的分级规则（摘要，用于「关于难度」对照） */
  var GRADE_REFS = [
    { region: '美国 · 国家公园', name: 'Easy / Moderate / Strenuous 三档',
      body: '美国国家公园管理局最常用的分法，只看距离与累计爬升，不看技术动作。Easy 通常在 8 km 以内、爬升低于 300 m；Moderate 8–16 km 或爬升 300–900 m；Strenuous 超过 16 km 或爬升 900 m 以上。和我们的三档几乎一一对应，也是最好懂的一种。' },
    { region: '美国 · YDS', name: 'Class 1–5 技术阶梯',
      body: '优胜美地难度系统，描述的是"手要不要用"。徒步只在 Class 1–3；Class 4 开始需要手脚并用并承担坠落风险；Class 5 才进入需要绳索与确保的攀岩。我们的隐藏档（⬢ 六边形）对应 Class 4 以上。',
      ladder: [
        { k: 'Class 1', t: '平路或缓坡，双手空闲' },
        { k: 'Class 2', t: '陡一些，偶尔用手保持平衡' },
        { k: 'Class 3', t: '需要手脚并用，坠落后不致命' },
        { k: 'Class 4', t: '暴露感明显，建议结组与保护' },
        { k: 'Class 5', t: '需要绳索与确保，进入攀岩' }
      ] },
    { region: '瑞士 · SAC', name: 'T1–T6 山地步道分级',
      body: 'T1 徒步道（黄）、T2–T3 山地步道（红）、T4–T6 高山步道（蓝）。判定依据是路径明显程度、暴露感、是否需要手扶和装备。颜色直接印在实体路标上，和我们用形状区分的思路一致。' }
  ];

  /* 轨迹：归一化坐标 [[x,y], ...]，x 向右、y 向下，取值 0–1。
     换成真实 GPX/XML 的方式见 js/gpx.js 顶部的说明。 */
  var TRACKS = {
    xigu:    [[.06,.78],[.16,.70],[.24,.76],[.33,.60],[.42,.66],[.52,.50],[.60,.56],[.70,.40],[.80,.46],[.92,.28]],
    'qingshan-ridge': [[.50,.92],[.22,.80],[.10,.56],[.20,.30],[.44,.14],[.70,.16],[.88,.36],[.84,.62],[.66,.84],[.50,.92]],
    qunfeng: [[.06,.66],[.18,.62],[.28,.72],[.40,.52],[.50,.60],[.62,.38],[.74,.44],[.86,.22],[.94,.28]],
    songlin: [[.50,.88],[.20,.74],[.12,.46],[.30,.20],[.62,.14],[.86,.34],[.80,.66],[.50,.88]],
    wangchun:[[.10,.88],[.26,.78],[.36,.58],[.48,.64],[.58,.42],[.70,.32],[.82,.22],[.90,.10]],
    beibi:   [[.08,.90],[.20,.80],[.30,.66],[.42,.58],[.54,.46],[.66,.38],[.78,.24],[.90,.14]],
    yunhai:  [[.46,.90],[.18,.76],[.14,.44],[.34,.22],[.66,.20],[.88,.44],[.78,.72],[.46,.90]],
    guyidao: [[.05,.70],[.18,.66],[.30,.70],[.42,.58],[.54,.62],[.66,.50],[.78,.54],[.92,.42]]
  };

  /* 我爬过的山峰与登顶时间 */
  var SUMMITS = [
    { peakId: 'qingshan', name: '青山顶', alt: 1660, time: '01:42', date: '9 月 21 日', level: 'mid', pb: true },
    { peakId: 'wangchun', name: '望春台', alt: 1240, time: '01:05', date: '8 月 24 日', level: 'mid' },
    { peakId: 'yunhai',   name: '云海台', alt: 1520, time: '02:18', date: '7 月 30 日', level: 'mid' },
    { peakId: 'baishi',   name: '白石尖', alt: 1420, time: '02:47', date: '6 月 15 日', level: 'mid' }
  ];

  g.HIKES = {
    appName: '到此一游',
    brandEn: 'mark mountains',
    cha: 'CHA · China Hikers Association',
    slogan: '每一次上山，都算数。',
    subSlogan: '山里，总有人与你同频。',
    me: { id: 'me', name: '阿甘', av: '我', tone: 'a1', pb: '01:42', claim: '青山顶', streak: 6, since: '2025 年 6 月' },
    people: PEOPLE, peoples: PEOPLES, levels: LEVELS,
    trails: TRAILS, peaks: PEAKS, junctions: JUNCTIONS,
    posts: POSTS, activities: ACTIVITIES, messages: MESSAGES, letters: LETTERS,
    wantSeed: WANT_SEED, visitedSeed: VISITED_SEED, difficultyDoc: DIFFICULTY_DOC,
    routeFactors: ROUTE_FACTORS,
    gradeRefs: GRADE_REFS, tracks: TRACKS, mySummits: SUMMITS,
    gradeInputs: GRADE_INPUTS, terrains: TERRAINS
  };
})(window);
