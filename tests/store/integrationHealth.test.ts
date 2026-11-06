import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useIntegrationHealthStore } from '../../store/integrationHealth'

describe('IntegrationHealth Store - per source (#318)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts every integration unconfigured, without an error or a sync', () => {
    const store = useIntegrationHealthStore()
    for (const source of ['notion', 'todoist'] as const) {
      expect(store.healthOf(source)).toEqual({ status: 'unconfigured', lastError: null, lastSuccessfulSync: null })
      expect(store.isBroken(source)).toBe(false)
    }
  })

  it('markBroken sets the broken state and captures the reason for that source only', () => {
    const store = useIntegrationHealthStore()
    store.markBroken('notion', '401 Unauthorized')

    expect(store.isBroken('notion')).toBe(true)
    expect(store.healthOf('notion').lastError).toBe('401 Unauthorized')
    expect(store.statusOf('todoist')).toBe('unconfigured')
  })

  it('markHealthy clears the reason', () => {
    const store = useIntegrationHealthStore()
    store.markBroken('notion', 'invalid token')
    store.markHealthy('notion')

    expect(store.isBroken('notion')).toBe(false)
    expect(store.healthOf('notion')).toMatchObject({ status: 'healthy', lastError: null })
  })

  it('tells offline, degraded and broken apart and flags all of them as needing attention', () => {
    const store = useIntegrationHealthStore()
    store.markOffline('notion', 'Failed to fetch')
    store.markDegraded('todoist', 'HTTP 500')

    expect(store.isOffline('notion')).toBe(true)
    expect(store.needsAttention('notion')).toBe(true)
    expect(store.needsAttention('todoist')).toBe(true)
    store.markHealthy('notion')
    expect(store.needsAttention('notion')).toBe(false)
  })

  it('recordSuccessfulSync stamps the time and heals the source, markUnconfigured keeps that time', () => {
    const store = useIntegrationHealthStore()
    store.markOffline('notion', 'Failed to fetch')
    store.recordSuccessfulSync('notion', 1234)
    expect(store.healthOf('notion')).toEqual({ status: 'healthy', lastError: null, lastSuccessfulSync: 1234 })

    store.markUnconfigured('notion')
    expect(store.healthOf('notion')).toEqual({ status: 'unconfigured', lastError: null, lastSuccessfulSync: 1234 })
  })

  it('Local has no entry and is always healthy', () => {
    const store = useIntegrationHealthStore()
    expect(store.statusOf('local')).toBe('healthy')
    expect(store.needsAttention('local')).toBe(false)
  })
})
