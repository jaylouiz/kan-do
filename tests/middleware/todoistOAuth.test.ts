import { describe, it, expect, beforeEach, vi } from 'vitest'

const secretsMock = { available: true, set: vi.fn() }
vi.mock('~/composables/useSecrets', () => ({ useSecrets: () => secretsMock }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))
const boardMock = { setTodoistApiToken: vi.fn() }
vi.mock('~/store/board', () => ({ useBoardStore: () => boardMock }))
const tasksMock = { beginSourceSwitch: vi.fn() }
vi.mock('~/store/tasks', () => ({ useTasksStore: () => tasksMock }))
const fetchTasks = vi.fn().mockResolvedValue(undefined)
vi.mock('~/composables/useIntegrationManager', () => ({ useIntegrationManager: () => ({ fetchTasks }) }))

const isTauriMock = vi.fn(() => false)
vi.mock('~/utils/isTauri', () => ({ isTauri: () => isTauriMock() }))

const navigateToMock = vi.fn()
const fetchMock = vi.fn()

async function runMiddleware() {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
  vi.stubGlobal('navigateTo', navigateToMock)
  vi.stubGlobal('$fetch', fetchMock)
  const { default: middleware } = await import('~/middleware/todoistOAuth')
  return (middleware as unknown as (to: unknown) => Promise<unknown>)({ path: '/welcome', query: { code: 'abc' } })
}

describe('todoistOAuth middleware (#223 L2)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    secretsMock.available = true
    isTauriMock.mockReturnValue(false)
    fetchMock.mockResolvedValue({ access_token: 'td_oauth' })
    secretsMock.set.mockResolvedValue(undefined)
  })

  it('writes the Keychain first, then sets the token', async () => {
    await runMiddleware()
    expect(secretsMock.set).toHaveBeenCalledWith('todoist-token', 'td_oauth')
    expect(boardMock.setTodoistApiToken).toHaveBeenCalledWith('td_oauth')
    expect(tasksMock.beginSourceSwitch).toHaveBeenCalledWith('todoist') // marks the switch; the first fetch replaces the board
    expect(fetchTasks).toHaveBeenCalled()
    expect(navigateToMock).toHaveBeenCalledWith('/tasks', { redirectCode: 301 })
  })

  it('reports a Keychain failure via useErrorHandler and does not half-configure Todoist', async () => {
    const failure = new Error('keychain')
    secretsMock.set.mockRejectedValue(failure)
    await runMiddleware()
    expect(handleErrorMock).toHaveBeenCalledWith(failure, 'secrets')
    expect(boardMock.setTodoistApiToken).not.toHaveBeenCalled()
    expect(tasksMock.beginSourceSwitch).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('reports a failed token exchange via useErrorHandler and does not configure Todoist', async () => {
    const failure = new Error('exchange failed')
    fetchMock.mockRejectedValue(failure)
    await runMiddleware()
    expect(handleErrorMock).toHaveBeenCalledWith(failure, 'todoist_setup')
    expect(secretsMock.set).not.toHaveBeenCalled()
    expect(boardMock.setTodoistApiToken).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('never logs the OAuth code', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMiddleware()
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('does nothing on Tauri: no exchange, no Keychain, no store, no navigation', async () => {
    isTauriMock.mockReturnValue(true)
    await runMiddleware()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(secretsMock.set).not.toHaveBeenCalled()
    expect(boardMock.setTodoistApiToken).not.toHaveBeenCalled()
    expect(tasksMock.beginSourceSwitch).not.toHaveBeenCalled()
    expect(fetchTasks).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
