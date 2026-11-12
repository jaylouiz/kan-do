import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { DND_MOTION, useDropMotion } from '~/composables/useDropMotion'

/** The end of a drag as motion (kd#181): landing while the preview glides, then one set-down, driven by the drag code */
describe('useDropMotion', () => {
  const { dragState } = useBoardDragState()
  const motion = useDropMotion()

  beforeEach(() => {
    vi.useFakeTimers()
    motion.reset()
  })
  afterEach(() => {
    motion.reset()
    vi.useRealTimers()
  })

  it('marks the dropped card as landing, then sets it down for one animation', () => {
    motion.land('a', null)
    expect(dragState.value).toMatchObject({ landingTaskId: 'a', setDownTaskId: null })

    motion.setDown()
    expect(dragState.value).toMatchObject({ landingTaskId: null, landingStack: null, setDownTaskId: 'a' })

    vi.advanceTimersByTime(DND_MOTION.setDownMs)
    expect(dragState.value.setDownTaskId).toBeNull()
  })

  it('keeps the dragged stack for the gliding preview and drops it with the landing', () => {
    const stack = { key: 'k', label: 'Topic', taskIds: ['a', 'b'] }
    motion.land('a', stack)
    expect(dragState.value.landingStack).toEqual(stack)
    motion.setDown()
    expect(dragState.value.landingStack).toBeNull()
  })

  it('sets the card down on its own when dnd-kit runs no drop animation', () => {
    motion.land('a', null)
    vi.advanceTimersByTime(DND_MOTION.dropMs + 150)
    expect(dragState.value).toMatchObject({ landingTaskId: null, setDownTaskId: 'a' })
  })

  it('a second drop takes over: the first card loses its mark and its timer cannot clear the second', () => {
    motion.land('a', null)
    motion.setDown()
    vi.advanceTimersByTime(DND_MOTION.setDownMs / 2)

    motion.land('b', null)
    expect(dragState.value).toMatchObject({ landingTaskId: 'b', setDownTaskId: null })
    motion.setDown()
    vi.advanceTimersByTime(DND_MOTION.setDownMs / 2)
    expect(dragState.value.setDownTaskId).toBe('b')
    vi.advanceTimersByTime(DND_MOTION.setDownMs / 2)
    expect(dragState.value.setDownTaskId).toBeNull()
  })

  it('reset (a new drag starts) clears both marks and the pending timers', () => {
    motion.land('a', null)
    motion.reset()
    vi.advanceTimersByTime(1000)
    expect(dragState.value).toMatchObject({ landingTaskId: null, landingStack: null, setDownTaskId: null })
  })

  it('setDown without a landing does nothing', () => {
    motion.setDown()
    expect(dragState.value.setDownTaskId).toBeNull()
  })

  it('under reduced motion the landing still ends with the set-down mark: it keeps the card transitions off (kd#225)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    motion.land('a', null)
    motion.setDown()
    expect(dragState.value).toMatchObject({ landingTaskId: null, setDownTaskId: 'a' })
    vi.unstubAllGlobals()
  })
})
