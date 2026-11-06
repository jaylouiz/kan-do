import { describe, expect, it } from 'vitest'
import { stackAccessibleName } from '~/utils/stackAccessibleName'

describe('stackAccessibleName (#154)', () => {
  const calls: Array<[string, Record<string, unknown>, number]> = []
  const fake = (key: string, named: Record<string, unknown>, plural: number) => {
    calls.push([key, named, plural])
    return `${key}|${JSON.stringify(named)}|${plural}`
  }

  it('names the stack by its front title, group and count', () => {
    calls.length = 0
    stackAccessibleName(fake, { frontTitle: 'Write spec', group: 'Hoch', count: 3 })
    expect(calls).toEqual([['board.stack.label', { title: 'Write spec', group: 'Hoch', n: 3 }, 3]])
  })

  it.each([undefined, '', '   '])('falls back to the group label for an empty front title (%j)', (frontTitle) => {
    calls.length = 0
    stackAccessibleName(fake, { frontTitle, group: 'Hoch', count: 3 })
    expect(calls[0]?.[0]).toBe('board.stack.labelUntitled')
  })
})

describe('stackAccessibleName with the real messages', () => {
  it('never starts with a comma, in German and English', async () => {
    const { setTestLocale } = await import('../helpers/i18n')
    const { translate } = await import('~/lib/i18n')
    for (const locale of ['de', 'en'] as const) {
      setTestLocale(locale)
      const name = stackAccessibleName(translate, { frontTitle: '', group: 'Hoch', count: 3 })
      expect(name).toMatch(/^Hoch, 3 /)
    }
  })
})
