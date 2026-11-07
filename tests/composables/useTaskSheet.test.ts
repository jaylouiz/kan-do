import { describe, it, expect, vi, afterEach } from 'vitest'

const navigateTo = vi.hoisted(() => vi.fn(async () => {}))
vi.stubGlobal('navigateTo', navigateTo)
vi.stubGlobal('useRouter', () => ({ options: { history: { state: { back: null } } }, back: vi.fn(), afterEach: vi.fn(() => () => {}) }))

const { useTaskSheet } = await import('~/composables/useTaskSheet')

describe('useTaskSheet return focus (#125)', () => {
  afterEach(async () => {
    const sheet = useTaskSheet()
    await sheet.finishClose()
    sheet.resetTaskSheet()
    sheet.takeReturnFocusTaskId()
  })

  it('has no focus target for a plain close', () => {
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet()
    expect(sheet.takeReturnFocusTaskId()).toBeNull()
  })

  it('remembers the saved card for exactly one close', () => {
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet({ focusTaskId: 'local_1' })
    expect(sheet.takeReturnFocusTaskId()).toBe('local_1')
    expect(sheet.takeReturnFocusTaskId()).toBeNull()
  })

  it('a fresh close does not inherit the target of an earlier close', async () => {
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet({ focusTaskId: 'local_1' })
    await sheet.finishClose()
    sheet.resetTaskSheet()
    void sheet.closeTaskSheet()
    expect(sheet.takeReturnFocusTaskId()).toBeNull()
  })

  it('a repeated close request keeps the saved card', () => {
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet({ focusTaskId: 'local_1' })
    void sheet.closeTaskSheet()
    expect(sheet.takeReturnFocusTaskId()).toBe('local_1')
  })

  it('a close dropped by a route change forgets its target', () => {
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet({ focusTaskId: 'local_1' })
    sheet.resetTaskSheet()
    expect(sheet.takeReturnFocusTaskId()).toBeNull()
  })
})

describe('useTaskSheet close navigation (#22)', () => {
  const setup = (back: string | null) => {
    const hooks: Array<() => void> = []
    const router = {
      options: { history: { state: { back } } },
      back: vi.fn(() => { hooks.splice(0).forEach(h => h()) }),
      afterEach: vi.fn((h: () => void) => { hooks.push(h); return () => {} }),
    }
    vi.stubGlobal('useRouter', () => router)
    navigateTo.mockClear()
    return router
  }

  it('goes back when the sheet was opened from the board', async () => {
    const router = setup('/tasks')
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet()
    await sheet.finishClose()
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it.each([null, '/statistics', '/tasks/other'])('replaces /tasks when the previous entry is %s', async (back) => {
    const router = setup(back)
    const sheet = useTaskSheet()
    void sheet.closeTaskSheet()
    await sheet.finishClose()
    expect(router.back).not.toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith('/tasks', { replace: true })
  })
})
