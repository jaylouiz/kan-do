import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '~': resolve(__dirname, '.'),
      '#imports': resolve(__dirname, 'tests/mocks/nuxt-imports.ts'),
    },
  },
  test: {
    globals: true,
    // Several workers plus the gate push the machine load past 90; the 5 s default timed out copy-editor tests and blocked pushes.
    testTimeout: 15000,
    setupFiles: ['tests/setup/git-env.ts', 'tests/setup/i18n.ts'],
    environment: 'jsdom',
    // Server API tests opt into Node via a `// @vitest-environment node` docblock
    // (`environmentMatchGlobs` was removed in Vitest 4).
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
      'dist/**',
      // Agent worktrees are full repo copies; their tests resolve against this checkout and fail.
      '.claude/**',
    ],
  },
})
