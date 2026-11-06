import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Ref } from 'vue'
import { createI18n } from 'vue-i18n'

const messages = {
  de: {
    greeting: 'Hallo {name}',
    tasks: '{count} Aufgaben | {count} Aufgabe | {count} Aufgaben',
    plain: 'Einfach',
  },
  en: {
    greeting: 'Hello {name}',
    tasks: '{count} tasks | {count} task | {count} tasks',
    plain: 'Plain',
  },
}

async function loadModule() {
  vi.resetModules()
  return await import('~/lib/i18n')
}

function createComposer(locale: 'de' | 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'de', messages }).global
}

describe('lib/i18n', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the key and default locale before an instance is registered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { translate, getActiveLocale } = await loadModule()
    expect(translate('plain')).toBe('plain')
    expect(getActiveLocale()).toBe('de')
  })

  it('translates plain and named messages with the registered composer', async () => {
    const { setI18nInstance, translate } = await loadModule()
    setI18nInstance(createComposer('en'))
    expect(translate('plain')).toBe('Plain')
    expect(translate('greeting', { name: 'Ada' })).toBe('Hello Ada')
  })

  it('selects plural branches at 0 and 1 in both locales', async () => {
    const { setI18nInstance, translate } = await loadModule()
    const composer = createComposer('de')
    setI18nInstance(composer)
    expect(translate('tasks', { count: 0 }, 0)).toBe('0 Aufgaben')
    expect(translate('tasks', { count: 1 }, 1)).toBe('1 Aufgabe')
    expect(translate('tasks', undefined, 3)).toBe('3 Aufgaben')
    composer.locale.value = 'en'
    expect(translate('tasks', { count: 0 }, 0)).toBe('0 tasks')
    expect(translate('tasks', { count: 1 }, 1)).toBe('1 task')
  })

  it('reports the active locale narrowed to a supported locale', async () => {
    const { setI18nInstance, getActiveLocale } = await loadModule()
    const composer = createComposer('en')
    setI18nInstance(composer)
    expect(getActiveLocale()).toBe('en')
    // Simulate an unsupported locale leaking into the composer
    ;(composer.locale as Ref<string>).value = 'fr'
    expect(getActiveLocale()).toBe('de')
  })
})
