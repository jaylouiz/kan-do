/**
 * #320: the pure state transitions of connect and disconnect on `boardConfig.sources`, as sequences.
 * The async flows (fetch, Keychain, flush) are in tests/composables/useSourceConnections.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { normalizeBoardConfig } from '~/lib/taskSources'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('connectIntegration / disconnectIntegration', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('connect only adds: the default stays, a second connect and a never-onboarded board are no-ops', () => {
    const board = useBoardStore()
    expect(board.connectIntegration('notion')).toBe(false) // never onboarded: the welcome flow picks the first source
    expect(board.boardConfig.sources).toBeNull()

    board.setSingleSource('local')
    expect(board.connectIntegration('notion')).toBe(true)
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
    expect(board.connectIntegration('notion')).toBe(false)
    expect(board.connectIntegration('todoist')).toBe(true)
    expect(board.boardConfig.sources).toEqual({ connected: ['notion', 'todoist'], default: 'local' })
  })

  it('disconnect removes one source and falls back to Local only when it was the default', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion', 'todoist'], default: 'notion' })

    expect(board.disconnectIntegration('todoist')).toBe(true)
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })
    expect(board.disconnectIntegration('todoist')).toBe(false)
    expect(board.disconnectIntegration('notion')).toBe(true)
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(board.disconnectIntegration('local' as never)).toBe(false) // Local is not a connection
  })

  it('a pending source switch survives a connect and a disconnect of another source, not its own disconnect', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    tasks.beginSourceSwitch('notion')
    expect(board.isSourceSwitchPending).toBe(true)

    board.connectIntegration('todoist')
    expect(board.isSourceSwitchPending).toBe(true)
    board.disconnectIntegration('todoist')
    expect(board.isSourceSwitchPending).toBe(true)
    board.disconnectIntegration('notion') // the target the switch was waiting for is gone
    expect(board.isSourceSwitchPending).toBe(false)
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
  })

  it('every state it produces is a fixed point of the hydrate normaliser (the write-back compares by value, #273)', () => {
    const board = useBoardStore()
    board.setSingleSource('local')
    board.connectIntegration('notion')
    const connected = board.boardConfig
    expect(normalizeBoardConfig(connected)).toEqual(connected)
    board.disconnectIntegration('notion')
    expect(normalizeBoardConfig(board.boardConfig)).toEqual(board.boardConfig)
  })
})

describe('disconnectSource (tasks store)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('removes only that source from tasks, columns and queues, in one step', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    tasks.setTasks([task('l-1', 'local'), task('n-1', 'notion'), task('n-2', 'notion', { status: TaskStatus.Done })])
    tasks.addPendingTimeUpdate('n-1', 10)
    tasks.addPendingTimeUpdate('l-1', 10) // a Local task queues nothing

    const removed = tasks.disconnectSource('notion')

    expect(removed.sort()).toEqual(['n-1', 'n-2'])
    expect(tasks.tasks.map((t) => t.id)).toEqual(['l-1'])
    expect(board.columns.flatMap((c) => c.taskOrder)).toEqual(['l-1'])
    expect(tasks.pendingTimeUpdates).toEqual({})
    expect(tasks.deletedTaskIds).toEqual([]) // a disconnect is not a delete: nothing may hide the tasks on reconnect
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
  })
})
