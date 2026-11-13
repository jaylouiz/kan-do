// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import supertest from 'supertest'
import { FEEDBACK_HOURLY_CAP } from '~/server/utils/feedbackRelay'

/** #268: the feedback relay. GitHub is a stubbed `fetch`; nothing leaves the test. */

const PATH = 'feedback/2026/11/0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11.png'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64')
const REPORT = { title: 'Karte abgeschnitten', body: '## Description\n\nDer Titel ist zu lang.\n' }

type GithubCall = { method: string, url: string, body: Record<string, unknown> | null, auth: string | null }
let calls: GithubCall[]

/** Answers GitHub by `<METHOD> <path prefix>`; the default is an empty issue list and 201 for writes. */
function stubGithub(answers: Record<string, { status: number, json?: unknown }> = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.github.com', '')
    const method = init.method ?? 'GET'
    calls.push({ method, url: path, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('authorization') })
    const key = Object.keys(answers).find(k => `${method} ${path}`.startsWith(k))
    const answer = key ? answers[key]! : { status: method === 'GET' ? 200 : 201, json: method === 'GET' ? [] : {} }
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status })
  }))
}

async function request() {
  const post = (await import('~/server/api/feedback.post')).default
  const options = (await import('~/server/api/feedback.options')).default
  const router = createRouter().post('/api/feedback', post).options('/api/feedback', options)
  const app = createApp()
  app.use(router)
  return supertest(toNodeListener(app))
}

const writes = () => calls.filter(call => call.method !== 'GET')

describe('server/api/feedback.post.ts', () => {
  beforeEach(() => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', 'github_pat_relay')
    vi.stubEnv('FEEDBACK_REPO', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGithub()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('files the report as an inbox issue in the private repository and tells the client nothing about it', async () => {
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(writes()).toEqual([{
      method: 'POST',
      url: '/repos/jaylouiz/kan-do-feedback/issues',
      body: { title: REPORT.title, body: REPORT.body, labels: ['inbox'] },
      auth: 'Bearer github_pat_relay',
    }])
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain('github_pat_relay')
  })

  it('uploads the screenshot first, then creates the issue', async () => {
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(201)
    expect(writes().map(call => `${call.method} ${call.url}`)).toEqual([
      `PUT /repos/jaylouiz/kan-do-feedback/contents/${PATH}`,
      'POST /repos/jaylouiz/kan-do-feedback/issues',
    ])
    expect(writes()[0]!.body).toMatchObject({ content: PNG })
    expect(writes()[0]!.body).not.toHaveProperty('branch')
  })

  it('a retry after a failed issue create finds the image already uploaded (422) and still files the issue', async () => {
    stubGithub({ 'POST ': { status: 500 } })
    const first = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(first.status).toBe(502)
    stubGithub({ 'PUT ': { status: 422, json: { message: 'Invalid request. "sha" wasn\'t supplied.' } } })
    const retry = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(retry.status).toBe(201)
    expect(writes().map(call => call.method)).toEqual(['PUT', 'POST'])
  })

  it('a failed screenshot upload creates no issue', async () => {
    stubGithub({ 'PUT ': { status: 403, json: { message: 'Resource not accessible by personal access token' } } })
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(502)
    expect(writes().map(call => call.method)).toEqual(['PUT'])
  })

  it.each([
    ['no title', { ...REPORT, title: '  ' }],
    ['a title over 120 characters', { ...REPORT, title: 'x'.repeat(121) }],
    ['no body', { title: 'T' }],
    ['a body over 20000 characters', { ...REPORT, body: 'x'.repeat(20001) }],
    ['an array', [REPORT]],
    ['a screenshot path outside feedback/', { ...REPORT, screenshot: { path: '.github/workflows/x.png', content: PNG } }],
    ['a screenshot path with a traversal', { ...REPORT, screenshot: { path: 'feedback/2026/11/../../../x.png', content: PNG } }],
    ['a screenshot that is not a PNG', { ...REPORT, screenshot: { path: PATH, content: Buffer.from('<svg onload=alert(1)>').toString('base64') } }],
    ['a screenshot that is not base64', { ...REPORT, screenshot: { path: PATH, content: 'not base64!' } }],
  ])('refuses %s with 400 and never calls GitHub', async (_label, body) => {
    const res = await (await request()).post('/api/feedback').send(body)
    expect(res.status).toBe(400)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(calls).toEqual([])
  })

  it('refuses a screenshot over 3 MB with 413', async () => {
    const big = PNG.slice(0, 8) + 'A'.repeat(4 * 1024 * 1024 + 8)
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: big } })
    expect(res.status).toBe(413)
    expect(calls).toEqual([])
  })

  it('answers a filled honeypot like a success, without calling GitHub', async () => {
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, website: 'https://spam.example' })
    expect(res.status).toBe(201)
    expect(calls).toEqual([])
  })

  it('stops at the hourly cap: 429 and nothing written', async () => {
    const now = new Date().toISOString()
    stubGithub({ 'GET ': { status: 200, json: Array.from({ length: FEEDBACK_HOURLY_CAP }, () => ({ created_at: now })) } })
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(429)
    expect(res.body?.data?.error).toBe('FEEDBACK_RATE_LIMITED')
    expect(writes()).toEqual([])
  })

  it('issues older than an hour do not count towards the cap', async () => {
    const old = new Date(Date.now() - 61 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    const list = Array.from({ length: FEEDBACK_HOURLY_CAP }, (_, i) => ({ created_at: i === 0 ? fresh : old }))
    stubGithub({ 'GET ': { status: 200, json: list } })
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
  })

  it('without a token it answers 503 FEEDBACK_NOT_CONFIGURED and never calls GitHub', async () => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '')
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(503)
    expect(res.body?.data?.error).toBe('FEEDBACK_NOT_CONFIGURED')
    expect(calls).toEqual([])
  })

  it.each([
    ['the issue list fails', { 'GET ': { status: 401, json: { message: 'Bad credentials' } } }],
    ['the issue create fails', { 'POST ': { status: 500 } }],
  ])('answers 502 when %s', async (_label, answers) => {
    stubGithub(answers)
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('Bad credentials')
  })

  it('answers 502 when GitHub is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(502)
  })

  it('FEEDBACK_REPO overrides the target repository', async () => {
    vi.stubEnv('FEEDBACK_REPO', 'someone/their-feedback')
    await (await request()).post('/api/feedback').send(REPORT)
    expect(writes()[0]!.url).toBe('/repos/someone/their-feedback/issues')
  })

  it('answers the CORS preflight', async () => {
    const res = await (await request()).options('/api/feedback')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type')
  })
})
