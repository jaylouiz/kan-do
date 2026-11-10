import { describe, expect, it } from 'vitest'
import { MIDDLE_TAIL_GRAPHEMES, splitMiddle } from '~/utils/middleEllipsis'

/** The plain tail, without the word rule */
const plain = (value: string, tail: number) => splitMiddle(value, { tail, word: 0 })

describe('splitMiddle (kd#119)', () => {
  it('never changes the name: head and tail are the whole value', () => {
    for (const value of ['', 'A', 'Büro', 'Karriere: Bewerbung', 'Zwei  Leerzeichen ', '👩‍👩‍👧‍👦 Familie 🇩🇪']) {
      for (const split of [splitMiddle(value), plain(value, 1), plain(value, 5)]) expect(split.head + split.tail).toBe(value)
    }
  })

  it('a short name keeps its start: the tail is at most half of it, none for one character', () => {
    expect(splitMiddle('')).toEqual({ head: '', tail: '' })
    expect(splitMiddle('A')).toEqual({ head: 'A', tail: '' })
    expect(splitMiddle('Büro')).toEqual({ head: 'Bü', tail: 'ro' })
    expect(splitMiddle('Design')).toEqual({ head: 'Des', tail: 'ign' })
    // the last word is more than half the name: it is not kept whole
    expect(splitMiddle('Zu Hause')).toEqual({ head: 'Zu H', tail: 'ause' })
  })

  it('two topics with the same beginning end up with different tails', () => {
    const a = splitMiddle('Karriere: Bewerbung')
    const b = splitMiddle('Karriere: Weiterbildung')
    // both last words are longer than 7 graphemes: the last 5
    expect(a).toEqual({ head: 'Karriere: Bewe', tail: 'rbung' })
    expect(b).toEqual({ head: 'Karriere: Weiterbi', tail: 'ldung' })
    expect(a.tail).not.toBe(b.tail)
    expect(b.tail).toHaveLength(MIDDLE_TAIL_GRAPHEMES)
    // with room for a longer word the whole last word shows
    expect(splitMiddle('Karriere: Bewerbung', { word: 9 }).tail).toBe('Bewerbung')
  })

  it('two topics with the same ending keep different heads', () => {
    const a = splitMiddle('Bewerbung Karriere')
    const b = splitMiddle('Weiterbildung Karriere')
    expect(a.tail).toBe('riere')
    expect(b.tail).toBe('riere')
    expect(a.head).not.toBe(b.head)
  })

  it('the tail starts at a word: after white space, a colon, a slash or a hyphen; a last word under 3 graphemes takes the one before along', () => {
    expect(splitMiddle('Kunde Müller: Angebot').tail).toBe('Angebot')
    expect(splitMiddle('Kunde Müller/Angebot').tail).toBe('Angebot')
    expect(splitMiddle('Quartal 3-Planung').tail).toBe('Planung')
    expect(splitMiddle('Projekt Kunde A').tail).toBe('Kunde A')
    expect(splitMiddle('Kunde A: Büro 12345').tail).toBe('12345')
    // no word boundary in reach: the plain tail
    expect(splitMiddle('Donaudampfschifffahrt').tail).toBe('fahrt')
    expect(splitMiddle('Kunde Müller: Abrechnungen').tail).toBe('ungen')
  })

  it('very narrow: a tail of one grapheme, and none at all below one', () => {
    expect(plain('Karriere: Bewerbung', 1)).toEqual({ head: 'Karriere: Bewerbun', tail: 'g' })
    expect(plain('Karriere: Bewerbung', 0)).toEqual({ head: 'Karriere: Bewerbung', tail: '' })
    expect(splitMiddle('Karriere: Bewerbung', { tail: 0 })).toEqual({ head: 'Karriere: Bewerbung', tail: '' })
    expect(plain('Karriere: Bewerbung', -3)).toEqual({ head: 'Karriere: Bewerbung', tail: '' })
    expect(plain('Karriere: Bewerbung', 2.9).tail).toBe('ng')
  })

  it('the tail never starts with white space', () => {
    expect(plain('Kunde A: Büro 12345', 6)).toEqual({ head: 'Kunde A: Büro ', tail: '12345' })
    // nothing but white space where the tail would be: no tail
    expect(plain('ab  ', 2)).toEqual({ head: 'ab  ', tail: '' })
  })

  it('never breaks a grapheme: emoji with joiners, flags, skin tones and combining marks stay whole', () => {
    const family = '👩‍👩‍👧‍👦'
    expect(plain(`Familie ${family}`, 1)).toEqual({ head: 'Familie ', tail: family })
    expect(plain('Reise 🇩🇪🇫🇷', 1).tail).toBe('🇫🇷')
    expect(plain('Daumen 👍🏽', 1).tail).toBe('👍🏽')
    // "ü" typed as u + combining diaeresis is one character to the user
    expect(plain('Büro', 2)).toEqual({ head: 'Bü', tail: 'ro' })
    expect(plain('Menü', 1).tail).toBe('ü')
    expect(splitMiddle(`Haushalt ${family} Familienorganisation`).tail).toBe('ation')
  })
})
