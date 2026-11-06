import { describe, expect, it, vi } from 'vitest'
import { bulletsFor, latestWithHighlights, parseBundle, retryingOnce, versionsToShow, type BundledNotes } from '~/lib/releaseNotes'
import { getUpdateNotes } from '~/lib/updateNotes'
import { setTestLocale } from '../helpers/i18n'

const hl = (n: string) => ({ de: [{ title: `D${n}.`, text: 'de' }], en: [{ title: `E${n}.`, text: 'en' }] })
const bundle: BundledNotes[] = [
  { version: '0.4.0', highlights: hl('4') },
  { version: '0.3.0', highlights: null },
  { version: '0.2.0', highlights: hl('2') },
  { version: '0.1.0', highlights: hl('1') },
]

describe('versionsToShow', () => {
  it('lists every version in between, newest first, and skips None.', () => {
    expect(versionsToShow(bundle, '0.1.0', '0.4.0', 'en').map(e => e.version)).toEqual(['0.4.0', '0.2.0'])
  })
  it('excludes versions newer than the running one and the last-seen itself', () => {
    expect(versionsToShow(bundle, '0.1.0', '0.2.0', 'de').map(e => e.version)).toEqual(['0.2.0'])
    expect(versionsToShow(bundle, '0.2.0', '0.2.0', 'de')).toEqual([])
  })
  it('shows nothing on a downgrade or when only None. versions remain', () => {
    expect(versionsToShow(bundle, '0.4.0', '0.2.0', 'de')).toEqual([])
    expect(versionsToShow(bundle, '0.2.0', '0.3.0', 'de')).toEqual([])
  })
  it('picks the locale', () => {
    expect(versionsToShow(bundle, '0.0.0', '0.1.0', 'en')[0]?.bullets[0]?.title).toBe('E1.')
    expect(versionsToShow(bundle, '0.0.0', '0.1.0', 'de')[0]?.bullets[0]?.title).toBe('D1.')
  })
})

describe('latestWithHighlights', () => {
  it('takes the n newest with highlights, up to the running version', () => {
    expect(latestWithHighlights(bundle, 2, 'de').map(e => e.version)).toEqual(['0.4.0', '0.2.0'])
    expect(latestWithHighlights(bundle, 5, 'de', '0.2.0').map(e => e.version)).toEqual(['0.2.0', '0.1.0'])
  })
  it('is empty when no version has highlights', () => {
    expect(latestWithHighlights([{ version: '0.1.0', highlights: null }], 5, 'de')).toEqual([])
  })
})

describe('bulletsFor', () => {
  it('falls back to de when the locale subsection is empty', () => {
    expect(bulletsFor({ de: hl('1').de, en: [] }, 'en')[0]?.title).toBe('D1.')
  })
})

describe('parseBundle', () => {
  it('parses files by version, skips broken and non-version files, newest first', () => {
    const files = {
      '/release-notes/0.1.0.md': '## Highlights\nNone.',
      '/release-notes/0.2.0.md': '## Highlights\n### de\n- **A.** a\n### en\n- **A.** a',
      '/release-notes/0.3.0.md': 'broken',
      '/release-notes/README.md': '# readme',
    }
    expect(parseBundle(files).map(e => e.version)).toEqual(['0.2.0', '0.1.0'])
  })
})

describe('getUpdateNotes', () => {
  const notes = '## Highlights\n### de\n- **Deutsch.** Text.\n### en\n- **English.** Text.\n\n## Fixes\n- secret'
  const update = (value: string | null) => ({ version: '0.2.0', currentVersion: '0.1.0', notes: value, publishedAt: null })

  it('returns the locale highlights and never the fixes', () => {
    expect(getUpdateNotes(update(notes))).toEqual([{ title: 'Deutsch.', text: 'Text.' }])
    setTestLocale('en')
    expect(getUpdateNotes(update(notes))).toEqual([{ title: 'English.', text: 'Text.' }])
  })
  it('returns null for missing, None. and unparseable notes', () => {
    expect(getUpdateNotes(update(null))).toBeNull()
    expect(getUpdateNotes(update('## Highlights\nNone.'))).toBeNull()
    expect(getUpdateNotes(update('Raw release body'))).toBeNull()
  })
})

describe('retryingOnce', () => {
  it('caches a success', async () => {
    const load = vi.fn(async () => 1)
    const get = retryingOnce(load)
    await get()
    await get()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejection: the next call retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(2)
    const get = retryingOnce(load)
    await expect(get()).rejects.toThrow('boom')
    await expect(get()).resolves.toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
