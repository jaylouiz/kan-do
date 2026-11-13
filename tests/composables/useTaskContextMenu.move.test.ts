/**
 * #322: the "Verschieben nach …" group of the card context menu. It sits in its own group between "Timebox
 * setzen" and "Löschen", offers one child per other connected source with the hint as the child's second line, and
 * is absent when only one source is connected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { setTestLocale } from '../helpers/i18n'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveOrSwapToStatus: vi.fn(), canMoveOrSwapToStatus: () => ({ allowed: true }) }),
}))
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }) }))
const moveTaskToSource = vi.fn()
vi.mock('~/composables/useTaskMove', () => ({ useTaskMove: () => ({ moveTaskToSource }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskContextMenu } from '~/composables/useTaskContextMenu'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

type Item = { label?: string; type?: string; description?: string; disabled?: boolean; icon?: string; children?: Item[]; onSelect?: () => void }

const makeTask = (extra: Partial<Task> = {}): Task => ({
  id: 'a', source: 'local', externalId: null, title: 'A', status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

describe('useTaskContextMenu: move to another source (#322)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    moveTaskToSource.mockReset()
    setTestLocale('de')
  })

  const groupsOf = (task: Task): Item[][] => {
    useTasksStore().setTasks([task])
    return useTaskContextMenu(ref(task)).menuItems.value as Item[][]
  }

  it('Local only: no entry in any group', () => {
    useBoardStore().setSources({ connected: [], default: 'local' })
    const groups = groupsOf(makeTask())
    expect(groups.flat().some(i => i.label === 'Verschieben nach …')).toBe(false)
    expect(groups).toHaveLength(6)
  })

  it('its own group sits between "Timebox setzen" and "Löschen"', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const groups = groupsOf(makeTask())
    const labels = groups.map(g => g[0]!.label)
    expect(labels.indexOf('Verschieben nach …')).toBe(labels.indexOf('Timebox setzen') + 1)
    expect(labels.indexOf('Löschen')).toBe(labels.indexOf('Verschieben nach …') + 1)
    expect(groups.find(g => g[0]!.label === 'Verschieben nach …')).toHaveLength(1)
  })

  it('has no leading icon on any item, at any depth (#338)', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const walk = (items: Item[]): Item[] => items.flatMap(i => [i, ...walk(i.children ?? [])])
    const all = walk(groupsOf(makeTask({ priority: 3, topic: 'x', timeBoxSeconds: 900 })).flat())
    expect(all.length).toBeGreaterThan(10)
    expect(all.filter(i => i.icon)).toEqual([])
  })

  it('offers every other source (not the current one) with name and the hint as second line, no icon (#338)', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const entry = groupsOf(makeTask({ priority: 3, topic: 'x' })).flat().find(i => i.label === 'Verschieben nach …')!
    expect(entry.children).toHaveLength(1)
    expect(entry.children![0]).toMatchObject({ label: 'Notion', disabled: false })
    expect(entry.children![0]!.icon).toBeUndefined()
    // Notion without a property mapping holds neither priority nor topic
    expect(entry.children![0]!.description).toBe('2 Felder gehen verloren')
  })

  it('from Notion the Local child is offered, and a child without anything to say has no description', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const entry = groupsOf(makeTask({ source: 'notion', externalId: 'p1' })).flat().find(i => i.label === 'Verschieben nach …')!
    expect(entry.children!.map(c => c.label)).toEqual(['Lokal'])
    expect(entry.children![0]).not.toHaveProperty('description')
  })

  it('a target that needs attention says so; selecting a child moves the task', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useIntegrationHealthStore().recordFailure('notion', Object.assign(new Error('Network error'), { statusCode: 0 }))
    const entry = groupsOf(makeTask()).flat().find(i => i.label === 'Verschieben nach …')!
    expect(entry.children![0]!.description).toBe('Verbindung prüfen · wird später gespeichert')
    entry.children![0]!.onSelect!()
    expect(moveTaskToSource).toHaveBeenCalledWith('a', 'notion')
  })

  it('English labels', () => {
    setTestLocale('en')
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const entry = groupsOf(makeTask({ priority: 3 })).flat().find(i => i.label === 'Move to …')!
    expect(entry.children![0]!.description).toBe('1 field is lost')
  })

  it('is disabled with "Wird gespeichert" while a move is outstanding', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    const entry = groupsOf(makeTask({
      source: 'notion', externalId: null, pendingSync: { since: 1, attempts: 0, lastError: null },
      pendingMove: { fromSource: 'local', fromExternalId: null, toSource: 'notion' },
    })).flat().find(i => i.label === 'Verschieben nach …')!
    expect(entry.children![0]).toMatchObject({ label: 'Lokal', disabled: true, description: 'Wird gespeichert' })
  })
})
