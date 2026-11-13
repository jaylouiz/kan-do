import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { resetFeedbackState, useFeedback } from '~/composables/useFeedback'
import { runtimeConfigMock, toastAddMock } from '../mocks/nuxt-imports'

/** #268: everyone without the owner's token sends through the relay route; the browser path is the fallback. */

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.2.3' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
const openUrlMock = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))
const sendToRelayMock = vi.fn()
vi.mock('~/lib/feedbackRelay', () => ({ sendToRelay: (...args: unknown[]) => sendToRelayMock(...args) }))

const RELAY = 'https://relay.example/api/feedback'
const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args) }
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

/** Desktop IPC: `push` is the write access of the stored token's user; `present: false` is no token at all. */
function stubIpc({ present = false, push = false } = {}) {
  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'secret_status') return { 'github-feedback': { state: 'ok', present, last4: 'abcd', rejected: false } }
    if (cmd === 'github_request' && args?.method === 'GET') return { status: 200, body: { permissions: { push } } }
    if (cmd === 'github_request') return { status: 201, body: { number: 7 } }
    if (cmd === 'log_tail') return ''
    return null
  })
}

async function fill(feedback: ReturnType<typeof useFeedback>) {
  feedback.open()
  feedback.draft.title = '  Karte abgeschnitten '
  feedback.draft.description = 'Der Titel ist zu lang.'
  await feedback.toReview()
}

describe('useFeedback: relay route', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetFeedbackState()
    invokeMock.mockReset()
    openUrlMock.mockReset()
    handleErrorMock.mockReset()
    toastAddMock.mockReset()
    sendToRelayMock.mockReset().mockResolvedValue('sent')
    runtimeConfigMock.public.feedbackRelayUrl = RELAY
    setDesktop(true)
    stubIpc()
  })
  afterEach(() => {
    setDesktop(false)
    runtimeConfigMock.public.feedbackRelayUrl = ''
  })

  it('without a token the report goes to the relay: exact body, no GitHub request, draft dropped, toast without a number', async () => {
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.sendRoute.value).toBe('relay')
    const shown = feedback.body.value
    await feedback.sendViaRelay()

    expect(sendToRelayMock).toHaveBeenCalledExactlyOnceWith(RELAY, { title: 'Karte abgeschnitten', body: shown })
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'github_request')).toEqual([])
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(feedback.isOpen.value).toBe(false)
    expect(feedback.draft.title).toBe('')
    expect(toastAddMock).toHaveBeenCalledOnce()
    expect(JSON.stringify(toastAddMock.mock.calls[0])).not.toMatch(/#\d|github\.com/)
  })

  it('a token without write access takes the relay; the owner (write access) keeps the direct send', async () => {
    stubIpc({ present: true, push: false })
    const reader = useFeedback()
    await fill(reader)
    expect(reader.sendRoute.value).toBe('relay')

    resetFeedbackState()
    stubIpc({ present: true, push: true })
    const owner = useFeedback()
    await fill(owner)
    expect(owner.sendRoute.value).toBe('token')
    await owner.sendViaRelay()
    expect(sendToRelayMock).not.toHaveBeenCalled()
  })

  it.each([
    ['offline', 'offline'],
    ['blocked', 'relayBlocked'],
    ['server', 'relayServer'],
    ['invalid', 'relayUnexpected'],
  ] as const)('%s keeps the draft and the relay route; a retry sends', async (result, problem) => {
    sendToRelayMock.mockResolvedValueOnce(result)
    const feedback = useFeedback()
    await fill(feedback)
    await feedback.sendViaRelay()
    expect(feedback.problem.value).toBe(problem)
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.draft.title).toContain('Karte abgeschnitten')
    expect(feedback.sendRoute.value).toBe('relay')

    await feedback.sendViaRelay()
    expect(sendToRelayMock).toHaveBeenCalledTimes(2)
    expect(feedback.isOpen.value).toBe(false)
  })

  it('no relay behind the URL: the session falls back to the browser path and the draft stays', async () => {
    sendToRelayMock.mockResolvedValue('unavailable')
    const feedback = useFeedback()
    await fill(feedback)
    await feedback.sendViaRelay()
    expect(feedback.problem.value).toBe('relayDown')
    expect(feedback.sendRoute.value).toBe('browser')
    expect(feedback.draft.title).toContain('Karte abgeschnitten')

    // The relay is not asked again; the prefilled link opens instead.
    await feedback.sendViaRelay()
    expect(sendToRelayMock).toHaveBeenCalledOnce()
    await feedback.openInBrowser()
    expect(openUrlMock).toHaveBeenCalledOnce()
    expect(String(openUrlMock.mock.calls[0]![0])).toContain('https://github.com/jaylouiz/kan-do/issues/new')
    expect(feedback.isOpen.value).toBe(false)
  })

  it('a build without a relay URL uses the browser path from the start', async () => {
    runtimeConfigMock.public.feedbackRelayUrl = ''
    const feedback = useFeedback()
    await fill(feedback)
    expect(feedback.sendRoute.value).toBe('browser')
    await feedback.sendViaRelay()
    expect(sendToRelayMock).not.toHaveBeenCalled()
  })

  it('a second click while a send runs is ignored', async () => {
    let finish!: (value: string) => void
    sendToRelayMock.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const feedback = useFeedback()
    await fill(feedback)
    const first = feedback.sendViaRelay()
    await feedback.sendViaRelay()
    feedback.close() // ignored mid-send
    expect(feedback.isOpen.value).toBe(true)
    finish('sent')
    await first
    expect(sendToRelayMock).toHaveBeenCalledOnce()
  })

  it('web: no Tauri call at all, the version is the build version, the link opens in a new tab', async () => {
    setDesktop(false)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const feedback = useFeedback()
    await fill(feedback)
    expect(invokeMock).not.toHaveBeenCalled()
    expect(feedback.sendRoute.value).toBe('relay')
    expect(feedback.versionInfo.value?.version).toBe('9.9.9')
    expect(feedback.logTail.value).toBe('')
    expect(feedback.body.value).toContain('9.9.9')

    sendToRelayMock.mockResolvedValue('unavailable')
    await feedback.sendViaRelay()
    await feedback.openInBrowser()
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://github.com/jaylouiz/kan-do/issues/new'), '_blank', 'noopener')
    expect(openUrlMock).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
