import { describe, it, expect, vi, afterEach } from 'vitest'

const navigateTo = vi.hoisted(() => vi.fn(async () => {}))
vi.stubGlobal('navigateTo', navigateTo)

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
