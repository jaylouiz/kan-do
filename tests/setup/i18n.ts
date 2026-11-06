import { beforeEach, vi } from 'vitest'
import { config } from '@vue/test-utils'
import { setI18nInstance } from '~/lib/i18n'
import { testI18n, setTestLocale } from '../helpers/i18n'

// Make `useI18n()` usable outside component setup (composables, stores) in unit tests.
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => testI18n.global,
}))

config.global.plugins.push(testI18n)
setI18nInstance(testI18n.global)

beforeEach(() => {
  setTestLocale('de')
})
