/**
 * #296: the card menu's quick actions: Start now and Mark done on top, Copy title, Duplicate and Open in source
 * before Delete. Each is the same code path as its other surfaces (move/swap, createTask, openExternal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { setTestLocale } from '../helpers/i18n'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
const moveOrSwapToStatus = vi.fn(async () => true)
const canMoveOrSwapToStatus = vi.fn((_id: string, _status: TaskStatus) => ({ allowed: true }) as { allowed: boolean, reason?: string })
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveOrSwapToStatus, canMoveOrSwapToStatus }),
}))
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }) }))
vi.mock('~/composables/useTaskMove', () => ({ useTaskMove: () => ({ moveTaskToSource: vi.fn() }) }))
const createTask = vi.fn(async (draft: Partial<Task>, source: string) => ({ ...draft, id: 'new', source }) as Task)
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ createTask }) }))
const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => {}))
vi.mock('~/utils/openExternal', () => ({ openExternal }))
const handleError = vi.hoisted(() => vi.fn())
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError }) }))
const toastAdd = vi.hoisted(() => vi.fn())
vi.mock('#imports', () => ({ useToast: () => ({ add: toastAdd }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskContextMenu } from '~/composables/useTaskContextMenu'
import { useTasksStore } from '~/store/tasks'
/* eslint-enable import/first */

type Item = { label?: string, disabled?: boolean, children?: Item[], onSelect?: () => void }

const makeTask = (extra: Partial<Task> = {}): Task => ({
  id: 'a', source: 'local', externalId: null, title: 'Write report', status: TaskStatus.Open, activity: null, topic: 'Q4', topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: 1500, timeSpentSeconds: 0, timerId: null, ...extra,
})

describe('useTaskContextMenu: quick actions (#296)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    for (const fn of [moveOrSwapToStatus, createTask, openExternal, handleError, toastAdd]) fn.mockClear()
    canMoveOrSwapToStatus.mockReset().mockReturnValue({ allowed: true })
    setTestLocale('de')
  })

  const groupsOf = (task: Task): Item[][] => {
    useTasksStore().setTasks([task])
    return useTaskContextMenu(ref(task)).menuItems.value as Item[][]
  }
  const itemOf = (task: Task, label: string): Item | undefined => groupsOf(task).flat().find(i => i.label === label)

  it('puts Start now and Mark done on top, the copy group before Delete', () => {
    const groups = groupsOf(makeTask())
    expect(groups[0]!.map(i => i.label)).toEqual(['Jetzt starten', 'Als erledigt markieren'])
    expect(groups.at(-1)!.map(i => i.label)).toEqual(['Löschen'])
    expect(groups.at(-2)!.map(i => i.label)).toEqual(['Titel kopieren', 'Duplizieren'])
  })

  it('Start now moves through the swap-aware path; it is disabled when already in Jetzt', () => {
    itemOf(makeTask(), 'Jetzt starten')!.onSelect!()
    expect(moveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Progress)
    expect(itemOf(makeTask({ status: TaskStatus.Progress }), 'Jetzt starten')!.disabled).toBe(true)
  })

  it('Start now follows the Jetzt limit: refused means disabled with the reason', () => {
    canMoveOrSwapToStatus.mockImplementation((_id, status) => status === TaskStatus.Progress ? { allowed: false, reason: 'progressFull' } : { allowed: true })
    const item = itemOf(makeTask(), 'Jetzt starten (max. erreicht)')!
    expect(item.disabled).toBe(true)
  })

  it('Mark done moves to Erledigt; it is disabled when the task is done', () => {
    itemOf(makeTask(), 'Als erledigt markieren')!.onSelect!()
    expect(moveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Done)
    expect(itemOf(makeTask({ status: TaskStatus.Done }), 'Als erledigt markieren')!.disabled).toBe(true)
  })

  it('Copy title writes the title to the clipboard and confirms with a toast', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await (itemOf(makeTask(), 'Titel kopieren')!.onSelect as () => Promise<void>)()
    expect(writeText).toHaveBeenCalledWith('Write report')
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Titel kopiert' }))
  })

  it('a clipboard failure goes to the error handler, not into the void', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await (itemOf(makeTask(), 'Titel kopieren')!.onSelect as () => Promise<void>)()
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'copy_title')
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('Duplicate creates the copy in the same source from the draft and confirms with a toast', async () => {
    await (itemOf(makeTask({ source: 'notion', externalId: 'p1' }), 'Duplizieren')!.onSelect as () => Promise<void>)()
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write report', status: TaskStatus.Open, timeBoxSeconds: 1500, timeSpentSeconds: 0 }), 'notion')
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Aufgabe dupliziert' }))
  })

  it('a rejected create is reported, with no success toast', async () => {
    createTask.mockRejectedValueOnce(new Error('refused'))
    await (itemOf(makeTask(), 'Duplizieren')!.onSelect as () => Promise<void>)()
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'task_create')
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('Open in source is offered only for a task the source holds, and opens its page', () => {
    expect(itemOf(makeTask(), 'In Notion öffnen')).toBeUndefined()
    expect(itemOf(makeTask({ source: 'notion', externalId: null }), 'In Notion öffnen')).toBeUndefined()
    itemOf(makeTask({ source: 'notion', externalId: 'ab-cd' }), 'In Notion öffnen')!.onSelect!()
    expect(openExternal).toHaveBeenCalledWith('https://www.notion.so/abcd')
  })

  it('English labels', () => {
    setTestLocale('en')
    const labels = groupsOf(makeTask({ source: 'notion', externalId: 'p1' })).flat().map(i => i.label)
    expect(labels).toEqual(expect.arrayContaining(['Start now', 'Mark as done', 'Copy title', 'Duplicate', 'Open in Notion']))
  })

  it('Duplicate is hidden where the source cannot create tasks (Todoist); Copy title and Open stay', () => {
    const labels = groupsOf(makeTask({ source: 'todoist', externalId: 't1' })).flat().map(i => i.label)
    expect(labels).toEqual(expect.arrayContaining(['Titel kopieren', 'In Todoist öffnen']))
    expect(labels).not.toContain('Duplizieren')
  })

  it('has no leading icon on the new items', () => {
    const items = groupsOf(makeTask({ source: 'notion', externalId: 'p1' })).flat() as Array<Item & { icon?: string }>
    expect(items.filter(i => i.icon)).toEqual([])
  })
})
