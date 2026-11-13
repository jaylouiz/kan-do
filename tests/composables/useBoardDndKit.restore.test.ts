/**
 * restoreDraggedElement's last resort (#248): a card put back into an Offen list that holds no other card must land
 * after the add slot's draft (the slot sits at the start of the list now), before the drop zone, never before the slot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { sourceOf, switchSource } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))

const makeTask = (id: string): Task => ({
  id, ...sourceOf(id),
  title: id,
  status: TaskStatus.Open,
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
})

describe('useBoardDndKit: a canceled drag restores the node into a list with an add slot (#248)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    switchSource('local')
    useTasksStore().addTask(makeTask('only'))
  })
  afterEach(() => { document.body.innerHTML = '' })

  const listWith = (...children: string[]) => {
    const list = document.createElement('div')
    list.setAttribute('data-task-status', String(TaskStatus.Open))
    for (const cls of children) {
      const el = document.createElement('div')
      el.className = cls
      list.appendChild(el)
    }
    document.body.appendChild(list)
    return list
  }

  const cancelDragOf = (element: HTMLElement) => {
    const kit = useBoardDndKit()
    kit.onDragStart({ operation: { source: { id: 'only', group: TaskStatus.Open, element } } })
    return kit
  }

  it.each([
    ['an open draft', ['add-task-slot', 'column-drop-zone']],
    ['no slot', ['column-drop-zone']],
  ])('puts the card after the slot and before the drop zone with %s', (_name, children) => {
    const list = listWith(...children)
    const node = document.createElement('div')
    node.className = 'task-wrapper'
    node.setAttribute('data-task-id', 'only')
    list.insertBefore(node, list.firstChild) // dnd-kit's preview moved it
    const kit = cancelDragOf(node)
    // dnd-kit parked the node in another list, the origin list lost it
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    elsewhere.appendChild(node)
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
    expect([...list.children].map((el) => el.className)).toEqual(
      children.includes('add-task-slot') ? ['add-task-slot', 'task-wrapper', 'column-drop-zone'] : ['task-wrapper', 'column-drop-zone'],
    )
  })
})
