import { describe, it, expect, beforeEach } from 'vitest'
import { isReactive } from 'vue'
import {
  LIVE_CHECKPOINT_SECONDS,
  addLiveSecond,
  clearAllLiveSeconds,
  discardLiveSeconds,
  liveSecondsOf,
  liveSecondsState,
  liveTimeSpent,
  takeLiveSeconds,
  unsavedLiveSecondsIds,
} from '~/lib/liveTime'

/**
 * #286: the running seconds of a timed task live here, outside every store, until a checkpoint writes them.
 */
describe('liveTime overlay', () => {
  beforeEach(() => clearAllLiveSeconds())

  it('checkpoints every 10 seconds', () => {
    expect(LIVE_CHECKPOINT_SECONDS).toBe(10)
  })

  it('shows stored time plus the unsaved seconds of the task', () => {
    expect(liveTimeSpent({ id: 'a', timeSpentSeconds: 40 })).toBe(40)
    addLiveSecond('a')
    addLiveSecond('a')
    expect(liveTimeSpent({ id: 'a', timeSpentSeconds: 40 })).toBe(42)
    expect(liveTimeSpent({ id: 'b', timeSpentSeconds: 5 })).toBe(5)
  })

  it('addLiveSecond returns the unsaved count', () => {
    expect(addLiveSecond('a')).toBe(1)
    expect(addLiveSecond('a')).toBe(2)
  })

  it('takeLiveSeconds returns and clears the unsaved seconds', () => {
    addLiveSecond('a')
    addLiveSecond('a')
    expect(takeLiveSeconds('a')).toBe(2)
    expect(liveSecondsOf('a')).toBe(0)
    expect(takeLiveSeconds('a')).toBe(0)
    expect(unsavedLiveSecondsIds()).toEqual([])
  })

  it('discardLiveSeconds drops them without returning them', () => {
    addLiveSecond('a')
    discardLiveSeconds('a')
    expect(liveTimeSpent({ id: 'a', timeSpentSeconds: 7 })).toBe(7)
    expect(unsavedLiveSecondsIds()).toEqual([])
  })

  it('is reactive state, so a card showing it follows the second', () => {
    expect(isReactive(liveSecondsState)).toBe(true)
  })
})
