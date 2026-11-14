import { describe, it, expect } from 'vitest'
import { finishedFasterThanPlan } from '~/lib/completionPace'

describe('finishedFasterThanPlan (#295)', () => {
  it.each([
    ['below the box', 2700, 1200, true],
    ['one second below', 2700, 2699, true],
    ['exactly on the box', 2700, 2700, false],
    ['over the box', 2700, 3000, false],
    ['never run (0 s spent)', 2700, 0, false],
    ['no timebox', null, 1200, false],
    ['a zero timebox', 0, 1200, false],
  ])('%s', (_label, timeBoxSeconds, timeSpentSeconds, expected) => {
    expect(finishedFasterThanPlan({ timeBoxSeconds, timeSpentSeconds } as never)).toBe(expected)
  })

  it('is false for an unknown task', () => {
    expect(finishedFasterThanPlan(null)).toBe(false)
    expect(finishedFasterThanPlan(undefined)).toBe(false)
  })
})
