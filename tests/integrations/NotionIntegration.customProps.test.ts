/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock error handler
const handleErrorSpy = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorSpy }),
}))

// SUT
// eslint-disable-next-line import/first -- ensure mocks registered
import { NotionIntegration } from '~/integrations/NotionIntegration'

const token = 'tok'
const db = 'db'

const baseMapping = {
  title: 'Name',
  status: 'Status',
  timeSpent: 'TimeSpent',
} as any

const statusMapping = {
  today: 'Heute',
  doing: 'Jetzt',
  waiting: 'Wartet',
  done: 'Erledigt',
} as any

/**
 * Mock fetch to handle both database verification and task fetching
 */
const mockFetchForTasks = (pages: any[]) => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.startsWith('/api/notion/database')) {
      // Database verification call
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: db, title: 'Test DB' })
      })
    }
    if (url === '/api/notion/query-data-source') {
      // Task fetching call
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: pages })
      })
    }
    // Task fetching call
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: pages })
    })
  }))
}

describe('NotionIntegration – custom properties parsing', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads url custom property into task.custom bag', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Link', type: 'url', enabled: true, key: 'link' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-url',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'With URL' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Link: { url: 'https://example.com' },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.link?.value).toEqual({ type: 'url', value: 'https://example.com' })
  })

  it('reads number and select custom properties', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Score', type: 'number', enabled: true, key: 'score' },
        { name: 'Kategorie', type: 'select', enabled: true, key: 'cat' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-num-sel',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Two props' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Score: { number: 42 },
          Kategorie: { select: { name: 'A', color: 'red' } },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    const task = tasks[0]!
    expect(task.custom?.score?.value).toEqual({ type: 'number', value: 42 })
    expect(task.custom?.cat?.value).toEqual({ type: 'select', value: { name: 'A', color: 'red' } })
  })
})
