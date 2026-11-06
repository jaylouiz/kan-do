import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))

// Capture the options the integration hands to the SDK, and let tests drive the SDK's requests.
const closeTaskMock = vi.fn()
const addTaskMock = vi.fn()
const reopenTaskMock = vi.fn()
const getLabelsMock = vi.fn()
const getProjectsMock = vi.fn()
const getTasksMock = vi.fn()
const getCompletedMock = vi.fn()
const getTaskMock = vi.fn()
const todoistApiCtor = vi.fn()
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function (...args: unknown[]) {
    todoistApiCtor(...args)
    return {
      addTask: addTaskMock, closeTask: closeTaskMock, reopenTask: reopenTaskMock,
      getLabels: getLabelsMock, getProjects: getProjectsMock, getTasks: getTasksMock, getTask: getTaskMock,
      getCompletedTasksByCompletionDate: getCompletedMock,
    }
  }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import {
  TodoistIntegration,
  TodoistTimeoutError,
  isTodoistTimeoutError,
  TODOIST_TIMEOUT_MS,
  createTimeoutFetch,
} from '~/integrations/TodoistIntegration'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { isNetworkError } from '~/lib/errorMessages'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import completedFixture from '../fixtures/todoist/completed-by-completion-date.json'

/** A fetch that never settles by itself and rejects with the abort reason once its signal fires. */
const hangingFetch = () => {
  const signals: AbortSignal[] = []
  const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) return
    signals.push(signal)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  return { fetchImpl: fetchImpl as unknown as typeof fetch, signals }
}

describe('createTimeoutFetch (#159)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the same 10s limit as the Notion client', () => {
    expect(TODOIST_TIMEOUT_MS).toBe(10000)
  })

  it('aborts the underlying fetch after the timeout and rejects with a recognisable error', async () => {
    const { fetchImpl, signals } = hangingFetch()
    const customFetch = createTimeoutFetch(TODOIST_TIMEOUT_MS, fetchImpl)

    const request = customFetch('https://api.todoist.com/x', { method: 'POST' })
    const outcome = expect(request).rejects.toBeInstanceOf(TodoistTimeoutError)
    await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS - 1)
    expect(signals[0]!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await outcome
    expect(signals[0]!.aborted).toBe(true)
    await expect(request).rejects.toMatchObject({ name: 'TodoistTimeoutError' })
  })

  it('does not use the SDK error names that trigger the SDK retry (writes must not be retried)', async () => {
    const { fetchImpl } = hangingFetch()
    const request = createTimeoutFetch(50, fetchImpl)('https://api.todoist.com/x')
    const caught = request.then(() => new Error('resolved'), (error: Error) => error)
    await vi.advanceTimersByTimeAsync(50)

    const error = await caught
    // The SDK retries `TimeoutError`, `isNetworkError` and fetch TypeErrors (3x)
    expect(error.name).not.toBe('TimeoutError')
    expect(error).not.toBeInstanceOf(TypeError)
    expect((error as { isNetworkError?: boolean }).isNetworkError).toBeUndefined()
  })

  it('caps a larger SDK-supplied timeout and honours a smaller one', async () => {
    const big = hangingFetch()
    const capped = createTimeoutFetch(1000, big.fetchImpl)('https://api.todoist.com/x', { timeout: 30000 })
    const cappedOutcome = expect(capped).rejects.toBeInstanceOf(TodoistTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await cappedOutcome

    const small = hangingFetch()
    const shorter = createTimeoutFetch(1000, small.fetchImpl)('https://api.todoist.com/x', { timeout: 200 })
    const shorterOutcome = expect(shorter).rejects.toBeInstanceOf(TodoistTimeoutError)
    await vi.advanceTimersByTimeAsync(200)
    await shorterOutcome
  })

  it('also covers a response body that never arrives', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      }),
    })) as unknown as typeof fetch

    const request = createTimeoutFetch(100, fetchImpl)('https://api.todoist.com/x')
    const outcome = expect(request).rejects.toBeInstanceOf(TodoistTimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await outcome
  })

  it('rejects with our timeout when the engine aborts fetch with a generic AbortError', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })) as unknown as typeof fetch

    const request = createTimeoutFetch(100, fetchImpl)('https://api.todoist.com/x')
    const outcome = expect(request).rejects.toBeInstanceOf(TodoistTimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await outcome
  })

  it('leaves a caller abort alone when the engine rejects with a generic AbortError', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const caller = new AbortController()

    const request = createTimeoutFetch(10000, fetchImpl)('https://api.todoist.com/x', { signal: caller.signal })
    const outcome = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    caller.abort(new Error('caller gave up'))
    await outcome
  })

  it('passes a caller abort through to the underlying fetch', async () => {
    const { fetchImpl, signals } = hangingFetch()
    const caller = new AbortController()
    const request = createTimeoutFetch(10000, fetchImpl)('https://api.todoist.com/x', { signal: caller.signal })
    const outcome = expect(request).rejects.toBeDefined()

    caller.abort(new Error('caller gave up'))

    await outcome
    expect(signals[0]!.aborted).toBe(true)
    await expect(request).rejects.not.toBeInstanceOf(TodoistTimeoutError)
  })

  it('returns the SDK CustomFetchResponse shape and clears the timer', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

    const response = await createTimeoutFetch(10000, fetchImpl)('https://api.todoist.com/x')

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('OK')
    expect(response.headers).toEqual({ 'content-type': 'application/json' })
    expect(await response.text()).toBe('{"ok":true}')
    expect(await response.json()).toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes error statuses through for the SDK to map, and clears the timer', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"nope"}', {
      status: 403,
      statusText: 'Forbidden',
    })) as unknown as typeof fetch

    const response = await createTimeoutFetch(10000, fetchImpl)('https://api.todoist.com/x')

    expect(response.ok).toBe(false)
    expect(response.status).toBe(403)
    expect(response.statusText).toBe('Forbidden')
    expect(await response.json()).toEqual({ error: 'nope' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer when the request fails before the timeout', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    await expect(createTimeoutFetch(10000, fetchImpl)('https://api.todoist.com/x')).rejects.toBeInstanceOf(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })
})


const camel = (key: string) => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
/** The SDK camelCases the v1 response; the recorded fixture keeps the wire format. */
const sdkCompletedPage = (fixture: typeof completedFixture) => ({
  items: fixture.items.map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [camel(k), v]))),
  nextCursor: fixture.next_cursor,
})

describe('TodoistIntegration timeouts (#159)', () => {
  beforeEach(() => {
    handleErrorMock.mockReset()
    closeTaskMock.mockReset()
    addTaskMock.mockReset()
    reopenTaskMock.mockReset()
    ;[getLabelsMock, getProjectsMock, getTasksMock, getTaskMock, getCompletedMock].forEach((mock) => mock.mockReset())
    todoistApiCtor.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands the SDK a custom fetch', () => {
    new TodoistIntegration('token')

    expect(todoistApiCtor).toHaveBeenCalledWith('token', { customFetch: expect.any(Function) })
  })

  it.each([
    ['completeTask', closeTaskMock],
    ['reopenTask', reopenTaskMock],
  ] as const)('%s rethrows the timeout so the caller can tell the write may not have landed', async (method, sdkMock) => {
    sdkMock.mockRejectedValue(new TodoistTimeoutError(TODOIST_TIMEOUT_MS))

    await expect(new TodoistIntegration('token')[method]('t1')).rejects.toSatisfy(isTodoistTimeoutError)

    expect(handleErrorMock).not.toHaveBeenCalled() // the caller reports it once
  })

  it.each([
    ['completeTask', closeTaskMock],
    ['reopenTask', reopenTaskMock],
  ] as const)('%s rethrows the timeout after the SDK rewrapped it as a plain request error', async (method, sdkMock) => {
    // What the SDK throws: class and name are gone, only the message survives
    sdkMock.mockRejectedValue(new Error(new TodoistTimeoutError(TODOIST_TIMEOUT_MS).message))

    await expect(new TodoistIntegration('token')[method]('t1')).rejects.toSatisfy(isTodoistTimeoutError)
  })

  it.each([
    ['completeTask', closeTaskMock],
    ['reopenTask', reopenTaskMock],
  ] as const)('%s rejects with a Todoist-prefixed error that keeps the original message and cause (#168)', async (method, sdkMock) => {
    const failure = new Error('HTTP 500: Internal Server Error')
    sdkMock.mockRejectedValue(failure)

    const rejection = await new TodoistIntegration('token')[method]('t1').catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toBe('Todoist: HTTP 500: Internal Server Error')
    expect((rejection as Error).cause).toBe(failure)
    expect(isTodoistTimeoutError(rejection)).toBe(false)
    expect(handleErrorMock).not.toHaveBeenCalled() // the caller reports it once, as task_sync
  })

  it.each([
    ['completeTask', closeTaskMock],
    ['reopenTask', reopenTaskMock],
  ] as const)('%s rejects an offline fetch TypeError in a form isNetworkError still recognises', async (method, sdkMock) => {
    sdkMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const rejection = await new TodoistIntegration('token')[method]('t1').catch((error: unknown) => error)

    expect((rejection as Error).message).toBe('Todoist: Failed to fetch')
    expect(isNetworkError(rejection)).toBe(true)
  })

  it.each([
    ['completeTask', closeTaskMock, 'completing'],
    ['reopenTask', reopenTaskMock, 'reopening'],
  ] as const)('%s rejects when the SDK does not confirm', async (method, sdkMock, verb) => {
    sdkMock.mockResolvedValue(false)

    await expect(new TodoistIntegration('token')[method]('t1')).rejects.toThrow(`Todoist did not confirm ${verb} task t1`)
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it.each([
    ['completeTask', closeTaskMock],
    ['reopenTask', reopenTaskMock],
  ] as const)('%s resolves without logging when the SDK confirms', async (method, sdkMock) => {
    sdkMock.mockResolvedValue(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(new TodoistIntegration('token')[method]('t1')).resolves.toBeUndefined()

    expect(log).not.toHaveBeenCalled()
    expect(handleErrorMock).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('getCompletedTodayTasks goes through the SDK timeout fetch and rejects on a hung request', async () => {
    vi.useFakeTimers()
    try {
      const { fetchImpl, signals } = hangingFetch()
      vi.stubGlobal('fetch', fetchImpl)
      const integration = new TodoistIntegration('token') as unknown as {
        getCompletedTodayTasks(): Promise<unknown[]>
      }
      const installed = todoistApiCtor.mock.calls[0]![1].customFetch as ReturnType<typeof createTimeoutFetch>
      getCompletedMock.mockImplementation(() => installed('https://api.todoist.com/api/v1/tasks/completed/by_completion_date'))

      const done = integration.getCompletedTodayTasks()
      const outcome = expect(done).rejects.toBeInstanceOf(TodoistTimeoutError)
      await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)

      await outcome
      expect(signals[0]!.aborted).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  describe('createTask for a restore (#422)', () => {
    const done = { id: 'old', source: 'todoist', externalId: 'old', title: 'Report', status: TaskStatus.Done, activity: null, topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null } as const

    it('a Done task is created, then completed', async () => {
      getProjectsMock.mockResolvedValue({ results: [] })
      addTaskMock.mockResolvedValue({ id: 'new-1' })
      closeTaskMock.mockResolvedValue(true)
      const created = await new TodoistIntegration('token').createTask({ ...done })
      expect(created).toMatchObject({ id: 'new-1', externalId: 'new-1', source: 'todoist' })
      expect(closeTaskMock).toHaveBeenCalledWith('new-1')
    })

    it('returns the created task when only the completion fails (a retry would create a second one)', async () => {
      getProjectsMock.mockResolvedValue({ results: [] })
      addTaskMock.mockResolvedValue({ id: 'new-1' })
      closeTaskMock.mockRejectedValue(new Error('network'))
      const created = await new TodoistIntegration('token').createTask({ ...done })
      expect(created).toMatchObject({ externalId: 'new-1', source: 'todoist' })
      expect(addTaskMock).toHaveBeenCalledTimes(1)
    })

    it('still rejects when the task could not be created', async () => {
      getProjectsMock.mockResolvedValue({ results: [] })
      addTaskMock.mockRejectedValue(new Error('boom'))
      await expect(new TodoistIntegration('token').createTask({ ...done })).rejects.toThrow('Todoist: boom')
      expect(closeTaskMock).not.toHaveBeenCalled()
    })
  })

  describe('priority levels (#617)', () => {
    const base = { id: 'old', source: 'todoist', externalId: 'old', title: 'Report', status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null } as const

    it('createTask sends 1, 2 and 4 for low, regular and high; a stored 4 as high, no priority (0, invalid) as regular (#653)', async () => {
      getProjectsMock.mockResolvedValue({ results: [] })
      addTaskMock.mockResolvedValue({ id: 'new-1' })
      const sent: number[] = []
      for (const priority of [1, 2, 3, 4, 0, -1]) {
        await new TodoistIntegration('token').createTask({ ...base, priority })
        sent.push(addTaskMock.mock.calls.at(-1)![0].priority)
      }
      // no priority reads as Normal (#653), so it is written as Normal
      expect(sent).toEqual([1, 2, 4, 4, 2, 2])
    })

    it('reads API 1/2/3/4 as low/regular/high/high', async () => {
      getLabelsMock.mockResolvedValue({ results: [] })
      getProjectsMock.mockResolvedValue({ results: [] })
      getTasksMock.mockResolvedValue({
        results: [1, 2, 3, 4].map((priority) => ({ id: `t${priority}`, content: 'A', description: '', checked: false, priority, labels: [], projectId: 'p1' })),
      })
      getCompletedMock.mockResolvedValue({ items: [], nextCursor: null })
      const tasks = await new TodoistIntegration('token').fetchActiveBoardTasks()
      expect(tasks.map((task) => task.priority)).toEqual([1, 2, 3, 3])
      vi.unstubAllGlobals()
    })
  })

  describe('fetching the active board (#340)', () => {
    const sdkTask = { id: 't1', content: 'A', description: '', checked: false, priority: 1, labels: [], projectId: 'p1' }
    const healthySdk = () => {
      getLabelsMock.mockResolvedValue({ results: [] })
      getProjectsMock.mockResolvedValue({ results: [] })
      getTasksMock.mockResolvedValue({ results: [sdkTask] })
      getCompletedMock.mockResolvedValue({ items: [], nextCursor: null })
    }
    afterEach(() => vi.unstubAllGlobals())

    it('fetchActiveBoardTasks resolves the open tasks of the day', async () => {
      healthySdk()

      const tasks = await new TodoistIntegration('token').fetchActiveBoardTasks()

      expect(tasks.map((task) => task.id)).toEqual(['t1'])
      expect(handleErrorMock).not.toHaveBeenCalled()
    })

    it('maps a task without the raw upstream object (#334)', async () => {
      healthySdk()

      const [task] = await new TodoistIntegration('token').fetchActiveBoardTasks()

      expect(task).toBeDefined()
      expect(task).not.toHaveProperty('sourceData')
      expect(task).toMatchObject({ id: 't1', externalId: 't1', source: 'todoist' })
    })

    it.each([
      ['labels', () => getLabelsMock.mockRejectedValue(new Error('HTTP 401'))],
      ['projects', () => getProjectsMock.mockRejectedValue(new Error('HTTP 500'))],
      ['open tasks', () => getTasksMock.mockRejectedValue(new TypeError('Failed to fetch'))],
    ] as const)('fetchActiveBoardTasks rejects when the %s request fails, without reporting it', async (_name, fail) => {
      healthySdk()
      fail()

      await expect(new TodoistIntegration('token').fetchActiveBoardTasks()).rejects.toBeInstanceOf(Error)
      expect(handleErrorMock).not.toHaveBeenCalled()
    })

    it('fetchActiveBoardTasks rejects without a token', async () => {
      await expect(new TodoistIntegration('').fetchActiveBoardTasks()).rejects.toThrow('No Todoist API token configured')
    })

    it('getActiveBoardTasks keeps swallowing: it reports the failure once and returns []', async () => {
      healthySdk()
      getTasksMock.mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(new TodoistIntegration('token').getActiveBoardTasks()).resolves.toEqual([])
      expect(handleErrorMock).toHaveBeenCalledTimes(1)
    })

    it('maps the recorded completed-by-completion-date response to Done tasks (#343)', async () => {
      healthySdk()
      getCompletedMock.mockResolvedValue(sdkCompletedPage(completedFixture))

      const tasks = await new TodoistIntegration('token').fetchActiveBoardTasks()

      expect(tasks.map((task) => [task.id, task.title, task.status])).toEqual([
        ['done-1', 'Write the report', TaskStatus.Done],
        ['done-2', 'Send it', TaskStatus.Done],
        ['t1', 'A', TaskStatus.Open],
      ])
      expect(tasks[0]).toMatchObject({ externalId: 'done-1', source: 'todoist', notes: 'Quarterly numbers', timeBoxSeconds: 25 * 60 })
      expect(getTaskMock).not.toHaveBeenCalled() // no per-task refetch
    })

    describe('completed window and paging (#343)', () => {
      afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
      })
      const originalTz = process.env.TZ
      afterEach(() => {
        if (originalTz === undefined) delete process.env.TZ
        else process.env.TZ = originalTz
      })

      it.each([
        // [timezone, "now" instant, local-midnight since, next local-midnight until]
        ['Pacific/Auckland', '2026-10-28T03:00:00Z', '2026-10-27T11:00:00.000Z', '2026-10-28T11:00:00.000Z'],
        ['America/Los_Angeles', '2026-10-28T20:00:00Z', '2026-10-28T07:00:00.000Z', '2026-10-29T07:00:00.000Z'],
        // DST ends in Los Angeles on 2026-11-01: that local day is 25 hours long
        ['America/Los_Angeles', '2026-11-01T20:00:00Z', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'],
        // DST starts in Auckland on 2026-09-27: that local day is 23 hours long
        ['Pacific/Auckland', '2026-09-27T05:00:00Z', '2026-09-26T12:00:00.000Z', '2026-09-27T11:00:00.000Z'],
      ])('%s: asks for the local day [%s) as UTC ISO strings', async (tz, now, since, until) => {
        process.env.TZ = tz
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(now))
        healthySdk()

        await new TodoistIntegration('token').fetchActiveBoardTasks()

        expect(getCompletedMock).toHaveBeenCalledTimes(1)
        expect(getCompletedMock).toHaveBeenCalledWith({ since, until, cursor: null, limit: 200 })
      })

      it('follows nextCursor until it is empty', async () => {
        healthySdk()
        const [first, second] = sdkCompletedPage(completedFixture).items
        getCompletedMock
          .mockResolvedValueOnce({ items: [first], nextCursor: 'c1' })
          .mockResolvedValueOnce({ items: [second], nextCursor: null })

        const tasks = await new TodoistIntegration('token').fetchActiveBoardTasks()

        expect(getCompletedMock).toHaveBeenCalledTimes(2)
        expect(getCompletedMock.mock.calls[1]![0]).toMatchObject({ cursor: 'c1' })
        expect(tasks.map((task) => task.id)).toEqual(['done-1', 'done-2', 't1'])
      })

      it('stops after 10 pages when the cursor never ends', async () => {
        healthySdk()
        getCompletedMock.mockResolvedValue({ items: [], nextCursor: 'again' })

        await new TodoistIntegration('token').fetchActiveBoardTasks()

        expect(getCompletedMock).toHaveBeenCalledTimes(10)
      })
    })

    it.each([
      ['a retired endpoint (410)', () => getCompletedMock.mockRejectedValue(Object.assign(new Error('This endpoint is deprecated'), { httpStatusCode: 410 }))],
      ['a rejected request', () => getCompletedMock.mockRejectedValue(new TypeError('Failed to fetch'))],
      ['a body that is not JSON', () => getCompletedMock.mockRejectedValue(new SyntaxError('Unexpected token < in JSON'))],
    ] as const)('the completed-today request is optional: %s still yields the open tasks (#340 N1)', async (_name, arrange) => {
      healthySdk()
      arrange()

      const tasks = await new TodoistIntegration('token').fetchActiveBoardTasks()

      expect(tasks.map((task) => task.id)).toEqual(['t1'])
      expect(getTaskMock).not.toHaveBeenCalled()
      expect(handleErrorMock).not.toHaveBeenCalled() // the caller marks health, nothing is reported
    })

    it('the completed-today request is optional: a hung request times out and still yields the open tasks', async () => {
      healthySdk()
      vi.useFakeTimers()
      try {
        vi.stubGlobal('fetch', hangingFetch().fetchImpl)
        const integration = new TodoistIntegration('token')
        const installed = todoistApiCtor.mock.calls[0]![1].customFetch as ReturnType<typeof createTimeoutFetch>
        getCompletedMock.mockImplementation(() => installed('https://api.todoist.com/api/v1/tasks/completed/by_completion_date'))
        const running = integration.fetchActiveBoardTasks()
        await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)

        expect((await running).map((task) => task.id)).toEqual(['t1'])
        expect(handleErrorMock).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('a hung SDK request settles through the custom fetch the integration installed', async () => {
    vi.useFakeTimers()
    try {
      const { fetchImpl } = hangingFetch()
      vi.stubGlobal('fetch', fetchImpl)
      new TodoistIntegration('token')
      const installed = todoistApiCtor.mock.calls[0]![1].customFetch as ReturnType<typeof createTimeoutFetch>
      closeTaskMock.mockImplementation(() => installed('https://api.todoist.com/api/v1/tasks/t1/close', { method: 'POST', timeout: 30000 }))

      const integration = new TodoistIntegration('token')
      const done = integration.completeTask('t1')
      const outcome = expect(done).rejects.toBeInstanceOf(TodoistTimeoutError)
      await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)

      await outcome
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
