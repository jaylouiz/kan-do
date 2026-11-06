import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const route = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return reactive({ name: 'tasks-add' as string, query: {} as Record<string, string> })
})
vi.mock('nuxt/app', () => ({ useRoute: () => route }))

/* eslint-disable import/first -- the route mock must be registered before the SUT is imported */
import { useAddTarget } from '~/composables/useAddTarget'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

describe('useAddTarget (#321)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    route.name = 'tasks-add'
    route.query = {}
    useAddTarget().resetTarget()
    useTaskDraft().clearDraft()
  })

  it('one source (Local only, or never set up): no switch, the target is Local', () => {
    expect(useAddTarget().isSwitchVisible.value).toBe(false)
    useBoardStore().setSources({ connected: [], default: 'local' })
    const target = useAddTarget()
    expect(target.availableSources.value).toEqual(['local'])
    expect(target.isSwitchVisible.value).toBe(false)
    expect(target.targetSource.value).toBe('local')
  })

  it('2+ sources: the switch shows, starting on the default, also when the default is Local', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    expect(useAddTarget().availableSources.value).toEqual(['local', 'notion'])
    expect(useAddTarget().isSwitchVisible.value).toBe(true)
    expect(useAddTarget().targetSource.value).toBe('notion')
    board.setSources({ connected: ['notion'], default: 'local' })
    expect(useAddTarget().targetSource.value).toBe('local')
  })

  it('the ad-hoc add and other routes show no switch', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    route.query = { mode: 'adhoc' }
    expect(useAddTarget().isSwitchVisible.value).toBe(false)
    route.query = {}
    route.name = 'tasks-id'
    expect(useAddTarget().isSwitchVisible.value).toBe(false)
  })

  it('a chosen target holds until reset; an unavailable one is ignored', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    const target = useAddTarget()
    target.setTarget('local')
    expect(target.targetSource.value).toBe('local')
    target.setTarget('todoist')
    expect(target.targetSource.value).toBe('local')
    target.resetTarget()
    expect(target.targetSource.value).toBe('notion')
  })

  it('falls back to the default when the chosen source is disconnected meanwhile', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'local' })
    const target = useAddTarget()
    target.setTarget('notion')
    board.setSources({ connected: [], default: 'local' })
    expect(target.targetSource.value).toBe('local')
  })

  it('Todoist cannot create: it is not offered and a Todoist default means Local', () => {
    useBoardStore().setSources({ connected: ['todoist'], default: 'todoist' })
    const target = useAddTarget()
    expect(target.availableSources.value).toEqual(['local'])
    expect(target.defaultSource.value).toBe('local')
    expect(target.isSwitchVisible.value).toBe(false)
  })

  it('reports a source that needs attention, and locks while the save runs', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    const target = useAddTarget()
    expect(target.needsAttention('notion')).toBe(false)
    useIntegrationHealthStore().markOffline('notion', 'offline')
    expect(target.needsAttention('notion')).toBe(true)
    expect(target.needsAttention('local')).toBe(false)

    expect(target.isSaving.value).toBe(false)
    useTaskDraft().startDraft()
    useTaskDraft().setDraftSaving(true)
    expect(target.isSaving.value).toBe(true)
    useTaskDraft().setDraftSaving(false)
    expect(target.isSaving.value).toBe(false)
  })
})
