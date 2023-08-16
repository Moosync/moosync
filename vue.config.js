const webpack = require('webpack')
const dotenv = require('dotenv').config({ path: `${__dirname}/config.env` })
const fs = require('fs')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const { resolve } = require('path')
const manifest = require('./package.json')

// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

const archElectronConfig = {}

if (fs.existsSync('/usr/lib/electron') && fs.existsSync('/usr/lib/electron/version')) {
  archElectronConfig.electronDist = '/usr/lib/electron'
  archElectronConfig.electronVersion = fs
    .readFileSync('/usr/lib/electron/version', { encoding: 'utf-8' })
    .replace('v', '')
}

const RendererSecrets = {}
const MainSecrets = {}
if (dotenv.parsed) {
  RendererSecrets['process.env.YoutubeClientID'] = JSON.stringify(dotenv.parsed['YOUTUBECLIENTID'])
  RendererSecrets['process.env.YoutubeClientSecret'] = JSON.stringify(dotenv.parsed['YOUTUBECLIENTSECRET'])
  RendererSecrets['process.env.LastFmApiKey'] = JSON.stringify(dotenv.parsed['LASTFMAPIKEY'])
  RendererSecrets['process.env.LastFmSecret'] = JSON.stringify(dotenv.parsed['LASTFMSECRET'])
  MainSecrets['process.env.FanartTVApiKey'] = JSON.stringify(dotenv.parsed['FANARTTVAPIKEY'])
}

module.exports = {
  runtimeCompiler: true,
  pages: {
    index: {
      entry: 'src/mainWindow/main.ts',
      template: 'public/index.html',
      filename: 'index.html',
    },
    preferenceWindow: {
      entry: 'src/preferenceWindow/main.ts',
      template: 'public/index.html',
      filename: 'preferenceWindow.html',
    },
  },
  chainWebpack: (config) => {
    config.resolve.alias.set('vue-facing-decorator', 'vue-facing-decorator/dist/index-return-cons')
    config.resolve.alias.set('vue', '@vue/compat')
    config.module
      .rule('vue')
      .use('vue-loader')
      .tap((options) => {
        return {
          ...options,
          compilerOptions: {
            compatConfig: {
              MODE: 2,
            },
          },
        }
      })
  },
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        'process.browser': 'true',
        'process.env.MOOSYNC_VERSION': JSON.stringify(manifest.version),
        __VUE_I18N_FULL_INSTALL__: JSON.stringify(true),
        __INTLIFY_PROD_DEVTOOLS__: JSON.stringify(false),
        __VUE_I18N_LEGACY_API__: JSON.stringify(false),
        ...RendererSecrets,
      }),

      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      // new BundleAnalyzerPlugin()
    ],
    externals: {
      'better-sqlite3': 'commonjs better-sqlite3',
      vm2: "require('vm2')",
      sharp: "require('sharp')",
      'librespot-node': 'commonjs librespot-node',
      'scanner-native': 'commonjs scanner-native',
    },
    devtool: 'source-map',
    resolve: {
      fallback: {
        stream: require.resolve('stream-browserify'),
        fs: false,
        util: false,
        os: false,
        url: false,
        net: false,
        assert: false,
        crypto: false,
        dgram: false,
        buffer: require.resolve('buffer'),
        http: false,
        https: false,
        zlib: false,
      },
    },
  },
  pluginOptions: {
    electronBuilder: {
      mainProcessWatch: ['src/utils/main', 'src/utils/extensions', 'src/utils/common.ts', 'src/utils/spotify'],
      customFileProtocol: 'moosync://./',
      builderOptions: {
        ...archElectronConfig,
        appId: 'app.moosync.Moosync',
        productName: 'Moosync',
        artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
        icon: './build/icons/512x512.png',
        mac: {
          icon: './build/icons/icon.icns',
        },
        win: {
          verifyUpdateCodeSignature: false,
          target: ['portable', 'nsis'],
        },
        linux: {
          icon: './build/icons/',
          target: ['AppImage', 'deb', 'tar.gz', 'pacman', 'rpm'],
        },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
        },
        portable: {
          artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}',
        },
        snap: {
          stagePackages: [
            'libnspr4',
            'libnss3',
            'libxss1',
            'libappindicator3-1',
            'libsecret-1-0',
            'libatomic1',
            'libicu-dev',
            'libasound2-dev',
            'libvips-dev',
          ],
          // https://github.com/electron-userland/electron-builder/issues/4982#issuecomment-641598670
          publish: ['github'],
        },
        deb: {
          depends: ['libnotify4', 'libxtst6', 'libnss3', 'libatomic1', 'libicu-dev', 'libasound2-dev'],
        },
        rpm: {
          depends: ['/usr/lib64/libuuid.so.1', '/usr/lib64/libnss3.so', '/usr/lib64/libnssutil3.so'],
        },
        fileAssociations: [
          {
            ext: 'mp3',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'flac',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'aac',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'ogg',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'wav',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'm4a',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'webm',
            description: 'Music file extension',
            role: 'Viewer',
          },
          {
            ext: 'wv',
            description: 'Music file extension',
            role: 'Viewer',
          },
        ],
        publish: [
          {
            provider: 'github',
            owner: 'Moosync',
            repo: 'Moosync',
            vPrefixedTagName: true,
            releaseType: 'draft',
          },
        ],
        files: ['**/*', '!node_modules/librespot-node/native/target/*', '!node_modules/scanner-native/target/*'],
        asarUnpack: [
          '*.worker.js',
          'sandbox.js',
          'spotify.js',
          '**/node_modules/**/*.node',
          'node_modules/bindings',
          'node_modules/file-uri-to-path',
          'node_modules/better-sqlite3',
        ],
        protocols: [
          {
            name: 'Default protocol',
            schemes: ['moosync'],
          },
        ],
        beforeBuild: 'scripts/fontFix.js',
        afterPack: 'scripts/beforePack.js',
      },
      nodeIntegration: false,
      disableMainProcessTypescript: false,
      mainProcessTypeChecking: true,
      preload: 'src/utils/preload/preload.ts',
      externals: ['better-sqlite3', 'vm2', 'sharp', 'librespot-node', 'scanner-native'],
      chainWebpackMainProcess: (config) => {
        config.devtool('source-map').end()

        config.plugin('define').tap((args) => {
          args[0] = {
            ...args[0],
            'process.env.MOOSYNC_VERSION': JSON.stringify(manifest.version),
            ...MainSecrets,
          }

          return args
        })

        config.entry('sandbox').add(`${__dirname}/src/utils/extensions/sandbox/index.ts`).end()

        config.entry('spotify').add(`${__dirname}/src/utils/spotify/index.ts`).end()

        config.entry('sqlite3.worker').add(`${__dirname}/src/utils/main/db/workers/sqlite3.ts`).end()

        config.plugin('copy').use(CopyWebpackPlugin, [{ patterns: [{ from: resolve('dev-app-update.yml') }] }])

        // config.plugin('copy').use(BundleAnalyzerPlugin)
      },
    },
  },
}
