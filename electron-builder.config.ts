import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.ashmindhungana.cullai',
  productName: 'CullAI',

  directories: {
    output: 'dist/release',
    buildResources: 'build'
  },

  files: [
    'dist/main/**/*',
    'dist/renderer/**/*',
    'package.json'
  ],

  // Targets left empty for now — configured in Phase build
  win: {},
  mac: {},
  linux: {}
}

export default config