// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'
import * as fs from 'fs'
import { fileURLToPath } from 'node:url'
import { removeDevPages } from './lib/devPages'

// reading version to make it available in nuxt context for displaying
const packageJson = fs.readFileSync('./package.json', 'utf8')
const version = JSON.parse(packageJson).version || 0

const isDev = process.env.NODE_ENV !== 'production'

// Live copy editor (#59): in `nuxt dev`, and in the E2E build (scripts/e2e-server.mjs sets the flag so the specs can
// drive it). Every other build gets `false`, which drops `dev-tools/copy-editor/` from the bundle.
const copyEditor = isDev || process.env.KANDO_COPY_EDITOR === '1'

// E2E build (#541): `scripts/e2e-server.mjs` sets this to a directory of its own, so the Playwright build never writes
// `.nuxt` (a dev server or typecheck may be using it) or `.output` (`npm run generate` for Tauri). Unset for every other command.
const e2eBuildDir = process.env.KANDO_E2E_BUILD_DIR

export default defineNuxtConfig({
  ...(e2eBuildDir ? { buildDir: `${e2eBuildDir}/nuxt` } : {}),

  // Dev-only pages (#65): `/ui` and `/error-test` exist only in `nuxt dev` and the E2E build (lib/devPages.ts). The
  // hook runs at build time, so a production build carries neither the routes nor the page code.
  hooks: {
    'pages:extend'(pages) {
      removeDevPages(pages, process.env)
    },
  },

  // Modules
  modules: [
    '@nuxt/ui',
    // zero-config animation plugin
    '@formkit/auto-animate/nuxt',
    // Motion.dev animation library
    'motion-v/nuxt',
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxtjs/i18n',
  ],

  // UI locale: German default + fallback, English. No route prefixes and no module-side
  // browser detection; plugins/i18n-locale.client.ts resolves the locale before first render.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'de',
    detectBrowserLanguage: false,
    locales: [
      { code: 'de', language: 'de-DE', file: 'de.json', name: 'Deutsch' },
      { code: 'en', language: 'en-US', file: 'en.json', name: 'English' },
    ],
    vueI18n: './i18n.config.ts',
  },

  // Nuxt UI v4 options: we already configure fonts and color mode explicitly
  ui: {
    fonts: false,
    colorMode: false
  },

  // Icon configuration for reliable loading
  icon: {
    // Pre-bundle Phosphor icons to avoid async loading issues
    collections: ['ph', 'simple-icons'],
    // Use SVG mode for more reliable rendering
    mode: 'svg',
    // Client-side bundle for better reliability with SSR disabled
    clientBundle: {
      // Scan for icons used in the codebase. The default skips .ts, so icons named in composables,
      // utils and app.config.ts would be fetched from api.iconify.design at runtime, which the
      // desktop CSP blocks (ADR 012). Keep this list in step with the folders that
      // tests/config/icons-bundled.test.ts walks (the whole repo minus build, test and doc folders).
      scan: {
        globInclude: [
          '{components,composables,pages,layouts,plugins,utils,lib,integrations,store,types,middleware,app,server,i18n}/**/*.{vue,ts}',
          'app.vue',
          'app.config.ts',
        ],
      },
      // Include commonly used icons
      icons: [
        'ph:number-circle-one',
        'ph:number-circle-two',
        'ph:exclamation-mark',
        'ph:seal-warning',
        'ph:trash',
        'ph:caret-down',
        'ph:clock',
        'ph:check-circle',
        'ph:plus',
        'ph:x',
        'simple-icons:todoist',
        'simple-icons:notion',
        'ph:desktop',
      ]
    }
  },

  // Global CSS
  css: ['~/assets/css/main.css'],

  devtools: {
    enabled: false,
    timeline: { enabled: false }
  },

  // App Head
  app: {
    baseURL: process.env.BASE_URL || '/',
    head: {
      title: process.env.APP_TITLE || 'kan-do',
      htmlAttrs: { lang: process.env.APP_LANG || 'de' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { key: 'description', name: 'description', content: '' },
        { name: 'format-detection', content: 'telephone=no' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '48x48' }
      ]
    }
  },

  // Disable SSR for desktop app
  ssr: false,

  // Dev watcher: keep the Rust build tree and build/test artefacts out of Nuxt's file watcher (#542).
  // (Nuxt's default list already has `.output`, `.nuxt` and `**/test-results`, not these.)
  // Nuxt opens one native watcher (a file descriptor on macOS) per watched file. `src-tauri/target`
  // holds about 17,500 files, so a checkout that has built the desktop app sat at ~18,000 open
  // descriptors; at that count Nitro's `spawn` of esbuild fails with `[nitro] ERROR Error: spawn EBADF`
  // (reproduced with a spawn trace; `ulimit -n` was not the limit). `CHOKIDAR_USEPOLLING=1` hid this
  // (cd612ef0) at 127-135 % idle CPU; with these paths ignored, native watching works and idles at ~0 %.
  // If `spawn EBADF` returns, count descriptors first (`lsof -p <nuxt pid> | wc -l`) and look for a new
  // large watched folder before reaching for polling again.
  //
  // `ignore` is not watcher-only: Nuxt applies it to every path below the root, also to the files it generates and
  // scans (pages, components, auto-imports). Hence two rules: the patterns are anchored to the root (`/dist` would
  // also match `.nuxt/dist` and any nested `dist`), and the list is dev-only. The E2E build puts its own buildDir
  // into `.e2e-build/<port>/nuxt`, so ignoring `.e2e-build` there dropped the generated routes and the app rendered
  // empty (the first version of this setting did, #576). The watcher-only options do not reach Nuxt's
  // watcher: it sets its own `ignored` after spreading `watchers.chokidar` (overriding it), and the Vite and Nitro
  // watchers are separate ones.
  ...(isDev
    ? { ignore: ['/src-tauri', '/dist', '/.e2e-build', '/tests/e2e/playwright-report', '/.playwright-mcp'] }
    : {}),

  // Nitro preset: environment-first with fallbacks
  nitro: isDev
    ? {
        // watchOptions is still honoured by Nitro but missing from Nuxt 4.5's narrowed type
        watchOptions: {
          ignored: ['**/node_modules/**', '**/.git/**', '**/.output/**', '**/dist/**', '**/.e2e-build/**'],
        },
        // Dev-only routes of the live copy editor (#59): registered here, outside `server/api`, so no build scans them in.
        handlers: [
          { route: '/api/dev/copy/translate', method: 'post', handler: fileURLToPath(new URL('./server/copy-editor/translate.post.ts', import.meta.url)) },
          { route: '/api/dev/copy/publish', method: 'post', handler: fileURLToPath(new URL('./server/copy-editor/publish.post.ts', import.meta.url)) },
        ],
      } as Record<string, unknown>
    : {
        preset: process.env.NITRO_PRESET || 'static',
        ...(e2eBuildDir ? { output: { dir: `${e2eBuildDir}/output` } } : {}),
      },


  // Local-first fonts
  fonts: {
    families: [
      {
        name: 'Figtree',
        src: '/fonts/Figtree-VariableFont_wght.ttf',
        weight: '300 900',
        style: 'normal',
        global: true
      },
      {
        name: 'Figtree',
        src: '/fonts/Figtree-Italic-VariableFont_wght.ttf',
        weight: '300 900',
        style: 'italic',
        global: true
      }
    ]
  },

  runtimeConfig: {
    public: {
      clientVersion: version,
      // Dev-only locale override (`KANDO_LOCALE=en npm run dev`); ignored outside import.meta.dev
      localeOverride: process.env.KANDO_LOCALE || '',
    }
  },

  compatibilityDate: '2025-03-09',

  // Build-time constants
  vite: {
    optimizeDeps: {
      // Pre-bundle deps that Vite otherwise discovers only at runtime. On a cold dep cache
      // (fresh checkout, CI, or after a dependency change) runtime discovery triggers a
      // re-optimization and a full reload of every open page, which aborts in-flight E2E tests.
      include: [
        'pinia',
        'pinia-plugin-persistedstate',
        '@doist/todoist-api-typescript',
        '@tauri-apps/plugin-http',
        '@dnd-kit/dom',
        '@dnd-kit/vue',
        '@dnd-kit/vue/sortable',
        '@internationalized/date',
        'reka-ui',
      ],
    },
    server: {
      watch: {
        // Exclude directories that don't need hot-reload watching to reduce open file descriptors
        ignored: ['**/node_modules/**', '**/.git/**', '**/.output/**', '**/dist/**', '**/.e2e-build/**', '**/tests/e2e/snapshots/**'],
      },
    },
    define: {
      '__COPY_EDITOR__': copyEditor,
      // Allow Notion sentinel token (notion_test_stub) in dev and Vercel preview deployments.
      // Tree-shaken to `false` in production.
      '__NOTION_STUB_ALLOWED__': process.env.VERCEL_ENV === 'preview'
        || process.env.NOTION_STUB_ENABLED === 'true'
        || process.env.NODE_ENV !== 'production',
    },
  },
})
