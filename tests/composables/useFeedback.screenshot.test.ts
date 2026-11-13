import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { Blob as NodeBlob } from 'node:buffer'
import { resetFeedbackState, useFeedback } from '~/composables/useFeedback'
import { runtimeConfigMock, toastAddMock } from '../mocks/nuxt-imports'

/** #247: the screenshot half of useFeedback. IPC is faked; canvas work is replaced by fixed bitmaps and a generated PNG. */

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.2.3' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
const openUrlMock = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

/** A tiny generated fixture: never a screenshot of the real app. */
const FIXTURE_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const flattenMock = vi.fn()
vi.mock('~/lib/feedback/flattenCanvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/feedback/flattenCanvas')>()),
  flattenToPng: (...args: unknown[]) => flattenMock(...args),
  readAnnotationColors: () => ({ redact: '#000', stroke: '#000' }),
}))

type Req = { method: string, path: string, body?: Record<string, unknown> }
let requests: Req[] = []
let answers: (req: Req) => { status: number, body?: unknown } | Promise<{ status: number, body?: unknown }>
const clipboardWrite = vi.fn()

const ok = (status: number, body: unknown = {}) => ({ status, body })
const PERMISSION_403 = { message: 'Resource not accessible by personal access token' }
const happy = (req: Req) => {
  if (req.method === 'GET') return ok(200)
  if (req.path.endsWith('/issues')) return ok(201, { number: 7, html_url: 'https://github.com/jaylouiz/kan-do/issues/7' })
  return ok(201)
}

function stubIpc(opts: { present?: boolean, rejected?: boolean, last4?: string } = {}) {
  const { present = true, rejected = false, last4 = 'abcd' } = opts
  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'secret_status') return { 'github-feedback': { state: 'ok', present, last4, rejected } }
    if (cmd === 'feedback_capture') return FIXTURE_PNG.buffer
    if (cmd === 'log_tail') return ''
    // The write-access check of the token's user (owner): answered here, kept out of `requests`
    if (cmd === 'github_request' && args?.method === 'GET' && args?.path === '/repos/jaylouiz/kan-do') {
      return { status: 200, body: { permissions: { push: true } } }
    }
    if (cmd === 'github_request') {
      const req = { method: String(args?.method), path: String(args?.path).replace('/repos/jaylouiz/kan-do', ''), body: args?.body as Req['body'] }
      requests.push(req)
      return answers(req)
    }
    return null
  })
}

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args) } // also routes a real `@tauri-apps/api/core` that Vitest hands out to concurrent first imports
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

/** Add a screenshot like the dialog does: hide, leave transition, capture, annotate step. */
async function addScreenshot(feedback: ReturnType<typeof useFeedback>) {
  feedback.startCapture()
  expect(feedback.isOpen.value).toBe(false)
  await feedback.onDialogLeft()
}

async function reachReview(feedback: ReturnType<typeof useFeedback>) {
  feedback.open()
  feedback.draft.title = 'Karte abgeschnitten'
  await addScreenshot(feedback)
  await feedback.finishAnnotate()
  expect(feedback.step.value).toBe('review')
}

const issueRequests = () => requests.filter(r => r.method === 'POST' && r.path === '/issues')
const upload = () => requests.find(r => r.method === 'PUT')

describe('useFeedback screenshot', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetFeedbackState()
    invokeMock.mockReset()
    openUrlMock.mockReset()
    handleErrorMock.mockReset()
    toastAddMock.mockReset()
    flattenMock.mockReset()
    flattenMock.mockResolvedValue({ blob: new NodeBlob([FIXTURE_PNG], { type: 'image/png' }), width: 10, height: 8 })
    clipboardWrite.mockReset()
    clipboardWrite.mockResolvedValue(undefined)
    requests = []
    answers = happy
    setDesktop(true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 8, close: vi.fn() })))
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    Object.defineProperty(navigator, 'clipboard', { value: { write: clipboardWrite }, configurable: true })
    stubIpc()
  })
  afterEach(() => {
    setDesktop(false)
    vi.unstubAllGlobals()
  })

  it('hides the dialog, captures with the mask, and opens the annotate step', async () => {
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback)
    expect(invokeMock).toHaveBeenCalledWith('feedback_capture')
    expect(feedback.step.value).toBe('annotate')
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.rawShot.value).not.toBeNull()
    expect(feedback.annotations.value).toEqual([])
  })

  it('keeps the form usable when the capture fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'feedback_capture') throw { kind: 'failed' }
      return null
    })
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback)
    expect(feedback.step.value).toBe('form')
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.captureFailure.value).toBe('failed')
    expect(feedback.rawShot.value).toBeNull()
  })

  it('flattens on "Fertig", drops the raw capture and the strokes, and goes to the review', async () => {
    const feedback = useFeedback()
    feedback.open()
    feedback.draft.title = 'x'
    await addScreenshot(feedback)
    feedback.addAnnotation({ tool: 'redact', x1: 0, y1: 0, x2: 5, y2: 5 })
    feedback.addAnnotation({ tool: 'rect', x1: 0, y1: 0, x2: 1, y2: 1 }) // a tap, ignored
    expect(feedback.annotations.value).toHaveLength(1)
    await feedback.finishAnnotate()
    expect(flattenMock).toHaveBeenCalledOnce()
    expect(flattenMock.mock.calls[0]?.[1]).toHaveLength(1)
    expect(feedback.rawShot.value).toBeNull()
    expect(feedback.annotations.value).toEqual([])
    expect(feedback.flat.value?.path).toMatch(/^feedback\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
    expect(feedback.step.value).toBe('review')
  })

  it('the path is fixed at flatten time, so the review body is exact and does not change on send', async () => {
    const feedback = useFeedback()
    await reachReview(feedback)
    const path = feedback.flat.value!.path
    expect(feedback.body.value).toContain(`![Screenshot](https://github.com/jaylouiz/kan-do/blob/feedback-assets/${path}?raw=true)`)
    const before = feedback.body.value
    await feedback.send()
    expect(issueRequests()[0]?.body?.body).toBe(before)
  })

  it('sends in order: branch check, upload, issue', async () => {
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(requests.map(r => `${r.method} ${r.path}`)).toEqual([
      'GET /git/ref/heads/feedback-assets',
      `PUT /contents/${requests[1]!.path.replace('/contents/', '')}`,
      'POST /issues',
    ])
    const put = upload()!
    expect(put.path).toMatch(/^\/contents\/feedback\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
    expect(put.body).toMatchObject({ branch: 'feedback-assets', content: btoa(String.fromCharCode(...FIXTURE_PNG)) })
    expect(put.body).not.toHaveProperty('sha')
    expect(String(put.body?.message)).toMatch(/^chore\(feedback\): screenshot [0-9a-f-]{36}$/)
    expect(issueRequests()[0]?.body).toMatchObject({ labels: ['inbox'] })
    expect(feedback.isOpen.value).toBe(false)
    expect(feedback.flat.value).toBeNull()
  })

  it('creates the orphan branch first when it does not exist', async () => {
    answers = (req) => {
      if (req.method === 'GET') return ok(404)
      if (req.path === '/git/blobs') return ok(201, { sha: 'blob1' })
      if (req.path === '/git/trees') return ok(201, { sha: 'tree1' })
      if (req.path === '/git/commits') return ok(201, { sha: 'commit1' })
      return happy(req)
    }
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(requests.map(r => `${r.method} ${r.path}`).slice(0, 5)).toEqual([
      'GET /git/ref/heads/feedback-assets', 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'POST /git/refs',
    ])
    expect(requests[2]?.body).toMatchObject({ tree: [{ path: 'README.md', sha: 'blob1' }] })
    expect(requests[3]?.body).toMatchObject({ tree: 'tree1', parents: [] })
    expect(requests[4]?.body).toEqual({ ref: 'refs/heads/feedback-assets', sha: 'commit1' })
    expect(requests.at(-1)?.path).toBe('/issues')
  })

  it('treats an already existing branch (422 on create) as fine', async () => {
    answers = (req) => {
      if (req.method === 'GET') return ok(404)
      if (req.path === '/git/refs') return ok(422)
      if (['/git/blobs', '/git/trees', '/git/commits'].includes(req.path)) return ok(201, { sha: 's' })
      return happy(req)
    }
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(issueRequests()).toHaveLength(1)
  })

  it('relay (#268): the image goes with the report as base64; one over 3 MB is refused before anything is sent, unticking it sends the rest', async () => {
    runtimeConfigMock.public.feedbackRelayUrl = '/api/feedback'
    try {
      stubIpc({ present: false })
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}', { status: 201 }))
      vi.stubGlobal('fetch', fetchMock)
      flattenMock.mockResolvedValue({ blob: new NodeBlob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: 'image/png' }), width: 10, height: 8 })
      const big = useFeedback()
      await reachReview(big)
      expect(big.sendRoute.value).toBe('relay')
      expect(big.screenshotDelivery.value).toBe('relay')
      await big.sendViaRelay()
      expect(big.problem.value).toBe('relayImageTooLarge')
      expect(fetchMock).not.toHaveBeenCalled()

      big.draft.include.screenshot = false
      await big.sendViaRelay()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).not.toHaveProperty('screenshot')
      expect(big.isOpen.value).toBe(false)

      resetFeedbackState()
      fetchMock.mockClear()
      flattenMock.mockResolvedValue({ blob: new NodeBlob([FIXTURE_PNG], { type: 'image/png' }), width: 10, height: 8 })
      const small = useFeedback()
      await reachReview(small)
      const path = small.flat.value!.path
      await small.sendViaRelay()
      const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      expect(sent.screenshot).toEqual({ path, content: Buffer.from(FIXTURE_PNG).toString('base64') })
      expect(sent.body).toContain(`jaylouiz/kan-do-feedback/blob/main/${path}`)
      expect(clipboardWrite).not.toHaveBeenCalled()
      expect(requests).toEqual([])
    }
    finally {
      runtimeConfigMock.public.feedbackRelayUrl = ''
    }
  })

  it('a retry after a failed issue reuses the uploaded path and never uploads twice', async () => {
    let issueAnswer = 502
    answers = (req) => (req.path === '/issues' ? ok(issueAnswer, { number: 7 }) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.problem.value).toBe('server')
    expect(feedback.isOpen.value).toBe(true)
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1)
    const path = upload()!.path
    issueAnswer = 201
    requests = []
    await feedback.send()
    expect(requests.map(r => r.method)).toEqual(['POST'])
    expect(issueRequests()[0]?.body?.body).toContain(path.replace('/contents/', ''))
  })

  it('a 403 on the upload stops before any issue exists, keeps draft and image, and offers sending without the image', async () => {
    answers = (req) => (req.method === 'PUT' ? ok(403, PERMISSION_403) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(issueRequests()).toHaveLength(0)
    expect(feedback.problem.value).toBe('uploadDenied')
    expect(feedback.uploadDenied.value).toBe(true)
    expect(feedback.sendsWithoutImage.value).toBe(true)
    expect(feedback.flat.value).not.toBeNull()
    expect(feedback.draft.title).toBe('Karte abgeschnitten')
    expect(feedback.body.value).toContain('Screenshot: paste it here (copied to the clipboard).')
    expect(feedback.body.value).not.toContain('![Screenshot]')
  })

  it('a 404 on the branch bootstrap counts as denied as well', async () => {
    answers = (req) => {
      if (req.method === 'GET') return ok(404)
      if (req.path === '/git/blobs') return ok(404)
      return happy(req)
    }
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(issueRequests()).toHaveLength(0)
    expect(feedback.uploadDenied.value).toBe(true)
  })

  it('"Ohne Bild senden" copies the PNG first, then creates the issue without the image and never uploads', async () => {
    answers = (req) => (req.method === 'PUT' ? ok(403, PERMISSION_403) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    requests = []
    clipboardWrite.mockImplementation(async () => {
      expect(requests).toEqual([]) // the clipboard write happens before any request
    })
    await feedback.send()
    expect(clipboardWrite).toHaveBeenCalledOnce()
    expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(['POST /issues'])
    expect(issueRequests()[0]?.body?.body).toContain('Screenshot: paste it here (copied to the clipboard).')
    expect(feedback.isOpen.value).toBe(false)
  })

  it('a clipboard failure is reported and the issue still goes ahead', async () => {
    answers = (req) => (req.method === 'PUT' ? ok(404, { message: 'Not Found' }) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    clipboardWrite.mockRejectedValue(new Error('denied'))
    await feedback.send()
    expect(issueRequests()).toHaveLength(1)
    expect(toastAddMock.mock.calls.map(c => c[0].title)).toContain('Das Bild konnte nicht in die Zwischenablage kopiert werden.')
  })

  it('unticking the screenshot removes the section and skips the upload', async () => {
    const feedback = useFeedback()
    await reachReview(feedback)
    feedback.draft.include.screenshot = false
    expect(feedback.body.value).not.toContain('Screenshot')
    await feedback.send()
    expect(requests.map(r => r.method)).toEqual(['POST'])
    expect(issueRequests()[0]?.body?.body).not.toContain('feedback-assets')
  })

  it('without a token the prefilled link opens and the PNG goes to the clipboard first', async () => {
    stubIpc({ present: false })
    const feedback = useFeedback()
    await reachReview(feedback)
    expect(feedback.canSend.value).toBe(false)
    clipboardWrite.mockImplementation(async () => {
      expect(openUrlMock).not.toHaveBeenCalled()
    })
    await feedback.openInBrowser()
    expect(clipboardWrite).toHaveBeenCalledOnce()
    expect(openUrlMock).toHaveBeenCalledOnce()
    const url = new URL(String(openUrlMock.mock.calls[0]?.[0]))
    expect(url.searchParams.get('body')).toContain('Screenshot: paste it here (copied to the clipboard).')
    expect(requests).toEqual([])
    // The dialog is gone: the board says what to do on GitHub
    expect(toastAddMock.mock.calls.map(c => c[0].title)).toEqual(['GitHub ist im Browser geöffnet. Füge den Screenshot mit ⌘V ein und sende das Issue ab.'])
  })

  it('a rejected token takes the same fallback; a clipboard failure shows inline and the URL still opens', async () => {
    stubIpc({ rejected: true })
    clipboardWrite.mockRejectedValue(new Error('denied'))
    const feedback = useFeedback()
    await reachReview(feedback)
    expect(feedback.tokenState.value).toBe('rejected')
    await feedback.openInBrowser()
    expect(openUrlMock).toHaveBeenCalledOnce()
    expect(requests).toEqual([])
  })

  it('a 401 during the upload flips to the fallback and creates no issue', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'secret_status') return { 'github-feedback': { state: 'ok', present: true, last4: 'abcd', rejected: false } }
      if (cmd === 'feedback_capture') return FIXTURE_PNG.buffer
      if (cmd === 'log_tail') return ''
      if (cmd === 'github_request') throw { kind: 'rejected' }
      return null
    })
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.tokenState.value).toBe('rejected')
    expect(feedback.canSend.value).toBe(false)
    expect(feedback.isOpen.value).toBe(true)
  })

  it('offline during the upload keeps the draft and the image for a retry', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'secret_status') return { 'github-feedback': { state: 'ok', present: true, last4: 'abcd', rejected: false } }
      if (cmd === 'feedback_capture') return FIXTURE_PNG.buffer
      if (cmd === 'log_tail') return ''
      if (cmd === 'github_request') throw { kind: 'network' }
      return null
    })
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.problem.value).toBe('offline')
    expect(feedback.flat.value).not.toBeNull()
  })

  it('forgets uploadDenied when the token changes', async () => {
    answers = (req) => (req.method === 'PUT' ? ok(403, PERMISSION_403) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.uploadDenied.value).toBe(true)
    stubIpc({ last4: 'wxyz' })
    await feedback.toForm()
    await feedback.toReview()
    expect(feedback.uploadDenied.value).toBe(false)
  })

  it('removing the screenshot, discarding the draft and sending all drop the image from memory', async () => {
    const feedback = useFeedback()
    await reachReview(feedback)
    feedback.removeScreenshot()
    expect(feedback.flat.value).toBeNull()
    await addScreenshot(feedback)
    expect(feedback.rawShot.value).not.toBeNull()
    feedback.close()
    expect(feedback.rawShot.value).toBeNull()
    expect(feedback.step.value).toBe('form')
    await addScreenshot(feedback)
    await feedback.finishAnnotate()
    feedback.discard()
    expect(feedback.flat.value).toBeNull()
    expect(feedback.hasDraft.value).toBe(false)
  })

  it('re-captures when the mask toggle is switched while a capture exists', async () => {
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback)
    feedback.addAnnotation({ tool: 'redact', x1: 0, y1: 0, x2: 9, y2: 9 })
    feedback.setMaskPrivate(false)
    expect(feedback.isOpen.value).toBe(false)
    await feedback.onDialogLeft()
    expect(invokeMock.mock.calls.filter(c => c[0] === 'feedback_capture')).toHaveLength(2)
    expect(feedback.maskPrivate.value).toBe(false)
    // The marks are not private data: they survive the re-capture of the same window.
    expect(feedback.annotations.value).toHaveLength(1)
  })

  it('a failed re-capture rolls the redact toggle back to what the shown image really is (masked)', async () => {
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback) // masked
    expect(feedback.maskPrivate.value).toBe(true)
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'feedback_capture') throw { kind: 'failed' }
      return null
    })
    feedback.setMaskPrivate(false)
    await feedback.onDialogLeft()
    expect(feedback.rawShot.value).not.toBeNull() // the old image stays
    expect(feedback.maskPrivate.value).toBe(true) // and the toggle still says it is masked
    expect(feedback.captureFailure.value).toBe('failed') // and the annotate step has something to show
    expect(feedback.step.value).toBe('annotate')
  })

  it('a failed re-capture after un-masking never leaves "masked" ticked over an unmasked image', async () => {
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback)
    feedback.setMaskPrivate(false)
    await feedback.onDialogLeft() // unmasked image now shown
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'feedback_capture') throw { kind: 'timeout' }
      return null
    })
    feedback.setMaskPrivate(true)
    await feedback.onDialogLeft()
    expect(feedback.rawShot.value).not.toBeNull()
    expect(feedback.maskPrivate.value).toBe(false)
  })

  it('a stalled re-capture (timeout error) leaves the dialog reopened and capturing possible again', async () => {
    const feedback = useFeedback()
    feedback.open()
    await addScreenshot(feedback)
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'feedback_capture') throw { kind: 'timeout' }
      return null
    })
    feedback.setMaskPrivate(false)
    await feedback.onDialogLeft()
    expect(feedback.isOpen.value).toBe(true)
    expect(feedback.capturePending.value).toBe(false)
    feedback.startCapture()
    expect(feedback.capturePending.value).toBe(true)
  })

  it.each([
    ['primary rate limit', { message: 'API rate limit exceeded for user ID 1.' }],
    ['secondary rate limit', { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }],
    ['abuse detection', { message: 'You have triggered an abuse detection mechanism.' }],
    ['an unexplained 403 (proxy, captive portal)', '<html>Forbidden</html>'],
  ])('a 403 from %s keeps uploads enabled and offers a retry', async (_name, body) => {
    answers = (req) => (req.method === 'PUT' ? ok(403, body) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.uploadDenied.value).toBe(false)
    expect(feedback.problem.value).toBe('blocked')
    expect(feedback.sendsWithoutImage.value).toBe(false)
    expect(issueRequests()).toHaveLength(0)
    expect(feedback.flat.value).not.toBeNull()
    // the retry uploads again
    answers = happy
    requests = []
    await feedback.send()
    expect(requests.some(r => r.method === 'PUT')).toBe(true)
    expect(issueRequests()).toHaveLength(1)
  })

  it('a rate-limited 403 on the branch check or bootstrap does not deny uploads either', async () => {
    answers = (req) => (req.method === 'GET' ? ok(403, { message: 'API rate limit exceeded' }) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.uploadDenied.value).toBe(false)
    expect(feedback.problem.value).toBe('blocked')
  })

  it('a 429 keeps uploads enabled', async () => {
    answers = (req) => (req.method === 'PUT' ? ok(429, {}) : happy(req))
    const feedback = useFeedback()
    await reachReview(feedback)
    await feedback.send()
    expect(feedback.uploadDenied.value).toBe(false)
    expect(feedback.problem.value).toBe('blocked')
  })

  it('a double click on "Fertig" flattens once and does not throw on the dropped capture', async () => {
    const feedback = useFeedback()
    feedback.open()
    feedback.draft.title = 'x'
    await addScreenshot(feedback)
    await Promise.all([feedback.finishAnnotate(), feedback.finishAnnotate()])
    expect(flattenMock).toHaveBeenCalledOnce()
    expect(feedback.step.value).toBe('review')
    expect(feedback.flat.value).not.toBeNull()
  })

  it('keeps image, strokes and draft in memory only: no storage write, no data_set', async () => {
    const writes: string[] = []
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => { writes.push(key) })
    const feedback = useFeedback()
    await reachReview(feedback)
    feedback.close()
    set.mockRestore()
    expect(writes).toEqual([])
    expect(invokeMock.mock.calls.filter(c => c[0] === 'data_set')).toEqual([])
  })

  it('"Weiter" from the form flattens a capture that was not finished with "Fertig"', async () => {
    const feedback = useFeedback()
    feedback.open()
    feedback.draft.title = 'Titel'
    await addScreenshot(feedback)
    feedback.toForm()
    expect(feedback.rawShot.value).not.toBeNull()
    await feedback.toReview()
    expect(flattenMock).toHaveBeenCalledOnce()
    expect(feedback.step.value).toBe('review')
    expect(feedback.rawShot.value).toBeNull()
  })
})
