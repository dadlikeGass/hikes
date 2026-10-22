export default defineAppConfig({
  pages: ['pages/home/index', 'pages/places/index', 'pages/routes/index', 'pages/board/index', 'pages/me/index', 'pages/messages/index', 'pages/scan/index', 'pages/routes/detail/index', 'pages/routes/segment/index', 'pages/point/index', 'pages/junction/index', 'pages/mountain/index', 'pages/managed/index', 'pages/managed/detail/index', 'pages/legal/index', 'pages/delete-account/index'],
  window: { navigationBarTitleText: '到此一游 · 山里见', navigationBarBackgroundColor: '#f7f5ee', navigationBarTextStyle: 'black', backgroundColor: '#f7f5ee' },
  tabBar: {
    custom: true, color: '#7b8077', selectedColor: '#315c48', backgroundColor: '#fffdf7',
    list: [
      { pagePath: 'pages/places/index', text: '山头' },
      { pagePath: 'pages/routes/index', text: '路书' },
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/board/index', text: '留言版' },
      { pagePath: 'pages/me/index', text: '我' }
    ]
  }
})
