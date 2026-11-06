import { describe, it, expect } from 'vitest'
import { activityStep, rankValues, timeboxStep, toStep, topicStep } from '~/lib/quickAddSuggestions'

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
    expect(timeboxStep(null).suggestions).toEqual(['15', '30'])
    expect(timeboxStep(45).suggestions).toEqual(['45', '15'])
    expect(timeboxStep(30).suggestions).toEqual(['30', '15'])
    expect(timeboxStep(null).rest).toEqual(['15', '30', '45', '60', '90', '120'])
    expect(timeboxStep(50).rest).toEqual(['15', '30', '45', '50', '60', '90', '120'])
    expect(timeboxStep(0).suggestions).toEqual(['15', '30'])
  })
})
