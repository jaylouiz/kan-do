import { describe, it, expect } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import { createTestI18n } from '../helpers/i18n'

type MessageTree = { [key: string]: string | MessageTree }

function flatten(obj: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

/** Raw value as it should render: literal-escape syntax `{'x'}` unescaped. */
const unescapeLiterals = (raw: string): string => raw.replace(/\{'([^']*)'\}/g, '$1')

describe('plain messages render exactly as written', () => {
  for (const [name, tree] of [['de', de], ['en', en]] as const) {
    const i18n = createTestI18n(name)
    const plain = Object.entries(flatten(tree as MessageTree)).filter(([, raw]) => {
      const withoutLiterals = raw.replace(/\{'[^']*'\}/g, '')
      return !withoutLiterals.includes('|') && !/\{\w+\}/.test(withoutLiterals)
    })

    it(`${name}: every plain message renders equal to its raw value`, () => {
      expect(plain.length).toBeGreaterThan(100)
      for (const [key, raw] of plain) {
        expect(i18n.global.t(key), key).toBe(unescapeLiterals(raw))
      }
    })
  }

  it('statistics.headTitle keeps its literal pipe', () => {
    expect(createTestI18n('de').global.t('statistics.headTitle')).toBe('Statistik | Kan-Do')
    expect(createTestI18n('en').global.t('statistics.headTitle')).toBe('Statistics | Kan-Do')
  })
})
