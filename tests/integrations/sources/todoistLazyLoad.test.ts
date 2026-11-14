import { afterEach, describe, expect, it, vi } from 'vitest'

// The Todoist integration is loaded on the first call (#275). In the browser that load is a chunk request, which can
// fail like any request: the adapter must not keep the failure.

afterEach(() => {
  vi.doUnmock('~/integrations/TodoistIntegration')
  vi.resetModules()
})

describe('TodoistSource: loading the integration', () => {
  it('a failed load rejects that call and is tried again by the next call (fail -> ok -> ok)', async () => {
    let loads = 0
    vi.doMock('~/integrations/TodoistIntegration', () => {
      loads += 1
      if (loads === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return {
        TodoistIntegration: vi.fn().mockImplementation(function () {
          return { fetchActiveBoardTasks: async () => [] }
        }),
      }
    })
    const { TodoistSource } = await import('~/integrations/sources/TodoistSource')
    const source = new TodoistSource({ apiToken: () => 'token', health: () => 'healthy' })

    // The browser rejects a failed chunk load with a TypeError (which `isNetworkError` reads as offline); Vitest wraps
    // what the mock factory throws, so only the rejection itself is asserted here
    await expect(source.fetchActive()).rejects.toBeInstanceOf(Error)

    expect(await source.fetchActive()).toEqual([])
    expect(await new TodoistSource({ apiToken: () => 'token', health: () => 'healthy' }).fetchActive()).toEqual([])
    expect(loads).toBe(2)
  })

  it('without a token nothing is loaded', async () => {
    let loads = 0
    vi.doMock('~/integrations/TodoistIntegration', () => {
      loads += 1
      return { TodoistIntegration: vi.fn() }
    })
    const { TodoistSource } = await import('~/integrations/sources/TodoistSource')
    const source = new TodoistSource({ apiToken: () => null, health: () => 'healthy' })
    await expect(source.fetchActive()).rejects.toMatchObject({ name: 'SourceNotConfiguredError' })
    expect(loads).toBe(0)
  })
})
