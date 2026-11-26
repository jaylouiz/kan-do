import { describe, expect, it } from 'vitest'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'

// #597, #654: the product name in running copy is "Kan-do" (docs/copy/voice.md); "kan-do" and "Kan-Do" are the same mistake.
// The `nav.brand` wordmark is "Kan-do" too (#888, #890); it stays exempt here only as the wordmark key.
function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === 'string') return [[path.join('.'), node]]
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]))
  return []
}

describe('product name in locale copy', () => {
  for (const [name, locale] of [['de', de], ['en', en]] as const) {
    it(`${name}: no "kan-do" or "Kan-Do" outside the wordmark`, () => {
      const bad = leaves(locale)
        .filter(([key]) => key !== 'nav.brand')
        .filter(([, v]) => /\b(kan-do|Kan-Do)\b/.test(v))
      expect(bad).toEqual([])
    })
  }
})
