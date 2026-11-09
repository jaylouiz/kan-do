// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { createRequire } from 'module'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import { NON_UTILITY_CLASS, projectCssClasses } from './scripts/lint/design-tokens.mjs'

const require = createRequire(import.meta.url)

// E2E drag-and-drop: page.mouse only (docs/testing/e2e-dnd-patterns.md). `.dragTo(` matches member
// calls only, so a local helper `dragTo(page, ...)` stays legal. Flat config replaces a rule's whole
// option list per block, so the E2E blocks below spread this list into their own `no-restricted-syntax`.
const E2E_DND_MESSAGE = 'Drive drag-and-drop with page.mouse (move, down, move, up), never locator.dragTo() or a synthetic DragEvent. See docs/testing/e2e-dnd-patterns.md.'
const E2E_DND_SELECTORS = [
  { selector: "CallExpression > MemberExpression.callee[property.name='dragTo']", message: E2E_DND_MESSAGE },
  { selector: "NewExpression[callee.name='DragEvent']", message: E2E_DND_MESSAGE },
  { selector: "CallExpression[callee.property.name='dispatchEvent'] > Literal.arguments[value=/^drag/]", message: E2E_DND_MESSAGE }
]

// E2E specs import the shared drag helpers from tests/e2e/helpers/dnd.ts and never declare their own copy (#419):
// a local copy silently diverges (#408 lost ~10 min to one). `import { pickUp }` is not a declaration, so it stays legal.
const E2E_DND_HELPER_MESSAGE = 'Import this drag helper from tests/e2e/helpers/dnd.ts instead of declaring a local copy (docs/testing/e2e-dnd-patterns.md: specs do not copy the pattern).'
const E2E_DND_HELPER_NAMES = '/^(pickUp|hover|finger|edgeDwell)$/'
const E2E_DND_HELPER_SELECTORS = [
  { selector: `FunctionDeclaration[id.name=${E2E_DND_HELPER_NAMES}]`, message: E2E_DND_HELPER_MESSAGE },
  { selector: `VariableDeclarator[id.name=${E2E_DND_HELPER_NAMES}]`, message: E2E_DND_HELPER_MESSAGE }
]

// E2E specs wait for the element or state they need next, never for network silence (#546): `networkidle` waits
// 500 ms past the last request (slower than a web-first wait) and flakes when a background request lands in the
// window. Matches `waitForLoadState('networkidle')` and `{ waitUntil: 'networkidle' }` alike. Spread into every E2E
// block below, because flat config replaces a rule's whole option list per block.
const E2E_NETWORKIDLE_SELECTORS = [
  {
    selector: "Literal[value='networkidle']",
    message: "No 'networkidle' in E2E (#546): wait for what the next line needs: expect(locator).toBeVisible(), locator.waitFor(), or page.waitForResponse() for a specific request."
  }
]

/**
 * Create a custom plugin for documentation standards
 */
const createDocumentationPlugin = () => {
  // Import the documentation rules
  const docRules = require('./eslint-docs-rules.js')
  
  return {
    name: 'kan-do-docs',
    rules: docRules
  }
}

export default withNuxt([
  {
    // Ignore generated/binary assets from Tauri builds and other common patterns
    ignores: [
      'src-tauri/target/**',
      'dist/**',
      '.nuxt/**',
      '.output/**',
      '.e2e-build/**',
      'coverage/**',
      'node_modules/**',
      '**/*.new.vue',
      '*.tmp',
      '*.temp',
      '.DS_Store',
      'Thumbs.db',
      '.vscode/**',
      '.idea/**',
      'logs/**',
      '*.log',
      '.env*'
    ]
  },
  {
    // Integration files - allow any types for external APIs
    files: [
      'integrations/**/*.ts',
      'server/api/**/*.ts',
      'server/utils/**/*.ts',
      'plugins/**/*.ts'
    ],
    rules: {
      // Allow any types for external API integration where types are complex/unknown
      '@typescript-eslint/no-explicit-any': 'off',
      // Keep other safety rules
      '@typescript-eslint/no-unused-vars': 'error'
    }
  },
  {
    // Test files - more permissive rules
    files: [
      'tests/**/*.ts',
      '**/*.test.ts',
      '**/*.spec.ts'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn'
    }
  },
  {
    // Core application code - strict rules
    files: [
      'components/**/*.vue',
      'composables/**/*.ts',
      'store/**/*.ts',
      'types/**/*.ts',
      'utils/**/*.ts',
      'pages/**/*.vue'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error'
    }
  },
  {
    // Tailwind drift prevention — catch classes that bypass the token system
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'assets/css/main.css',
      },
    },
    rules: {
      // Hard errors: these are always bugs
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      // A utility-shaped class that neither Tailwind, Nuxt UI nor the project's CSS defines renders nothing
      // (`text-muted-foreground`, `border-border` and `focus:border-foreground` from shadcn habits sat unnoticed).
      // Component and marker classes (`task-card`, `is-on`) and classes the project's CSS defines are not its business.
      'better-tailwindcss/no-unknown-classes': ['error', {
        ignore: [NON_UTILITY_CLASS, ...projectCssClasses(import.meta.dirname).map(name => `^(?:[\\w-]+:)*!?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)],
      }],
      // Warn: arbitrary values bypass the semantic token system (use `text-xs` not `text-[10px]`)
      'better-tailwindcss/no-restricted-classes': [
        'warn',
        {
          restrict: [
            { pattern: '\\[#[0-9a-fA-F]', message: 'Use a semantic token instead of a hardcoded hex color.' },
            { pattern: '\\[\\d+\\.?\\d*px\\]', message: 'Use a Tailwind spacing/sizing token instead of a pixel value.' },
            { pattern: '\\[\\d+\\.?\\d*rem\\]', message: 'Use a Tailwind typography token instead of a rem value.' },
            // Raw palette colors bypass the Nuxt UI theme. Optional variant prefix (`dark:`, `hover:`, …),
            // important modifier and opacity modifier (`/50`) are matched so `dark:bg-neutral-800/50` is caught.
            {
              pattern: '^(?:\\S+:)?!?(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|decoration|caret|accent|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}(?:\\/\\d+)?!?$',
              message: 'Use a Nuxt UI semantic token (text-muted, bg-elevated, …) instead of a raw palette class.',
            },
          ],
        },
      ],
      // Warn: enforce canonical class order for readable diffs
      'better-tailwindcss/enforce-consistent-class-order': 'warn',
      // Warn: prefer canonical utilities (e.g. `size-4` over `w-4 h-4`)
      'better-tailwindcss/enforce-canonical-classes': 'warn',
    },
  },
  {
    // i18n: UI copy must go through vue-i18n keys
    files: [
      'components/**/*.vue',
      'pages/**/*.vue',
      'layouts/**/*.vue',
      'app.vue'
    ],
    ignores: [
      'pages/ui.vue',
      'pages/error-test.vue'
    ],
    // Plugin rule typings (meta.fixable: null) are stricter-incompatible with ESLint's types
    plugins: { '@intlify/vue-i18n': /** @type {any} */ (vueI18n) },
    settings: {
      'vue-i18n': {
        localeDir: './i18n/locales/*.json',
        messageSyntaxVersion: '^11.0.0'
      }
    },
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', {
        ignorePattern: '^[-#:()&+×/°′″·•—–…%?!.,;|0-9\\s]+$',
        ignoreNodes: ['UIcon', 'Icon']
      }],
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/no-html-messages': 'error'
    }
  },
  {
    // Icon rule: Phosphor only (`i-ph-*` / `ph:*`). Heroicons are banned (DESIGN.md, backlog C10).
    // Other uninstalled collections (`i-lucide-*`) are caught by tests/config/icons-bundled.test.ts.
    // Task timers (#352): `task.timerId` is never passed to clearInterval; stopTaskTimer(id) is the only way.
    files: ['**/*.ts', '**/*.vue'],
    ignores: ['tests/**', 'eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/heroicons/]', message: 'Use a Phosphor icon (i-ph-*) instead of Heroicons.' },
        { selector: 'TemplateElement[value.raw=/heroicons/]', message: 'Use a Phosphor icon (i-ph-*) instead of Heroicons.' },
        {
          selector: "CallExpression:matches([callee.name='clearInterval'], [callee.property.name='clearInterval']) > MemberExpression.arguments[property.name='timerId']",
          message: 'Never clearInterval(task.timerId): stop a task timer through stopTaskTimer(id) from lib/taskTimers.ts (#352).'
        }
      ],
      'vue/no-restricted-syntax': ['error',
        { selector: 'VLiteral[value=/heroicons/]', message: 'Use a Phosphor icon (i-ph-*) instead of Heroicons.' },
        { selector: 'VText[value=/heroicons/]', message: 'Use a Phosphor icon (i-ph-*) instead of Heroicons.' }
      ]
    }
  },
  {
    // TaskStatus is a numeric enum and Open is 0 (#435): no truthiness check on a status value. Untyped name-based
    // custom rule (a typed one costs ~+80% lint time here); see the rule's header for the trade-off.
    files: ['**/*.ts', '**/*.vue'],
    plugins: { 'kan-do': { rules: { 'no-taskstatus-truthiness': require('./eslint-rules/no-taskstatus-truthiness.cjs') } } },
    rules: { 'kan-do/no-taskstatus-truthiness': 'error' }
  },
  {
    // E2E drag-and-drop: page.mouse only (see E2E_DND_SELECTORS above)
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...E2E_DND_SELECTORS, ...E2E_NETWORKIDLE_SELECTORS]
    }
  },
  {
    // E2E specs (#419): no local copies of the shared drag helpers. helpers/ and other non-spec files are untouched.
    // The stack block below repeats these selectors (flat config replaces the option list per block).
    files: ['tests/e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...E2E_DND_SELECTORS, ...E2E_DND_HELPER_SELECTORS, ...E2E_NETWORKIDLE_SELECTORS]
    }
  },
  {
    // E2E stack specs (#187): no guess-duration sleeps. Wait on state (expect, settleStack,
    // flushFrames); a real dwell goes through dwell() with a named constant from helpers/constants.ts.
    files: ['tests/e2e/stack-*.spec.ts'],
    // stack-motion.spec.ts still has a pre-existing waitForTimeout(150); drop this ignore once it is converted
    ignores: ['tests/e2e/stack-motion.spec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...E2E_DND_SELECTORS, ...E2E_DND_HELPER_SELECTORS, ...E2E_NETWORKIDLE_SELECTORS, {
        selector: "CallExpression[callee.name='dwell'] > Literal",
        message: 'dwell() takes a named constant from helpers/constants.ts (or a pacing parameter), not a bare number.'
      }],
      'no-restricted-properties': ['error', {
        property: 'waitForTimeout',
        message: 'Wait on state: expect(...), settleStack/settleAnimations/flushFrames. A real dwell goes through dwell() from helpers/settle.ts.'
      }]
    }
  },
  {
    // Add custom documentation rules
    files: ['**/*.vue'],
    rules: {
      // Qualify with plugin name to reference our custom rule
      'kan-do-docs/vue/component-documentation': 'off'
    },
    // Add our custom plugin
    plugins: {
      'kan-do-docs': createDocumentationPlugin()
    }
  }
])
