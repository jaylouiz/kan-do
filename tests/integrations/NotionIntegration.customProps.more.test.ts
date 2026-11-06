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

describe('NotionIntegration – custom properties parsing (more types)', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads multi_select custom property', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Tags', type: 'multi_select', enabled: true, key: 'tags' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-ms',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Multi' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Tags: { multi_select: [{ name: 'A', color: 'red' }, { name: 'B', color: 'blue' }] },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.tags?.value).toEqual({ type: 'multi_select', value: [{ name: 'A', color: 'red' }, { name: 'B', color: 'blue' }] })
  })

  it('reads date custom property', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Window', type: 'date', enabled: true, key: 'window' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-date',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Date' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Window: { date: { start: '2025-09-22', end: '2025-09-23' } },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.window?.value).toEqual({ type: 'date', value: { start: '2025-09-22', end: '2025-09-23' } })
  })

  it('reads checkbox custom property', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Approved', type: 'checkbox', enabled: true, key: 'approved' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-check',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Check' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Approved: { checkbox: true },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.approved?.value).toEqual({ type: 'checkbox', value: true })
  })

  it('reads email custom property', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Kontakt', type: 'email', enabled: true, key: 'kontakt' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-email',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Email' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Kontakt: { email: 'test@example.com' },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.kontakt?.value).toEqual({ type: 'email', value: 'test@example.com' })
  })

  it('reads phone_number custom property', async () => {
    const mapping = {
      ...baseMapping,
      customProperties: [
        { name: 'Telefon', type: 'phone_number', enabled: true, key: 'telefon' },
      ],
    } as any

    const pages = [
      {
        id: 'pg-phone',
        properties: {
          [mapping.title]: { title: [{ plain_text: 'Phone' }] },
          [mapping.status]: { select: { name: statusMapping.today } },
          Telefon: { phone_number: '+123456789' },
          [mapping.timeSpent]: { number: 0 },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = new NotionIntegration(token, db, mapping, statusMapping, undefined, 'ds-123')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.custom?.telefon?.value).toEqual({ type: 'phone_number', value: '+123456789' })
  })
})
