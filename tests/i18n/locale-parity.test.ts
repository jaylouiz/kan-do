import { describe, it, expect } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'

type MessageTree = { [key: string]: string | MessageTree }

/** Flattens a nested message tree into dot-notation keys. */
export function flattenMessages(obj: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flattenMessages(value, path))
  }
  return out
}

/** Sorted, de-duplicated `{name}` placeholder names used in a message. */
export function placeholdersOf(msg: string): string[] {
  return [...new Set([...msg.matchAll(/\{(\w+)\}/g)].map(m => m[1] as string))].sort()
}

/** Number of plural branches; a literal pipe written as {'|'} is not a separator. */
export function pluralBranches(msg: string): number {
  return msg.replaceAll("{'|'}", '').split('|').length
}

const flatDe = flattenMessages(de as MessageTree)
const flatEn = flattenMessages(en as MessageTree)

describe('locale parity (de/en)', () => {
  it('de and en have identical key sets', () => {
    expect(Object.keys(flatDe).sort()).toEqual(Object.keys(flatEn).sort())
  })

  it.each([['de', flatDe], ['en', flatEn]] as const)('every %s message is a non-empty string', (_name, flat) => {
    for (const [key, msg] of Object.entries(flat)) {
      expect(typeof msg, key).toBe('string')
      expect(msg.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('placeholders match per key', () => {
    for (const [key, msgDe] of Object.entries(flatDe)) {
      const msgEn = flatEn[key]
      if (msgEn === undefined) continue
      expect(placeholdersOf(msgEn), `placeholders of ${key}`).toEqual(placeholdersOf(msgDe))
      expect(pluralBranches(msgEn), `plural branches of ${key}`).toBe(pluralBranches(msgDe))
    }
  })
})
