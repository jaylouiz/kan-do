import { describe, it, expect } from 'vitest'
import { classifySyncFailure, emptySourceHealthMap, pushFailureScope, normalizeIntegrationHealthState, sourceProblems } from '~/lib/integrationHealth'
import type { SourceHealth } from '~/types/integration'
import { SourceNotConfiguredError } from '~/integrations/sources/types'

describe('normalizeIntegrationHealthState (#318)', () => {
  it('folds the pre-#318 notion status and reason into sources.notion and drops the old keys', () => {
    const next = normalizeIntegrationHealthState({ notion: 'offline', notionLastErrorReason: 'Failed to fetch' })
    expect(next).toEqual({
      sources: {
        notion: { status: 'offline', lastError: 'Failed to fetch', lastSuccessfulSync: null },
        todoist: { status: 'unconfigured', lastError: null, lastSuccessfulSync: null },
      },
    })
  })

  it('returns the very same object for a state in the current shape (no write-back, #273)', () => {
    const state = { sources: emptySourceHealthMap() }
    expect(normalizeIntegrationHealthState(state)).toBe(state)
  })

  it('is idempotent', () => {
    const once = normalizeIntegrationHealthState({ notion: 'broken', notionLastErrorReason: 'x' })
    expect(normalizeIntegrationHealthState(once)).toBe(once)
  })

  it('keeps stored per-source data and drops the legacy keys when both are present', () => {
    const sources = { ...emptySourceHealthMap(), todoist: { status: 'healthy', lastError: null, lastSuccessfulSync: 5 } }
    const next = normalizeIntegrationHealthState({ sources, notion: 'broken', notionLastErrorReason: 'stale' })
    expect(next).toEqual({ sources })
    expect(next).not.toHaveProperty('notion')
  })

  it('repairs invalid entries and unknown sources', () => {
    const next = normalizeIntegrationHealthState({
      sources: { notion: { status: 'bogus', lastError: 3, lastSuccessfulSync: 'x' }, linear: { status: 'healthy' } },
    })
    expect(next).toEqual({ sources: emptySourceHealthMap() })
  })

  it('seeds the legacy notion sync time from the board last sync, once', () => {
    const next = normalizeIntegrationHealthState({ notion: 'healthy', notionLastErrorReason: null }, 1_700_000_000_000)
    expect(next).toMatchObject({ sources: { notion: { lastSuccessfulSync: 1_700_000_000_000 }, todoist: { lastSuccessfulSync: null } } })
    // A state already in the new shape keeps its own time and is returned untouched
    const current = { sources: { ...emptySourceHealthMap(), notion: { status: 'healthy', lastError: null, lastSuccessfulSync: 5 } } }
    expect(normalizeIntegrationHealthState(current, 1_700_000_000_000)).toBe(current)
    const fresh = { sources: emptySourceHealthMap() }
    expect(normalizeIntegrationHealthState(fresh, 1_700_000_000_000)).toBe(fresh)
  })

  it('creates the default state from nothing usable', () => {
    expect(normalizeIntegrationHealthState(null)).toEqual({ sources: emptySourceHealthMap() })
    expect(normalizeIntegrationHealthState({})).toEqual({ sources: emptySourceHealthMap() })
  })
})

describe('classifySyncFailure', () => {
  it.each([
    [new TypeError('Failed to fetch'), 'offline'],
    [Object.assign(new Error('Network error'), { statusCode: 0 }), 'offline'],
    [Object.assign(new Error('Unauthorized'), { statusCode: 401 }), 'broken'],
    [new SourceNotConfiguredError('notion', 'Notion integration is not properly configured'), 'broken'],
    [new Error('Notion API error: 500'), 'degraded'],
    [Object.assign(new Error('Not Found'), { statusCode: 404 }), 'broken'],
    [Object.assign(new Error('Forbidden'), { statusCode: 403 }), 'broken'],
    // Wrapped like NotionIntegration.verifyDatabaseAccess does: the status sits in `cause`
    [new Error('Cannot access Notion database: Unauthorized', { cause: Object.assign(new Error('Unauthorized'), { statusCode: 401 }) }), 'broken'],
    [new Error('Cannot access Notion database: Not Found', { cause: Object.assign(new Error('Not Found'), { statusCode: 404 }) }), 'broken'],
    [new Error('Cannot access Notion database: Bad Gateway', { cause: Object.assign(new Error('Bad Gateway'), { statusCode: 502 }) }), 'degraded'],
    [new Error('Cannot access Notion database: Failed to fetch', { cause: Object.assign(new Error('Failed to fetch'), { statusCode: 0 }) }), 'offline'],
    [new Error('Cannot access Notion database: Database not found or not accessible'), 'degraded'],
  ])('%s -> %s', (error, expected) => {
    expect(classifySyncFailure(error)).toBe(expected)
  })
})

describe('pushFailureScope (#319)', () => {
  const http = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
  it.each([
    [new TypeError('Failed to fetch'), 'source'],
    [http(0), 'source'],
    [http(401), 'source'],
    [new SourceNotConfiguredError('notion', 'Notion integration is not properly configured'), 'source'],
    // A page the source refuses is the task's problem
    [http(400), 'task'],
    [http(403), 'task'],
    [http(404), 'task'],
    [http(500), 'task'],
    [new Error('Cannot access Notion database: Not Found', { cause: http(404) }), 'task'],
    [new Error('Cannot access Notion database: Unauthorized', { cause: http(401) }), 'source'],
  ])('%s -> %s', (error, expected) => {
    expect(pushFailureScope(error)).toBe(expected)
  })
})

describe('sourceProblems (#319)', () => {
  const map = (notion: SourceHealth['status'], todoist: SourceHealth['status']) => ({
    notion: { status: notion, lastError: notion === 'healthy' ? null : `${notion} reason`, lastSuccessfulSync: null },
    todoist: { status: todoist, lastError: null, lastSuccessfulSync: null },
  })

  it('lists only connected sources that cannot sync, worst first', () => {
    expect(sourceProblems(map('offline', 'broken'), ['notion', 'todoist']).map((p) => p.source)).toEqual(['todoist', 'notion'])
    expect(sourceProblems(map('offline', 'broken'), ['notion'])).toEqual([{ source: 'notion', status: 'offline', lastError: 'offline reason' }])
  })

  it('says nothing for healthy, never-synced or disconnected sources', () => {
    expect(sourceProblems(map('healthy', 'unconfigured'), ['notion', 'todoist'])).toEqual([])
    expect(sourceProblems(map('broken', 'broken'), [])).toEqual([])
  })
})
