import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'hikes-miniapp',
  env: {
    TARO_APP_API_BASE_URL: JSON.stringify(process.env.TARO_APP_API_BASE_URL || 'https://www.fotowa.fun')
  },
  date: '2026-10-19',
  designWidth: 750,
  deviceRatio: { 640: 2.34, 750: 1, 828: 1.81 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  mini: { postcss: { pxtransform: { enable: true }, cssModules: { enable: false } } },
  h5: { publicPath: '/', staticDirectory: 'static' }
})
