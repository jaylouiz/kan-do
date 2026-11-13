import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendToRelay } from '~/lib/feedbackRelay'

/** #268: every answer of the relay route maps to one result; the call never throws. */
const REPORT = { title: 'T', body: 'B' }
const answer = (status: number, body: string, type = 'application/json') =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } })))

describe('sendToRelay', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the report as JSON without credentials', async () => {
    answer(201, '{"ok":true}')
    expect(await sendToRelay('/api/feedback', REPORT)).toBe('sent')
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/feedback')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', body: JSON.stringify(REPORT) })
  })

  it.each([
    [429, '{}', 'blocked'],
    [400, '{}', 'invalid'],
    [413, '{}', 'invalid'],
    [502, '{}', 'server'],
    [500, '{}', 'server'],
    // No relay behind the URL, or it has no token: the caller falls back to the browser path.
    [503, '{"data":{"error":"FEEDBACK_NOT_CONFIGURED"}}', 'unavailable'],
    [404, 'Not found', 'unavailable'],
    [405, '', 'unavailable'],
  ] as const)('maps %i to %s', async (status, body, result) => {
    answer(status, body)
    expect(await sendToRelay('/api/feedback', REPORT)).toBe(result)
  })

  it('a static host that answers with its HTML shell is not a sent report', async () => {
    answer(200, '<!doctype html><html></html>', 'text/html')
    expect(await sendToRelay('/api/feedback', REPORT)).toBe('unavailable')
    answer(201, '<!doctype html><html></html>', 'text/html')
    expect(await sendToRelay('/api/feedback', REPORT)).toBe('unavailable')
  })

  it('a network failure is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await sendToRelay('/api/feedback', REPORT)).toBe('offline')
  })
})
