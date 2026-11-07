/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock error handler to capture calls from NotionIntegration.handleError
const handleErrorSpy = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorSpy }),
}))

// SUT
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { classifySyncFailure } from '~/lib/integrationHealth'

const token = 'tkn'
const db = 'db1'
const propertyMapping = {
  title: 'Name',
  status: 'Status',
  timeBox: 'TimeBox',
  timeSpent: 'TimeSpent',
  priority: 'Priority',
  topic: 'Topic',
}
const statusMapping = {
  today: 'Heute',
  doing: 'Jetzt',
  waiting: 'Wartet',
  done: 'Erledigt',
}

const makeSut = (mapping = propertyMapping, status = statusMapping, dataSourceId = 'ds-123') =>
  new NotionIntegration(token, db, mapping as any, status as any, undefined, dataSourceId)
const makeSutWithUnit = (unit: 'seconds' | 'minutes' | 'hours') => {
  const pm = { ...propertyMapping, timeSpentUnit: unit } as any
  return new NotionIntegration(token, db, pm, statusMapping as any, undefined, 'ds-123')
}

const NOTION_API = 'https://api.notion.com/v1'

// The detected status property type is memoized for the session: start every test without it
beforeEach(() => {
  resetStatusTypeCache()
})

/**
 * Mock fetch to handle direct Notion API calls
 */
const mockFetchForTasks = (pages: any[]) => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    // Browser proxy: database fetch used by verifyDatabaseAccess
    if (url.startsWith('/api/notion/database')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: db, source: 'local', externalId: null, title: [{ plain_text: 'Test DB' }], properties: {} }),
      })
    }

    // Browser proxy: data source query call
    if (url === '/api/notion/query-data-source') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: pages }),
      })
    }

    // Browser proxy: get page
    if (url.startsWith('/api/notion/pages')) {
      const mockPage = pages[0] || { id: 'page-1', properties: {} }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPage),
      })
    }

    // Database verification call
    if (url.startsWith(`${NOTION_API}/databases/`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: db, source: 'local', externalId: null, title: [{ plain_text: 'Test DB' }], properties: {} })
      })
    }
    // Data source query call (task fetching)
    if (url.startsWith(`${NOTION_API}/data_sources/`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: pages })
      })
    }
    // Page get call (single page)
    if (url.startsWith(`${NOTION_API}/pages/`)) {
      // Return the first page from pages array if available, otherwise a mock page
      const mockPage = pages[0] || { id: 'page-1', properties: {} }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPage)
      })
    }
    // Page create call
    if (url === `${NOTION_API}/pages`) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'new-page-id', object: 'page' })
      })
    }
    // Search call (for databases/data sources/pages)
    if (url === `${NOTION_API}/search`) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      })
    }
    // Default fallback
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: pages })
    })
  }))
}

const parseLastUpdateTaskCall = (): { body: any; headers: any } => {
  const calls = (fetch as any).mock.calls as Array<[string, any]>
  const match = [...calls].reverse().find(([url, init]) => url === '/api/notion/update-task' || init?.method === 'PATCH')
  if (!match) {
    throw new Error('No update-task (PATCH) call found')
  }
  const [, init] = match
  return { body: JSON.parse(init.body), headers: init.headers ?? {} }
}

// Keep backward-compatible alias
const parseLastUpdateTaskBody = (): any => parseLastUpdateTaskCall().body

describe('NotionIntegration.updateTask', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })

  it('reads timeSpent number with minutes unit and converts to seconds', async () => {
    const pages = [
      {
        id: 'rs1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'RS1' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeSpent]: { number: 15 }, // minutes
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithUnit('minutes')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    const task = tasks[0]!
    expect(task.timeSpentSeconds).toBe(15 * 60)
  })

  it('reads timeSpent number with hours unit and converts to seconds', async () => {
    const pages = [
      {
        id: 'rs2',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'RS2' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeSpent]: { number: 1.5 }, // hours
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithUnit('hours')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    const task = tasks[0]!
    expect(task.timeSpentSeconds).toBe(1.5 * 3600)
  })

  it('falls back to parseTimeValue when timeSpent is non-number (e.g., select "90m")', async () => {
    const pages = [
      {
        id: 'rs3',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'RS3' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeSpent]: { select: { name: '90m' } },
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithUnit('minutes')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    const task = tasks[0]!
    expect(task.timeSpentSeconds).toBe(90 * 60)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

describe('NotionIntegration.updateTaskStatus and status mapping fallbacks', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('falls back to "Waiting" when waiting mapping is missing (reverse mapping)', async () => {
    // Given a statusMapping without waiting
    const partialStatusMapping = { today: 'Heute', doing: 'Jetzt', done: 'Erledigt' } as any

    // Use updateTask to exercise mapStatusToNotion reverse mapping
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSut(propertyMapping, partialStatusMapping)

    await ni.updateTask({
      id: 'pg-999', source: 'notion', externalId: 'pg-999',
      title: 'Wait Task',
      notes: null,
      status: TaskStatus.Waiting,
      priority: 1,
      timeBoxSeconds: null,
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      activity: null,
      timerId: null,
    })

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.status].select.name).toBe('Waiting')
  })
})

describe('NotionIntegration – priority mapping and time parsing edge cases', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps priority select names to lowercase strings and reads an empty select as Normal (#653)', async () => {
    const pages = [
      {
        id: 'a1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'P-High' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.priority]: { select: { name: 'High' } },
        },
      },
      {
        id: 'a2',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'P-Custom' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.priority]: { select: { name: 'Sehr Wichtig' } },
        },
      },
      {
        id: 'a3',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'P-None' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.priority]: { select: { name: null } },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = makeSut()
    const result = await ni.getActiveBoardTasks()

    const taskHigh = result.find((task) => task.id === 'a1')
    expect(taskHigh).toBeDefined()
    expect(taskHigh?.priority).toBe(3)

    const taskCustom = result.find((task) => task.id === 'a2')
    expect(taskCustom).toBeDefined()
    expect(taskCustom?.priority).toBe(1)

    const taskNone = result.find((task) => task.id === 'a3')
    expect(taskNone).toBeDefined()
    expect(taskNone?.priority).toBe(2)
  })

  it('maps a page without keeping the raw upstream object on the task (#334)', async () => {
    mockFetchForTasks([
      {
        id: 'raw-1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Raw' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
        },
      },
    ])
    const [task] = await makeSut().getActiveBoardTasks()

    expect(task).toMatchObject({ id: 'raw-1', externalId: 'raw-1', source: 'notion', title: 'Raw' })
    expect(task).not.toHaveProperty('sourceData')
  })

  it('parses time values from variants: "1 h", "90m", "15 min" and ignores garbage', async () => {
    const pages = [
      {
        id: 't1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'H' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { rich_text: [{ text: { content: '1 h' } }] },
        },
      },
      {
        id: 't2',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'M' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { select: { name: '90m' } },
        },
      },
      {
        id: 't3',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'MIN' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { title: [{ plain_text: '15 min' }] },
        },
      },
      {
        id: 't4',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Garbage' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { rich_text: [{ text: { content: 'xyz' } }] },
        },
      },
    ]

    mockFetchForTasks(pages)
    const ni = makeSut()
    const tasks = await ni.getActiveBoardTasks()

    const t1 = tasks.find((task) => task.id === 't1')
    const t2 = tasks.find((task) => task.id === 't2')
    const t3 = tasks.find((task) => task.id === 't3')
    const t4 = tasks.find((task) => task.id === 't4')

    expect(t1).toBeDefined()
    expect(t1!.timeBoxSeconds).toBe(3600)
    expect(t2).toBeDefined()
    expect(t2!.timeBoxSeconds).toBe(90 * 60)
    expect(t3).toBeDefined()
    expect(t3!.timeBoxSeconds).toBe(15 * 60)
    expect(t4).toBeDefined()
    expect(t4!.timeBoxSeconds).toBeNull()
  })
})
  it('sends PATCH to /api/notion/update-task with mapped properties and token', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSut()

    await ni.updateTask({
      id: 'p1', source: 'notion', externalId: 'p1',
      title: 'X',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 3600,
      timeSpentSeconds: 120,
      topic: null,
      topicColorCode: null,
      activity: null,
      timerId: null,
    })

    // updateTask reads the status property type (#312), the page to compare the priority (#678), performs PATCH and then GET to read Notion's current state
    expect(fetch).toHaveBeenCalledTimes(4)
    const { body, headers } = parseLastUpdateTaskCall()
    expect(headers['Authorization']).toBe(`Bearer ${token}`)
    expect(body.pageId).toBe('p1')
    // Status mapped via statusMapping.doing -> "Jetzt"
    expect(body.properties[propertyMapping.status].select.name).toBe(statusMapping.doing)
    // Time spent present when > 0 and mapping configured
    expect(body.properties[propertyMapping.timeSpent].number).toBe(120)
  })

  it('writes timeSpent in minutes when configured (3600s -> 60)', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithUnit('minutes')

    await ni.updateTask({
      id: 'p-min', source: 'notion', externalId: 'p-min', title: 'Min', notes: null, status: TaskStatus.Progress, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 3600, topic: null, topicColorCode: null, timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeSpent].number).toBe(60)
  })

  it('writes timeSpent in hours when configured (5400s -> 1.5)', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithUnit('hours')

    await ni.updateTask({
      id: 'p-hr', source: 'notion', externalId: 'p-hr', title: 'Hr', notes: null, status: TaskStatus.Progress, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 5400, topic: null, topicColorCode: null, timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeSpent].number).toBe(1.5)
  })

  it('clears the time property when the user set the total to 0 (#4); an ordinary push at 0 leaves it alone', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithUnit('minutes')
    const base = {
      id: 'p-edit', source: 'notion', externalId: 'p-edit', title: 'Edit', notes: null, status: TaskStatus.Open, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
    } as any

    await ni.updateTask(base)
    expect(parseLastUpdateTaskBody().properties[propertyMapping.timeSpent]).toBeUndefined()

    await ni.updateTask(base, { timeEdited: true })
    expect(parseLastUpdateTaskBody().properties[propertyMapping.timeSpent]).toEqual({ number: null })

    await ni.updateTask({ ...base, timeSpentSeconds: 1800 }, { timeEdited: true })
    expect(parseLastUpdateTaskBody().properties[propertyMapping.timeSpent]).toEqual({ number: 30 })
  })

  it('does not write a cleared time when the time property is not mapped', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const { timeSpent: _unmapped, ...withoutTime } = propertyMapping
    const ni = makeSut(withoutTime as any)

    await ni.updateTask({
      id: 'p-nomap', source: 'notion', externalId: 'p-nomap', title: 'X', notes: null, status: TaskStatus.Open, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
    } as any, { timeEdited: true })

    expect(Object.keys(parseLastUpdateTaskBody().properties)).not.toContain(propertyMapping.timeSpent)
  })

  it('writes the completion date of a Done task as an ISO instant', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSut({ ...propertyMapping, completedDate: 'Erledigt am' } as any)
    const completedAt = new Date('2026-10-28T08:39:44.639Z')

    // A task restored from storage holds a Date too: the stores revive it at hydration (#376)
    await ni.updateTask({
      id: 'p-done', source: 'notion', externalId: 'p-done', title: 'Done', notes: null, status: TaskStatus.Done, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
      completedAt,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties['Erledigt am'].date.start).toBe(completedAt.toISOString())
  })

  it('calls handleError and rethrows on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Boom', text: () => Promise.resolve('X') }))
    const ni = makeSut()

    await expect(ni.updateTask({
      id: 'p2', source: 'notion', externalId: 'p2', title: 'Y', notes: null, status: TaskStatus.Open, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, activity: null, timerId: null,
    })).rejects.toBeTruthy()

    expect(handleErrorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('NotionIntegration listings and parsing variants', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('listDatabases returns array on success and handleError on failure', async () => {
    // success
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ id: 'd1', source: 'notion', externalId: 'd1', title: 'DB', dataSources: [{ id: 'ds1', name: 'DS', databaseId: 'd1', databaseTitle: 'DB' }] }]) }))
    const ni = makeSut()
    const dbs = await ni.listDatabases()
    expect(dbs).not.toHaveLength(0)
    const firstDb = dbs[0]!
    expect(firstDb.id).toBe('d1')
    expect(firstDb.dataSources[0]?.id).toBe('ds1')

    // failure
    ;(fetch as any).mockResolvedValueOnce({ ok: false, statusText: 'Bad' })
    await expect(ni.listDatabases()).rejects.toBeTruthy()
    expect(handleErrorSpy).toHaveBeenCalled()
  })

  it('listPages returns array on success and [] on failure', async () => {
    // success
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ id: 'p1', source: 'notion', externalId: 'p1', title: 'Page' }]) }))
    const ni = makeSut()
    const pages = await ni.listPages()
    expect(pages).not.toHaveLength(0)
    expect(pages[0]!.id).toBe('p1')

    // failure
    // NotionClientAPI retries once on 5xx by default
    ;(fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Boom', json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Boom', json: () => Promise.resolve({}) })
    const pages2 = await ni.listPages()
    expect(pages2).toEqual([])
    expect(handleErrorSpy).toHaveBeenCalled()
  })

  it('listDatabasesInPage returns array on success and [] on failure', async () => {
    // success
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ id: 'd2', source: 'notion', externalId: 'd2', title: 'InPage', dataSources: [] }]) }))
    const ni = makeSut()
    const res = await ni.listDatabasesInPage('parent1')
    expect(res).not.toHaveLength(0)
    expect(res[0]!.id).toBe('d2')

    // failure
    ;(fetch as any).mockResolvedValueOnce({ ok: false, status: 404 })
    const res2 = await ni.listDatabasesInPage('parent1')
    expect(res2).toEqual([])
    expect(handleErrorSpy).toHaveBeenCalled()
  })

  it('getActiveBoardTasks parses time from number/select/rich_text/title properties', async () => {
    const pages = [
      {
        id: 'n1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'T1' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { number: 600 }, // number
          [propertyMapping.timeSpent]: { number: 0 },
          [propertyMapping.topic]: { select: { name: null, color: null } },
        },
      },
      {
        id: 'n2',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'T2' }] },
          [propertyMapping.status]: { select: { name: statusMapping.doing } },
          [propertyMapping.timeBox]: { select: { name: '30min' } }, // select
          [propertyMapping.timeSpent]: { number: 0 },
        },
      },
      {
        id: 'n3',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'T3' }] },
          [propertyMapping.status]: { select: { name: statusMapping.waiting } },
          [propertyMapping.timeBox]: { rich_text: [{ text: { content: '45min' } }] }, // rich_text
          [propertyMapping.timeSpent]: { number: 0 },
        },
      },
      {
        id: 'n4',
        properties: {
          [propertyMapping.title]: { title: [{ text: { content: 'T4' } }] }, // title content variation
          [propertyMapping.status]: { select: { name: statusMapping.done } },
          [propertyMapping.timeBox]: { title: [{ text: { content: '15min' } }] }, // title with text.content
          [propertyMapping.timeSpent]: { number: 0 },
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSut()
    const tasks = await ni.getActiveBoardTasks()

    const p1 = tasks.find((task) => task.id === 'n1')
    const p2 = tasks.find((task) => task.id === 'n2')
    const p3 = tasks.find((task) => task.id === 'n3')
    const p4 = tasks.find((task) => task.id === 'n4')

    expect(p1).toBeDefined()
    expect(p1!.timeBoxSeconds).toBe(600 * 60)
    expect(p2).toBeDefined()
    expect(p2!.timeBoxSeconds).toBe(30 * 60)
    expect(p3).toBeDefined()
    expect(p3!.timeBoxSeconds).toBe(45 * 60)
    expect(p4).toBeDefined()
    expect(p4!.timeBoxSeconds).toBe(15 * 60)
  })
})

describe('NotionIntegration.getActiveBoardTasks', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps Notion pages to Task with configured property and status mappings', async () => {
    const notionPages = [
      {
        id: 'pg1',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Titel A' }] },
          [propertyMapping.status]: { select: { name: statusMapping.doing } },
          [propertyMapping.timeBox]: { number: 1800 },
          [propertyMapping.timeSpent]: { number: 300 },
          [propertyMapping.topic]: { select: { name: 'Topic1', color: 'green' } },
        },
      },
    ]
    mockFetchForTasks(notionPages)

    const ni = makeSut()
    const tasks = await ni.getActiveBoardTasks()

    expect(tasks.length).toBe(1)
    const t = tasks[0]!
    expect(t.id).toBe('pg1')
    expect(t.title).toBe('Titel A')
    expect(t.status).toBe(TaskStatus.Progress) // mapped from statusMapping.doing
    expect(typeof t.timeBoxSeconds === 'number').toBe(true)
    expect(t.timeSpentSeconds).toBe(300)
    expect(t.topic).toBe('Topic1')
    expect(t.topicColorCode).toBe('green')
  })

  it('handles HTTP error by calling handleError and returning empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: 'Bad', text: () => Promise.resolve('err') }))
    const ni = makeSut()
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toEqual([])
    expect(handleErrorSpy).toHaveBeenCalledTimes(1)
  })

  describe('fetchActiveBoardTasks: a failure of the access check keeps its status for the health classifier (#340)', () => {
    const failWith = (status: number) =>
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status, statusText: 'Nope', json: () => Promise.resolve({ message: 'Nope' }),
      }))

    it.each([
      [401, 'broken'],
      [404, 'broken'],
      [502, 'degraded'],
    ] as const)('HTTP %s through verifyDatabaseAccess is classed %s', async (status, expected) => {
      failWith(status)

      const rejection = await makeSut().fetchActiveBoardTasks().catch((error: unknown) => error)

      expect((rejection as Error).message).toContain('Cannot access Notion database')
      expect(classifySyncFailure(rejection)).toBe(expected)
      expect(handleErrorSpy).not.toHaveBeenCalled() // the caller marks the health, it does not toast
    })

    it('a network failure through verifyDatabaseAccess is classed offline', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      const rejection = await makeSut().fetchActiveBoardTasks().catch((error: unknown) => error)

      expect(classifySyncFailure(rejection)).toBe('offline')
    })
  })

  describe('pagination', () => {
    const pageOf = (index: number) => ({
      id: `pg${index}`,
      properties: {
        [propertyMapping.title]: { title: [{ plain_text: `Task ${index}` }] },
        [propertyMapping.status]: { select: { name: statusMapping.done } },
      },
    })
    const allPages = Array.from({ length: 250 }, (_, index) => pageOf(index))

    /** Serves `allPages` through the browser proxy in Notion's has_more / next_cursor shape. */
    const mockPagedProxy = (failOffset?: number) => {
      const queryBodies: any[] = []
      vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
        if (url.startsWith('/api/notion/database')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: db, source: 'local', externalId: null, title: [], properties: {} }) })
        }
        if (url !== '/api/notion/query-data-source') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
        }
        const body = JSON.parse(init.body)
        queryBodies.push(body)
        const offset = body.start_cursor ? Number(String(body.start_cursor).split(':')[1]) : 0
        if (offset === failOffset) {
          return Promise.resolve({ ok: false, status: 500, statusText: 'Boom', json: () => Promise.resolve({}) })
        }
        const end = offset + body.page_size
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: allPages.slice(offset, end),
            has_more: end < allPages.length,
            next_cursor: end < allPages.length ? `cursor:${end}` : null,
          }),
        })
      }))
      return queryBodies
    }

    it('returns every task of a database with more than 100 matches', async () => {
      const queryBodies = mockPagedProxy()

      const tasks = await makeSut().getActiveBoardTasks()

      expect(tasks).toHaveLength(250)
      expect(new Set(tasks.map((task) => task.id)).size).toBe(250)
      expect(queryBodies).toHaveLength(3)
      expect(queryBodies.map((body) => body.start_cursor)).toEqual([undefined, 'cursor:100', 'cursor:200'])
      expect(new Set(queryBodies.map((body) => JSON.stringify(body.filter))).size).toBe(1)
      expect(handleErrorSpy).not.toHaveBeenCalled()
    })

    it('returns no partial list when a later page fails', async () => {
      mockPagedProxy(100)

      const tasks = await makeSut().getActiveBoardTasks()

      expect(tasks).toEqual([])
      expect(handleErrorSpy).toHaveBeenCalledTimes(1)
    })

    it('getArchivedTasks also returns every page', async () => {
      mockPagedProxy()

      const tasks = await makeSut(propertyMapping, { ...statusMapping, archive: 'Archiv' } as any).getArchivedTasks()

      expect(tasks).toHaveLength(250)
    })
  })
})

describe('NotionIntegration – timeBoxUnit configuration', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeSutWithTimeBoxUnit = (unit: 'seconds' | 'minutes' | 'hours' | 'formatted' | undefined) => {
    const pm = { ...propertyMapping, timeBoxUnit: unit } as any
    return new NotionIntegration(token, db, pm, statusMapping as any, undefined, 'ds-123')
  }

  it('reads timeBox number with seconds unit and converts to seconds', async () => {
    const pages = [
      {
        id: 'tb-sec',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Task Seconds' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { number: 3600 }, // 3600 seconds = 1 hour
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithTimeBoxUnit('seconds')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.timeBoxSeconds).toBe(3600)
  })

  it('reads timeBox number with minutes unit and converts to seconds', async () => {
    const pages = [
      {
        id: 'tb-min',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Task Minutes' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { number: 90 }, // 90 minutes
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithTimeBoxUnit('minutes')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.timeBoxSeconds).toBe(90 * 60)
  })

  it('reads timeBox number with hours unit and converts to seconds', async () => {
    const pages = [
      {
        id: 'tb-hr',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Task Hours' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { number: 2.5 }, // 2.5 hours
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithTimeBoxUnit('hours')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.timeBoxSeconds).toBe(2.5 * 3600)
  })

  it('reads timeBox with formatted unit using parseTimeValue for strings like "15 min"', async () => {
    const pages = [
      {
        id: 'tb-fmt',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Task Formatted' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { select: { name: '45 min' } },
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithTimeBoxUnit('formatted')
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.timeBoxSeconds).toBe(45 * 60)
  })

  it('defaults to formatted when timeBoxUnit is undefined (backward compatibility)', async () => {
    const pages = [
      {
        id: 'tb-default',
        properties: {
          [propertyMapping.title]: { title: [{ plain_text: 'Task Default' }] },
          [propertyMapping.status]: { select: { name: statusMapping.today } },
          [propertyMapping.timeBox]: { select: { name: '2h' } },
        },
      },
    ]
    mockFetchForTasks(pages)
    const ni = makeSutWithTimeBoxUnit(undefined)
    const tasks = await ni.getActiveBoardTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.timeBoxSeconds).toBe(2 * 3600)
  })

  it('writes timeBox as number when unit is seconds', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithTimeBoxUnit('seconds')

    await ni.updateTask({
      id: 'write-sec', source: 'notion', externalId: 'write-sec',
      title: 'Write Seconds',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 7200, // 2 hours in seconds
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeBox].number).toBe(7200)
  })

  it('writes timeBox as number when unit is minutes', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithTimeBoxUnit('minutes')

    await ni.updateTask({
      id: 'write-min', source: 'notion', externalId: 'write-min',
      title: 'Write Minutes',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 5400, // 90 minutes in seconds
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeBox].number).toBe(90)
  })

  it('writes timeBox as number when unit is hours', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithTimeBoxUnit('hours')

    await ni.updateTask({
      id: 'write-hr', source: 'notion', externalId: 'write-hr',
      title: 'Write Hours',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 9000, // 2.5 hours in seconds
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeBox].number).toBe(2.5)
  })

  it('writes timeBox as select when unit is formatted (default behavior)', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithTimeBoxUnit('formatted')

    await ni.updateTask({
      id: 'write-fmt', source: 'notion', externalId: 'write-fmt',
      title: 'Write Formatted',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 3600, // 1 hour in seconds = 60 minutes
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeBox].select.name).toBe('60')
  })

  it('writes timeBox as select when unit is undefined (backward compatibility)', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    const ni = makeSutWithTimeBoxUnit(undefined)

    await ni.updateTask({
      id: 'write-default', source: 'notion', externalId: 'write-default',
      title: 'Write Default',
      notes: null,
      status: TaskStatus.Progress,
      priority: 1,
      timeBoxSeconds: 1800, // 30 minutes in seconds
      timeSpentSeconds: 0,
      topic: null,
      topicColorCode: null,
      timerId: null,
    } as any)

    const body = parseLastUpdateTaskBody()
    expect(body.properties[propertyMapping.timeBox].select.name).toBe('30')
  })
})

describe('NotionIntegration.createTask', () => {
  beforeEach(() => {
    handleErrorSpy.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes activity as multi_select property', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ 
      success: true, 
      pageId: 'new-task-id',
      page: { id: 'new-task-id' }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    
    const propertyMappingWithActivity = {
      ...propertyMapping,
      activity: 'Activity',
    }
    const ni = new NotionIntegration(token, db, propertyMappingWithActivity as any, statusMapping as any, undefined, 'ds-123')

    await ni.createTask({
      title: 'Test Task',
      activity: 'Work',
      status: TaskStatus.Open,
      priority: 2,
    } as any)

    const [url, init] = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/notion/create-task'))
    expect(url).toContain('/api/notion/create-task')
    const body = JSON.parse(init.body)
    expect(body.properties.Activity).toEqual({
      multi_select: [
        {
          name: 'Work',
        },
      ],
    })
  })

  it('does not include activity property when not mapped', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ 
      success: true, 
      pageId: 'new-task-id',
      page: { id: 'new-task-id' }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    
    const ni = makeSut()

    await ni.createTask({
      title: 'Test Task',
      activity: 'Work',
      status: TaskStatus.Open,
      priority: 2,
    } as any)

    const [, init] = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/notion/create-task'))
    const body = JSON.parse(init.body)
    expect(body.properties.Activity).toBeUndefined()
  })

  it('does not include activity property when value is null', async () => {
    const jsonMock = vi.fn().mockResolvedValue({ 
      success: true, 
      pageId: 'new-task-id',
      page: { id: 'new-task-id' }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: jsonMock }))
    
    const propertyMappingWithActivity = {
      ...propertyMapping,
      activity: 'Activity',
    }
    const ni = new NotionIntegration(token, db, propertyMappingWithActivity as any, statusMapping as any, undefined, 'ds-123')

    await ni.createTask({
      title: 'Test Task',
      activity: null,
      status: TaskStatus.Open,
      priority: 2,
    } as any)

    const [, init] = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/notion/create-task'))
    const body = JSON.parse(init.body)
    expect(body.properties.Activity).toEqual({ multi_select: [] })
  })
})

describe('NotionIntegration.getDatabaseSchema', () => {
  const dsSchema = { Name: { type: 'title' }, FromDataSource: { type: 'select' } }
  const dbSchema = { Name: { type: 'title' }, FromDatabase: { type: 'select' } }

  const mockProxy = (handlers: { dataSource: () => unknown; database?: () => unknown }) => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/notion/data-sources?id=')) {
        try {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(handlers.dataSource()) })
        } catch (error) {
          return Promise.reject(error)
        }
      }
      if (url.startsWith('/api/notion/database?id=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(handlers.database?.() ?? { id: db, properties: dbSchema }) })
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    }))
  }
  const urls = () => (fetch as any).mock.calls.map(([url]: [string]) => url)

  beforeEach(() => {
    handleErrorSpy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers the schema of the configured data source', async () => {
    mockProxy({ dataSource: () => ({ id: 'ds-123', properties: dsSchema }) })

    const schema = await makeSut().getDatabaseSchema()

    expect(schema).toEqual(dsSchema)
    expect(urls()).toEqual(['/api/notion/data-sources?id=ds-123'])
  })

  it('falls back to the database when the data source has no properties', async () => {
    mockProxy({ dataSource: () => ({ id: 'ds-123' }) })

    const schema = await makeSut().getDatabaseSchema(db)

    expect(schema).toEqual(dbSchema)
    expect(urls()).toEqual(['/api/notion/data-sources?id=ds-123', `/api/notion/database?id=${db}`])
  })

  it('falls back to the database when the data source read fails', async () => {
    mockProxy({ dataSource: () => { throw new Error('502') } })

    const schema = await makeSut().getDatabaseSchema()

    expect(schema).toEqual(dbSchema)
    expect(handleErrorSpy).not.toHaveBeenCalled()
  })

  it('reads the database when no data source is configured', async () => {
    mockProxy({ dataSource: () => ({ id: 'x', properties: dsSchema }) })
    const ni = new NotionIntegration(token, db, propertyMapping as any, statusMapping as any, undefined, null)

    expect(await ni.getDatabaseSchema()).toEqual(dbSchema)
    expect(urls()).toEqual([`/api/notion/database?id=${db}`])
  })

  it('reads another database directly instead of the configured data source', async () => {
    mockProxy({ dataSource: () => ({ id: 'ds-123', properties: dsSchema }) })

    await makeSut().getDatabaseSchema('other-db')

    expect(urls()).toEqual(['/api/notion/database?id=other-db'])
  })
})

describe('NotionIntegration native Status property (#312)', () => {
  const openTask = {
    id: 'pg1', source: 'notion', externalId: 'pg1',
    title: 'X',
    notes: null,
    status: TaskStatus.Progress,
    priority: 1,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    topic: null,
    topicColorCode: null,
    activity: null,
    timerId: null,
  }

  /** Proxy mock: the data-source schema types `Status` as given; `schema: 'fail'` makes the read reject, `'absent'` returns a schema without the property. */
  const mockProxy = (statusType: 'select' | 'status', pages: unknown[] = [], schema: 'ok' | 'fail' | 'absent' = 'ok') => {
    const fetchMock = vi.fn((url: string, _init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/notion/data-sources?id=')) {
        return schema === 'fail'
          ? Promise.resolve({ ok: false, status: 502, statusText: 'Bad', text: () => Promise.resolve('err') })
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'ds-123', properties: schema === 'absent' ? {} : { Status: { type: statusType } } }) })
      }
      if (url.startsWith('/api/notion/database?id=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: db, source: 'local', externalId: null, title: [], properties: {} }) })
      }
      if (url === '/api/notion/query-data-source') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: pages }) })
      }
      if (url === '/api/notion/create-task') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, pageId: 'new-id', page: { id: 'new-id' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'pg1', properties: {} }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const callsTo = (fetchMock: ReturnType<typeof mockProxy>, prefix: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix))
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body)

  beforeEach(() => {
    handleErrorSpy.mockReset()
    resetStatusTypeCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('filters', () => {
    const statusFilters = (fetchMock: ReturnType<typeof mockProxy>) =>
      bodyOf(callsTo(fetchMock, '/api/notion/query-data-source')[0]!).filter

    it('getActiveBoardTasks sends status filters for a native Status property', async () => {
      const fetchMock = mockProxy('status')
      await makeSut().getActiveBoardTasks()
      expect(statusFilters(fetchMock).or).toEqual([
        { property: 'Status', status: { equals: 'Heute' } },
        { property: 'Status', status: { equals: 'Jetzt' } },
        { property: 'Status', status: { equals: 'Erledigt' } },
        { property: 'Status', status: { equals: 'Wartet' } },
      ])
    })

    it('getActiveBoardTasks keeps sending select filters for a select property', async () => {
      const fetchMock = mockProxy('select')
      await makeSut().getActiveBoardTasks()
      expect(statusFilters(fetchMock).or).toEqual([
        { property: 'Status', select: { equals: 'Heute' } },
        { property: 'Status', select: { equals: 'Jetzt' } },
        { property: 'Status', select: { equals: 'Erledigt' } },
        { property: 'Status', select: { equals: 'Wartet' } },
      ])
    })

    it('getArchivedTasks filters with the detected type', async () => {
      const fetchMock = mockProxy('status')
      await makeSut(propertyMapping, { ...statusMapping, archive: 'Archiv' } as typeof statusMapping).getArchivedTasks()
      expect(statusFilters(fetchMock)).toEqual({ property: 'Status', status: { equals: 'Archiv' } })
    })
  })

  describe('writes', () => {
    it('createTask writes { status: { name } } for a native Status property', async () => {
      const fetchMock = mockProxy('status')
      await makeSut().createTask({ title: 'T', status: TaskStatus.Progress } as any)
      expect(bodyOf(callsTo(fetchMock, '/api/notion/create-task')[0]!).properties.Status).toEqual({ status: { name: 'Jetzt' } })
    })

    it('createTask writes { select: { name } } for a select property', async () => {
      const fetchMock = mockProxy('select')
      await makeSut().createTask({ title: 'T', status: TaskStatus.Progress } as any)
      expect(bodyOf(callsTo(fetchMock, '/api/notion/create-task')[0]!).properties.Status).toEqual({ select: { name: 'Jetzt' } })
    })

    it('updateTask writes { status: { name } } and uses it for the archive value', async () => {
      const fetchMock = mockProxy('status')
      const ni = makeSut(propertyMapping, { ...statusMapping, archive: 'Archiv' } as typeof statusMapping)
      await ni.updateTask(openTask as any)
      await ni.updateTask({ ...openTask, archivedAt: new Date().toISOString() } as any)
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(bodyOf(patches[0]!).properties.Status).toEqual({ status: { name: 'Jetzt' } })
      expect(bodyOf(patches[1]!).properties.Status).toEqual({ status: { name: 'Archiv' } })
    })

    it('updateTask writes { select: { name } } for a select property', async () => {
      const fetchMock = mockProxy('select')
      await makeSut().updateTask(openTask as any)
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
      expect(bodyOf(patch).properties.Status).toEqual({ select: { name: 'Jetzt' } })
    })

    it('updateTaskStatus writes the detected shape', async () => {
      const fetchMock = mockProxy('status')
      await makeSut().updateTaskStatus('pg1', 'Wartet')
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
      expect(bodyOf(patch).properties.Status).toEqual({ status: { name: 'Wartet' } })
    })
  })

  describe('reading pages', () => {
    it('maps a status typed page to its TaskStatus', async () => {
      mockProxy('status', [{ id: 'pg1', properties: { Name: { title: [{ plain_text: 'A' }] }, Status: { type: 'status', status: { name: 'Jetzt', color: 'orange' } } } }])
      const [task] = await makeSut().getActiveBoardTasks()
      expect(task!.status).toBe(TaskStatus.Progress)
    })

    it('defaults a page without status to the today mapping', async () => {
      mockProxy('status', [{ id: 'pg1', properties: { Name: { title: [{ plain_text: 'A' }] }, Status: { type: 'status', status: null } } }])
      const [task] = await makeSut().getActiveBoardTasks()
      expect(task!.status).toBe(TaskStatus.Open)
    })
  })

  describe('detection', () => {
    it('reads the schema once per data source and property across syncs', async () => {
      const fetchMock = mockProxy('status')
      const ni = makeSut()
      await ni.getActiveBoardTasks()
      await ni.getActiveBoardTasks()
      await ni.updateTask(openTask as any)
      expect(callsTo(fetchMock, '/api/notion/data-sources?id=')).toHaveLength(1)
    })

    it('keys the memo by data source and property name', async () => {
      const fetchMock = mockProxy('status')
      await makeSut().getActiveBoardTasks()
      await makeSut(propertyMapping, statusMapping, 'ds-other').getActiveBoardTasks()
      await makeSut({ ...propertyMapping, status: 'Phase' }).getActiveBoardTasks()
      expect(callsTo(fetchMock, '/api/notion/data-sources?id=')).toHaveLength(3)
    })

    it('shares one read between concurrent first calls', async () => {
      const fetchMock = mockProxy('status')
      const ni = makeSut()
      await Promise.all([ni.updateTaskStatus('a', 'Jetzt'), ni.updateTaskStatus('b', 'Wartet')])
      expect(callsTo(fetchMock, '/api/notion/data-sources?id=')).toHaveLength(1)
    })

    it('falls back to select when the schema read fails, without reporting an error, and retries next time', async () => {
      const failing = mockProxy('status', [], 'fail')
      const ni = makeSut()
      await ni.getActiveBoardTasks()
      expect(bodyOf(callsTo(failing, '/api/notion/query-data-source')[0]!).filter.or[0]).toEqual({ property: 'Status', select: { equals: 'Heute' } })
      expect(handleErrorSpy).not.toHaveBeenCalled()

      const healthy = mockProxy('status')
      await ni.getActiveBoardTasks()
      expect(callsTo(healthy, '/api/notion/data-sources?id=')).toHaveLength(1)
      expect(bodyOf(callsTo(healthy, '/api/notion/query-data-source')[0]!).filter.or[0]).toEqual({ property: 'Status', status: { equals: 'Heute' } })
    })

    it('lets every concurrent caller fall back to select when the shared schema read fails, then retries', async () => {
      const failing = mockProxy('status', [], 'fail')
      const ni = makeSut()
      await Promise.all([ni.updateTaskStatus('a', 'Jetzt'), ni.updateTaskStatus('b', 'Wartet'), ni.updateTaskStatus('c', 'Heute')])
      const patches = failing.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patches).toHaveLength(3)
      patches.forEach((call) => expect(bodyOf(call).properties.Status).toHaveProperty('select'))
      expect(handleErrorSpy).not.toHaveBeenCalled()

      const healthy = mockProxy('status')
      await ni.updateTaskStatus('d', 'Jetzt')
      expect(callsTo(healthy, '/api/notion/data-sources?id=')).toHaveLength(1)
    })

    it('does not memoize select when the schema lacks the mapped property', async () => {
      const absent = mockProxy('status', [], 'absent')
      const ni = makeSut()
      await ni.getActiveBoardTasks()
      expect(bodyOf(callsTo(absent, '/api/notion/query-data-source')[0]!).filter.or[0]).toHaveProperty('select')

      const healthy = mockProxy('status')
      await ni.getActiveBoardTasks()
      expect(callsTo(healthy, '/api/notion/data-sources?id=')).toHaveLength(1)
      expect(bodyOf(callsTo(healthy, '/api/notion/query-data-source')[0]!).filter.or[0]).toHaveProperty('status')
    })

    it('uses select without a schema read when no data source is configured', async () => {
      const fetchMock = mockProxy('status')
      const ni = new NotionIntegration(token, db, propertyMapping as any, statusMapping as any, undefined, null)
      await ni.updateTaskStatus('pg1', 'Jetzt')
      expect(callsTo(fetchMock, '/api/notion/data-sources?id=')).toHaveLength(0)
    })
  })
})
