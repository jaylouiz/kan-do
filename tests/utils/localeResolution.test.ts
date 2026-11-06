import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveLocale,
} from '~/utils/localeResolution'

describe('localeResolution constants', () => {
  it('exposes the supported locales, default and storage key', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en'])
    expect(DEFAULT_LOCALE).toBe('de')
    expect(LOCALE_STORAGE_KEY).toBe('kando-locale')
  })
})

describe('normalizeLocale', () => {
  it('maps regional tags to their supported base locale', () => {
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('DE-at')).toBe('de')
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('de_DE')).toBe('de')
  })

  it('returns null for unsupported or empty input', () => {
    expect(normalizeLocale('fr')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale('   ')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('lets the query param beat everything and persists it', () => {
    expect(resolveLocale({
      queryParam: 'en',
      devOverride: 'de',
      stored: 'de',
      navigatorLanguages: ['de-DE'],
    })).toEqual({ locale: 'en', source: 'query', persist: true })
  })

  it('lets the dev override beat stored and does not persist it', () => {
    expect(resolveLocale({ devOverride: 'en', stored: 'de' }))
      .toEqual({ locale: 'en', source: 'dev', persist: false })
  })

  it('lets the stored locale beat navigator without re-persisting', () => {
    expect(resolveLocale({ stored: 'en', navigatorLanguages: ['de-DE'] }))
      .toEqual({ locale: 'en', source: 'stored', persist: false })
  })

  it('ignores an invalid stored value and falls through to navigator', () => {
    expect(resolveLocale({ stored: 'fr', navigatorLanguages: ['en-US'] }))
      .toEqual({ locale: 'en', source: 'navigator', persist: true })
    expect(resolveLocale({ stored: '', navigatorLanguages: ['en-US'] }))
      .toEqual({ locale: 'en', source: 'navigator', persist: true })
  })

  it('picks the first supported navigator language', () => {
    expect(resolveLocale({ navigatorLanguages: ['fr-FR', 'en-GB', 'de-DE'] }))
      .toEqual({ locale: 'en', source: 'navigator', persist: true })
  })

  it('falls back to the default when nothing is usable', () => {
    const fallback = { locale: 'de', source: 'default', persist: true }
    expect(resolveLocale({ navigatorLanguages: ['fr-FR'] })).toEqual(fallback)
    expect(resolveLocale({ navigatorLanguages: [] })).toEqual(fallback)
    expect(resolveLocale({ navigatorLanguages: null })).toEqual(fallback)
    expect(resolveLocale({})).toEqual(fallback)
  })

  it('ignores an invalid query param', () => {
    expect(resolveLocale({ queryParam: 'xx', stored: 'en' }))
      .toEqual({ locale: 'en', source: 'stored', persist: false })
  })

  it('ignores an invalid dev override', () => {
    expect(resolveLocale({ devOverride: 'fr', stored: 'en' }))
      .toEqual({ locale: 'en', source: 'stored', persist: false })
  })
})
