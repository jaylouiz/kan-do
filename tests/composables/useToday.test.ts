import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves to the next local day at midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 22, 23, 59, 0))
    const { useToday } = await import('~/composables/useToday')
    const { today } = useToday()
    expect(today.value.getDate()).toBe(22)
    vi.advanceTimersByTime(2 * 60_000)
    expect(today.value.getDate()).toBe(23)
  })

  it('refreshes on visibilitychange', async () => {
    vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 0))
    const { useToday } = await import('~/composables/useToday')
    const { today } = useToday()
    vi.setSystemTime(new Date(2026, 9, 24, 10, 0, 0))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(today.value.getDate()).toBe(24)
  })
})
