import { describe, it, expect } from 'vitest'
import { createTestI18n } from '../helpers/i18n'

describe('task.carryOver.question plural (#247)', () => {
  const ask = (locale: 'de' | 'en', n: number) =>
    createTestI18n(locale).global.t('task.carryOver.question', { n }, n)

  it('is singular for one day and plural otherwise, de', () => {
    expect(ask('de', 1)).toBe('Die Aufgabe ist seit 1 Tag zur Erledigung eingeplant. Ist sie wirklich wichtig?')
    expect(ask('de', 3)).toBe('Die Aufgabe ist seit 3 Tagen zur Erledigung eingeplant. Ist sie wirklich wichtig?')
  })

  it('is singular for one day and plural otherwise, en', () => {
    expect(ask('en', 1)).toBe('This task has been planned for 1 day. Does it really matter?')
    expect(ask('en', 3)).toBe('This task has been planned for 3 days. Does it really matter?')
  })
})
