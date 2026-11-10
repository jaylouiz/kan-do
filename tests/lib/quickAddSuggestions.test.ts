import { describe, it, expect } from 'vitest'
import { activityStep, cleanNewValue, existingValueFor, filterRest, newValueFor, rankValues, timeboxStep, toStep, topicStep } from '~/lib/quickAddSuggestions'

describe('quickAddSuggestions (#649)', () => {
  it('ranks by use, then pool order, ignoring blanks and duplicates', () => {
    expect(rankValues(['B', 'A', 'B', null, ' ', 'C'], ['Z', 'A', 'Y'])).toEqual(['B', 'A', 'C', 'Z', 'Y'])
    expect(rankValues([], [])).toEqual([])
  })

  it('offers two pills and "all options" only with more than two values', () => {
    expect(toStep(['A'])).toEqual({ all: ['A'], suggestions: ['A'], rest: [] })
    expect(toStep(['A', 'B'])).toEqual({ all: ['A', 'B'], suggestions: ['A', 'B'], rest: [] })
    const three = toStep(['A', 'B', 'C'])
    expect(three.suggestions).toEqual(['A', 'B'])
    expect(three.rest).toEqual(['A', 'B', 'C'])
  })

  it('topics: most used first, pool fills up', () => {
    const tasks = [{ topic: 'Design' }, { topic: 'Büro' }, { topic: 'Design' }]
    expect(topicStep(tasks, ['Admin', 'Büro']).all).toEqual(['Design', 'Büro', 'Admin'])
    expect(topicStep([], []).suggestions).toEqual([])
  })

  it('Thema and Aktivität (kd#16): three pills, the Mehr list holds only the values after them', () => {
    const three = topicStep([], ['A', 'B', 'C'])
    expect(three.suggestions).toEqual(['A', 'B', 'C'])
    expect(three.rest).toEqual([])
    const five = activityStep([], ['A', 'B', 'C', 'D', 'E'], null)
    expect(five.suggestions).toEqual(['A', 'B', 'C'])
    expect(five.rest).toEqual(['D', 'E'])
  })

  it('activities: the chosen topic first, then the board', () => {
    const tasks = [
      { topic: 'A', activity: 'Plan' },
      { topic: 'B', activity: 'Code' },
      { topic: 'B', activity: 'Code' },
      { topic: 'A', activity: 'Review' },
    ]
    expect(activityStep(tasks, ['Call'], 'A').all).toEqual(['Plan', 'Review', 'Code', 'Call'])
    expect(activityStep(tasks, ['Call'], null).all).toEqual(['Code', 'Plan', 'Review', 'Call'])
    expect(activityStep(tasks, [], 'Unknown').all).toEqual(['Code', 'Plan', 'Review'])
  })

  it('timebox: history first, presets after; full list behind the third pill', () => {
    expect(timeboxStep(null).suggestions).toEqual(['15', '30', '60'])
    expect(timeboxStep(45).suggestions).toEqual(['45', '15', '30'])
    expect(timeboxStep(30).suggestions).toEqual(['30', '15', '60'])
    expect(timeboxStep(null).rest).toEqual(['15', '30', '45', '60', '90', '120'])
    expect(timeboxStep(50).rest).toEqual(['15', '30', '45', '50', '60', '90', '120'])
    expect(timeboxStep(0).suggestions).toEqual(['15', '30', '60'])
  })

  describe('new values (kd#16)', () => {
    const local = { maxLength: null, stripCommas: false }
    const notion = { maxLength: 100, stripCommas: true }

    it('cleans a new value by the source: spaces always, commas and length for Notion', () => {
      expect(cleanNewValue('  Kunde   A ', local)).toBe('Kunde A')
      expect(cleanNewValue('A, B', local)).toBe('A, B')
      expect(cleanNewValue('A, B', notion)).toBe('A B')
      expect(cleanNewValue(',,', notion)).toBe('')
      expect(cleanNewValue('x'.repeat(120), notion)).toHaveLength(100)
      expect(cleanNewValue('x'.repeat(120), local)).toHaveLength(120)
    })

    it('offers "Neu" only for text no value has (any case) and only when the source allows it', () => {
      expect(newValueFor('Frisch', ['Kunde A'], local)).toBe('Frisch')
      expect(newValueFor('kunde a', ['Kunde A'], local)).toBeNull()
      expect(newValueFor('  ', ['Kunde A'], local)).toBeNull()
      expect(newValueFor('A, B', ['A B'], notion)).toBeNull()
      expect(newValueFor('Frisch', ['Kunde A'], null)).toBeNull()
    })

    it('finds the existing value a text names, with its own spelling', () => {
      expect(existingValueFor('kunde a', ['Kunde A', 'Intern'], local)).toBe('Kunde A')
      expect(existingValueFor('Kunde', ['Kunde A'], local)).toBeNull()
      expect(existingValueFor('', ['Kunde A'], local)).toBeNull()
    })

    it('filters the Mehr list by the text, any case; blank shows everything', () => {
      expect(filterRest(['Büro', 'Kunde A', 'Kunde B'], ' kunde ')).toEqual(['Kunde A', 'Kunde B'])
      expect(filterRest(['Büro'], 'xyz')).toEqual([])
      expect(filterRest(['Büro', 'Kunde A'], '')).toEqual(['Büro', 'Kunde A'])
    })
  })
})
