import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDayClose, useDayCloseData } from '~/composables/useDayClose'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const makeTask = (id: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

describe('useDayClose open state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDayClose().close()
    document.body.innerHTML = ''
  })

  it('is shared between callers: the dock button and the palette see the same state', () => {
    const dock = useDayClose()
    const palette = useDayClose()
    expect(dock.isOpen.value).toBe(false)
    palette.open()
    expect(dock.isOpen.value).toBe(true)
    dock.close()
    expect(palette.isOpen.value).toBe(false)
  })

  it('remembers the focused trigger and restores focus to it after closing', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const dayClose = useDayClose()
    dayClose.open()
    trigger.blur()
    dayClose.close()
    dayClose.restoreFocus()
    expect(document.activeElement).toBe(trigger)
  })

  it('falls back to the board when the trigger is gone (palette closed first)', () => {
    const board = document.createElement('main')
    board.setAttribute('data-task-sheet-return', '')
    document.body.append(board)
    const gone = document.createElement('input')
    document.body.append(gone)
    gone.focus()
    const dayClose = useDayClose()
    dayClose.open()
    gone.remove()
    dayClose.close()
    dayClose.restoreFocus()
    expect(document.activeElement).toBe(board)
  })

  it('opening and closing never touches task data', () => {
    setActivePinia(createPinia())
    const store = useTasksStore()
    store.addTask(makeTask('a', TaskStatus.Open))
    const before = JSON.stringify(store.tasks)
    const dayClose = useDayClose()
    dayClose.open()
    dayClose.close()
    expect(JSON.stringify(store.tasks)).toBe(before)
  })
})

describe('useDayCloseData selection', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('lists only tasks completed today and sums their time; archived and yesterday are excluded', () => {
    const store = useTasksStore()
    const yesterday = new Date(Date.now() - 36 * 3_600_000)
    store.addTask(makeTask('today', TaskStatus.Done, { completedAt: new Date(), timeSpentSeconds: 600 }))
    store.addTask(makeTask('today2', TaskStatus.Done, { completedAt: new Date(), timeSpentSeconds: 300 }))
    store.addTask(makeTask('old', TaskStatus.Done, { completedAt: yesterday, timeSpentSeconds: 9999 }))
    store.addTask(makeTask('archived', TaskStatus.Done, { completedAt: new Date(), timeSpentSeconds: 1000 }))
    store.archiveTasks(['archived'])

    const { done, totalSeconds } = useDayCloseData()
    expect(done.value.map(t => t.id).sort()).toEqual(['today', 'today2'])
    expect(totalSeconds.value).toBe(900)
  })

  it('lists Offen, Jetzt and Wartet in column order and never Erledigt', () => {
    const store = useTasksStore()
    store.addTask(makeTask('w', TaskStatus.Waiting))
    store.addTask(makeTask('o', TaskStatus.Open))
    store.addTask(makeTask('p', TaskStatus.Progress))
    store.addTask(makeTask('d', TaskStatus.Done, { completedAt: new Date() }))
    const { inFlight } = useDayCloseData()
    expect(inFlight.value.map(t => t.id)).toEqual(['o', 'p', 'w'])
  })

  it('lists tasks of every source together, in the same rows and sums (#325)', () => {
    const store = useTasksStore()
    store.addTask(makeTask('n-done', TaskStatus.Done, { source: 'notion', externalId: 'n-done', completedAt: new Date(), timeSpentSeconds: 600 }))
    store.addTask(makeTask('l-done', TaskStatus.Done, { completedAt: new Date(), timeSpentSeconds: 300 }))
    store.addTask(makeTask('n-open', TaskStatus.Open, { source: 'notion', externalId: 'n-open' }))
    store.addTask(makeTask('l-wait', TaskStatus.Waiting))
    store.addTask(makeTask('l-old', TaskStatus.Done, { completedAt: new Date(Date.now() - 36 * 3_600_000), timeSpentSeconds: 9999 }))

    const { done, totalSeconds, inFlight } = useDayCloseData()
    expect(done.value.map(t => t.id).sort()).toEqual(['l-done', 'n-done'])
    expect(totalSeconds.value).toBe(900)
    expect(inFlight.value.map(t => t.id)).toEqual(['n-open', 'l-wait'])
  })
})
