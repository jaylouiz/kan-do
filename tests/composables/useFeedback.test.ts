import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resetFeedbackState, useFeedback } from '~/composables/useFeedback'
import { toastAddMock } from '../mocks/nuxt-imports'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.2.3' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
const openUrlMock = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args) } // also routes a real `@tauri-apps/api/core` that Vitest hands out to concurrent first imports
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

type Call = [string, Record<string, unknown>?]
/** The write-access check of the token's user (`GET /repos/<repo>`), asked before the in-app send is offered. */
const isAccessCheck = ([name, args]: Call) => name === 'github_request' && args?.method === 'GET' && args?.path === '/repos/jaylouiz/kan-do'
/** IPC calls of one command; `github_request` without the access check, which `accessChecks()` counts. */
const calls = (cmd: string) => (invokeMock.mock.calls as Call[]).filter(call => call[0] === cmd && !isAccessCheck(call))
const accessChecks = () => (invokeMock.mock.calls as Call[]).filter(isAccessCheck)

/** Answers `secret_status` and `github_request` like the Rust side. `access`: the token user's write access (or a failed check). */
function stubIpc(opts: { present?: boolean, rejected?: boolean, request?: () => unknown, log?: string, access?: 'write' | 'readOnly' | 'offline' } = {}) {
  const { present = true, rejected = false, log = '', access = 'write', request = () => ({ status: 201, body: { number: 42, html_url: 'https://github.com/jaylouiz/kan-do/issues/42' } }) } = opts
  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'secret_status') return { 'github-feedback': { state: 'ok', present, last4: 'abcd', rejected } }
    if (isAccessCheck([cmd, args])) {
      if (access === 'offline') throw { kind: 'network' }
      return { status: 200, body: { permissions: { push: access === 'write', pull: true } } }
    }
    if (cmd === 'github_request') return request()
    if (cmd === 'log_tail') return log
    return null
  })
}

async function fill(feedback: ReturnType<typeof useFeedback>) {
  feedback.open()
  feedback.draft.title = 'Karte abgeschnitten'
  feedback.draft.description = 'Der Titel ist zu lang.'
  await feedback.toReview()
}

describe('useFeedback', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetFeedbackState()
    invokeMock.mockReset()
    openUrlMock.mockReset()
    handleErrorMock.mockReset()
    toastAddMock.mockReset()
    setDesktop(true)
  })
  afterEach(() => setDesktop(false))

  it('adds the real app version and the log tail, and drops the log when the item is removed', async () => {
    stubIpc({ log: '12:00 INFO update check: up-to-date 1.2.3' })
    const feedback = useFeedback()
    await fill(feedback)
    await vi.waitFor(() => expect(feedback.logTail.value).toContain('update check'))
    expect(calls('log_tail')[0]?.[1]).toEqual({ lines: 30 })
    expect(feedback.versionInfo.value?.version).toBe('1.2.3')
    expect(feedback.body.value).toContain('update check: up-to-date')
    expect(feedback.body.value).toContain('1.2.3')
    feedback.draft.include.log = false
    expect(feedback.body.value).not.toContain('update check')
  })

  it('still opens with an unknown version and no log when the native calls fail', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'log_tail') throw new Error('log unreadable')
      return null
    })
    const feedback = useFeedback()
    feedback.open()
    await vi.waitFor(() => expect(calls('log_tail')).toHaveLength(1))
    expect(feedback.logTail.value).toBe('')
    expect(feedback.body.value).not.toContain('Log (last')
  })

  it('keeps the draft in memory only: nothing is written to any storage', async () => {
    stubIpc()
    const writes: string[] = []
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => { writes.push(key) })
    const feedback = useFeedback()
    await fill(feedback)
    feedback.draft.element = { chain: ['TaskCard'], testId: null, selector: 'body', rect: { x: 0, y: 0, width: 1, height: 1 }, taskId: null }
    feedback.close()
    feedback.discard()
    set.mockRestore()
    expect(writes).toEqual([])
    expect(calls('data_set')).toEqual([])
  })

  it('keeps the draft when the dialog closes and drops it on discard', () => {
    const feedback = useFeedback()
    feedback.open()
    feedback.draft.title = 'Titel'
    feedback.close()
    expect(feedback.draft.title).toBe('Titel')
    expect(feedback.hasDraft.value).toBe(true)
    feedback.discard()
    expect(feedback.draft.title).toBe('')
    expect(feedback.hasDraft.value).toBe(false)
  })

  it('needs a title before the review step', async () => {
    stubIpc()
    const feedback = useFeedback()
    feedback.open()
    await feedback.toReview()
    expect(feedback.step.value).toBe('form')
    feedback.draft.title = 'x'.repeat(121)
    expect(feedback.titleValid.value).toBe(false)
    feedback.draft.title = 'ok'
    expect(feedback.titleValid.value).toBe(true)
  })

  it('creates the issue through github_request with the inbox label, then closes and clears', async () => {
    stubIpc()
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.canSend.value).toBe(true)
    const body = feedback.body.value
    await feedback.send()

    const args = calls('github_request')[0]![1]!
    expect(args).toMatchObject({ entry: 'github-feedback', method: 'POST', path: '/repos/jaylouiz/kan-do/issues' })
    expect(args.body).toEqual({ title: 'Karte abgeschnitten', body, labels: ['inbox'] })
    expect(feedback.isOpen.value).toBe(false)
    expect(feedback.hasDraft.value).toBe(false)
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(toastAddMock.mock.calls[0]![0].title).toContain('#42')
  })

  it('opens the created issue from the toast through the opener, only inside the pinned repo', async () => {
    stubIpc({ request: () => ({ status: 201, body: { number: 7, html_url: 'https://evil.example/issues/7' } }) })
    const feedback = useFeedback()
    await fill(feedback)
    await feedback.send()
    toastAddMock.mock.calls[0]![0].actions[0].onClick()
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledWith('https://github.com/jaylouiz/kan-do/issues/7'))
  })

  it('omits removed context items from the body', async () => {
    stubIpc()
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.body.value).toContain('## Context')
    feedback.draft.include.environment = false
    feedback.draft.include.version = false
    expect(feedback.body.value).not.toContain('## Context')
    expect(feedback.body.value).toContain('_Filed from kan-do via in-app feedback_')
  })

  it('short-circuits a rejected token without any request and offers the browser fallback', async () => {
    stubIpc({ rejected: true })
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.tokenState.value).toBe('rejected')
    expect(feedback.canSend.value).toBe(false)
    await feedback.send()
    expect(calls('github_request')).toEqual([])
  })

  it('uses the fallback when no token is stored', async () => {
    stubIpc({ present: false })
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.tokenState.value).toBe('absent')
    await feedback.openInBrowser()
    expect(openUrlMock).toHaveBeenCalledTimes(1)
    const url = new URL(openUrlMock.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/jaylouiz/kan-do/issues/new')
    expect(url.searchParams.get('title')).toBe('Karte abgeschnitten')
    expect(url.searchParams.get('labels')).toBe('inbox')
    expect(url.searchParams.get('body')).toContain('Der Titel ist zu lang.')
    expect(calls('github_request')).toEqual([])
    expect(feedback.isOpen.value).toBe(false)
    expect(toastAddMock.mock.calls.map(c => c[0].title)).toEqual(['GitHub ist im Browser geöffnet. Sende das Issue dort ab.'])
  })

  it('knows the token state on the form already, so the form can name the GitHub account (public repository)', async () => {
    stubIpc({ present: false })
    const feedback = useFeedback()
    feedback.open()
    await vi.waitFor(() => expect(feedback.tokenState.value).toBe('absent'))
    expect(feedback.step.value).toBe('form')
    expect(calls('github_request')).toEqual([])
  })

  it('a token whose user may not write to the repo takes the browser path; the check is asked once per token', async () => {
    stubIpc({ access: 'readOnly' })
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.tokenState.value).toBe('readOnly')
    expect(feedback.canSend.value).toBe(false)
    await feedback.send()
    await feedback.openInBrowser()
    expect(openUrlMock).toHaveBeenCalledTimes(1)
    expect(calls('github_request')).toEqual([])
    // open() and the review step both read the state; the check itself ran once
    expect(accessChecks()).toHaveLength(1)
  })

  it('a token whose user may write sends in-app; a failed check keeps the in-app send', async () => {
    stubIpc({ access: 'write' })
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.tokenState.value).toBe('present')
    resetFeedbackState()
    stubIpc({ access: 'offline' })
    const offline = useFeedback()
    await fill(offline)
    expect(offline.tokenState.value).toBe('present')
  })

  it('keeps the dialog and the draft when the opener fails', async () => {
    stubIpc({ present: false })
    openUrlMock.mockRejectedValueOnce(new Error('denied'))
    const feedback = useFeedback()
    await fill(feedback)
    await feedback.openInBrowser()
    expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'feedback')
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.draft.title).toBe('Karte abgeschnitten')
  })

  describe.each([
    ['offline', () => Promise.reject({ kind: 'network' }), 'offline'],
    ['timeout', () => Promise.reject({ kind: 'timeout' }), 'offline'],
    ['rate limit (403)', () => ({ status: 403, body: { message: 'rate limit' } }), 'blocked'],
    ['5xx', () => ({ status: 502, body: null }), 'server'],
    ['unexpected (422)', () => ({ status: 422, body: { message: 'Validation Failed' } }), 'unexpected'],
  ])('error: %s', (_name, request, expected) => {
    it(`maps to "${expected}", keeps the draft and the dialog, never retries by itself`, async () => {
      stubIpc({ request: request as () => unknown })
      const feedback = useFeedback()
      await fill(feedback)
      await feedback.send()
      expect(feedback.problem.value).toBe(expected)
      expect(feedback.isOpen.value).toBe(true)
      expect(feedback.step.value).toBe('review')
      expect(feedback.draft.title).toBe('Karte abgeschnitten')
      expect(feedback.sending.value).toBe(false)
      expect(calls('github_request')).toHaveLength(1)
      expect(toastAddMock).not.toHaveBeenCalled()
      expect(handleErrorMock).toHaveBeenCalledTimes(expected === 'unexpected' ? 1 : 0)
    })
  })

  it('a 401 flips to the fallback for the rest of the session', async () => {
    stubIpc({ request: () => Promise.reject({ kind: 'rejected' }) })
    const feedback = useFeedback()
    await fill(feedback)
    await feedback.send()
    expect(feedback.problem.value).toBe('rejected')
    expect(feedback.tokenState.value).toBe('rejected')
    expect(feedback.canSend.value).toBe(false)
    expect(feedback.draft.title).toBe('Karte abgeschnitten')
  })

  it('does not send twice while a send is running', async () => {
    let release: (value: unknown) => void = () => {}
    stubIpc({ request: () => new Promise((resolve) => { release = resolve }) })
    const feedback = useFeedback()
    await fill(feedback)
    const first = feedback.send()
    await vi.waitFor(() => expect(calls('github_request')).toHaveLength(1))
    await feedback.send()
    release({ status: 201, body: { number: 1 } })
    await first
    expect(calls('github_request')).toHaveLength(1)
  })

  it('only sends the task title when the user ticked it', async () => {
    stubIpc()
    const { useTasksStore } = await import('~/store/tasks')
    const store = useTasksStore()
    store.tasks = [{ id: 't-1', title: 'Geheimer Titel' } as never]
    const feedback = useFeedback()
    await fill(feedback)
    feedback.draft.element = { chain: [], testId: null, selector: 'body', rect: { x: 0, y: 0, width: 1, height: 1 }, taskId: 't-1' }
    expect(feedback.body.value).toContain('`t-1`')
    expect(feedback.body.value).not.toContain('Geheimer Titel')
    feedback.draft.include.taskTitle = true
    expect(feedback.body.value).toContain('Geheimer Titel')
  })

  it('ignores close while a send runs and shows the failure afterwards', async () => {
    let release: (value: unknown) => void = () => {}
    stubIpc({ request: () => new Promise((resolve) => { release = resolve }) })
    const feedback = useFeedback()
    await fill(feedback)
    const sending = feedback.send()
    await vi.waitFor(() => expect(feedback.sending.value).toBe(true))
    feedback.close()
    expect(feedback.isOpen.value).toBe(true)
    await vi.waitFor(() => expect(calls('github_request')).toHaveLength(1))
    release({ status: 502, body: null })
    await sending
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.problem.value).toBe('server')
    feedback.close()
    expect(feedback.isOpen.value).toBe(false)
  })

  it('keeps the draft and the dialog when the link is known to be too long, but still opens it', async () => {
    stubIpc({ present: false })
    const feedback = useFeedback()
    feedback.open()
    feedback.draft.title = 'Lang'
    feedback.draft.description = 'ä'.repeat(4000)
    await feedback.toReview()
    expect(feedback.prefilled.value.overflow).toBe(true)
    await feedback.openInBrowser()
    expect(openUrlMock).toHaveBeenCalledTimes(1)
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.draft.description).toHaveLength(4000)
  })

  it('offers no stale "Rückgängig" after a successful send or a browser open', async () => {
    stubIpc()
    const feedback = useFeedback()
    await fill(feedback)
    feedback.discard()
    expect(feedback.canUndoDiscard.value).toBe(true)
    await fill(feedback)
    await feedback.send()
    expect(feedback.canUndoDiscard.value).toBe(false)

    stubIpc({ present: false })
    await fill(feedback)
    feedback.discard()
    await fill(feedback)
    await feedback.openInBrowser()
    expect(feedback.canUndoDiscard.value).toBe(false)
  })

  it('asks for the app version once per session', async () => {
    const getVersion = vi.fn(async () => '1.2.3')
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion }))
    stubIpc()
    const feedback = useFeedback()
    feedback.open()
    await vi.waitFor(() => expect(feedback.versionInfo.value?.version).toBe('1.2.3'))
    feedback.close()
    feedback.open()
    expect(feedback.versionInfo.value?.version).toBe('1.2.3')
    vi.doUnmock('@tauri-apps/api/app')
  })
})

describe('feedback code never touches the token or GitHub directly', () => {
  const root = join(__dirname, '..', '..')
  const files = [
    'composables/useFeedback.ts',
    'composables/useElementPicker.ts',
    ...['components/feedback', 'lib/feedback'].flatMap(dir => readdirSync(join(root, dir)).map(f => `${dir}/${f}`)),
  ]

  it.each(files)('%s', (file) => {
    const source = readFileSync(join(root, file), 'utf8')
    expect(source).not.toMatch(/secret_get|secrets\.get\(|\.get\(\s*'github|localStorage|sessionStorage|appStorage/)
    expect(source).not.toMatch(/\$?fetch\(|api\.github\.com|XMLHttpRequest/)
  })
})
