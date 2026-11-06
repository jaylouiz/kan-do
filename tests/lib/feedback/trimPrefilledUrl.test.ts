import { describe, expect, it } from 'vitest'
import { buildPrefilledUrl, MAX_URL_LENGTH } from '~/lib/feedback/trimPrefilledUrl'
import type { IssueBodyInput } from '~/lib/feedback/types'

const base: IssueBodyInput = {
  description: 'Karte ist abgeschnitten',
  element: {
    chain: ['TaskCard'], testId: 'task-card', selector: '[data-testid="task-card"]',
    rect: { x: 1, y: 2, width: 3, height: 4 }, taskId: 'a',
  },
  environment: { route: '/tasks', viewport: { width: 1200, height: 768 }, locale: 'de' },
  versionInfo: { version: '0.1.0', os: 'macOS' },
}
const bodyOf = (url: string) => new URL(url).searchParams.get('body') ?? ''

describe('buildPrefilledUrl', () => {
  it('prefills title, body and the inbox label for the pinned repo', () => {
    const { url, trimmed, overflow } = buildPrefilledUrl('Titel & mehr', base)
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://github.com/jaylouiz/kan-do/issues/new')
    expect(parsed.searchParams.get('title')).toBe('Titel & mehr')
    expect(parsed.searchParams.get('labels')).toBe('inbox')
    expect(bodyOf(url)).toContain('Karte ist abgeschnitten')
    expect(trimmed).toEqual([])
    expect(overflow).toBe(false)
  })

  it('drops the log tail first', () => {
    const logTail = 'x'.repeat(4000)
    const { url, trimmed } = buildPrefilledUrl('T', { ...base, logTail, description: 'y'.repeat(6600) })
    expect(trimmed).toEqual(['log'])
    expect(bodyOf(url)).not.toContain('<details>')
    expect(bodyOf(url)).toContain('| Selector |')
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
  })

  it('shortens the log to its newest lines before dropping it, and keeps the description whole', () => {
    const logTail = Array.from({ length: 30 }, (_, i) => `[2026-11-06][10:00:${String(i).padStart(2, '0')}][app][INFO] line ${i} ${'z'.repeat(120)}`).join('\n')
    const description = 'Beschreibung '.repeat(200)
    const { url, trimmed, overflow } = buildPrefilledUrl('T', { ...base, logTail, description })
    const body = bodyOf(url)
    expect(trimmed).toEqual(['log'])
    expect(overflow).toBe(false)
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    expect(body).toContain(description)
    expect(body).toContain('line 29 ')
    expect(body).not.toContain('line 0 ')
    const kept = Number(/Log \(last (\d+) lines\)/.exec(body)?.[1])
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(30)
    // The longest tail that fits: one more line would not
    expect(buildPrefilledUrl('T', { ...base, description, logTail: logTail.split('\n').slice(-(kept + 1)).join('\n') }).trimmed).toEqual(['log'])
    expect(body).toContain('| Selector |')
  })

  it('has no log step when there is no log: trimmed never lists log', () => {
    const description = 'ä'.repeat(1180)
    const { trimmed } = buildPrefilledUrl('T', { ...base, description })
    expect(trimmed).toEqual(['context'])
    const { trimmed: none } = buildPrefilledUrl('T', { ...base, description: 'ä'.repeat(4000) })
    expect(none).toEqual(['context'])
  })

  it('shortens, then drops the context table, and never cuts the description', () => {
    const description = 'ä'.repeat(1180) // 6 encoded characters each: about 7 KB
    const { url, trimmed, overflow } = buildPrefilledUrl('T', { ...base, description, logTail: 'log' })
    expect(trimmed).toEqual(['log', 'context'])
    expect(overflow).toBe(false)
    expect(bodyOf(url)).toContain(description)
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    expect(bodyOf(url)).not.toContain('| Selector |')
  })

  it('keeps the whole description and flags overflow when it alone is too long', () => {
    const description = 'ä'.repeat(4000)
    const { url, overflow } = buildPrefilledUrl('T', { ...base, description })
    expect(overflow).toBe(true)
    expect(bodyOf(url)).toContain(description)
  })
})
