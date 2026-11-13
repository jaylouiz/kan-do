import { createError, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'

/**
 * Feedback relay (#268, ADR 010 "Amendment: relay"): the server posts in-app reports as issues into a private
 * repository, so users need no GitHub account and no token ever reaches a client.
 * - The token (`FEEDBACK_GITHUB_TOKEN`) is scoped to the feedback repository only (Issues + Contents: write).
 * - Abuse bound without extra infrastructure: at most `FEEDBACK_HOURLY_CAP` issues per hour, counted on GitHub.
 * - Open to every origin (desktop webview, web build): there are no cookies or credentials to protect.
 */
export const FEEDBACK_REPO_DEFAULT = 'jaylouiz/kan-do-feedback'
export const FEEDBACK_HOURLY_CAP = 30
export const TITLE_MAX = 120
export const BODY_MAX = 20000
/** Decoded PNG size. Vercel refuses request bodies over 4.5 MB; base64 adds a third. */
export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024

const SCREENSHOT_PATH = /^feedback\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const REPO = /^[\w.-]+\/[\w.-]+$/

export interface FeedbackReport {
  title: string
  body: string
  screenshot?: { path: string, content: string }
}

export function setCorsHeaders(event: H3Event): void {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  })
}

export function relayError(statusCode: number, error: string): never {
  throw createError({ statusCode, statusMessage: error, data: { error } })
}

/** The report, or a 400/413. Nothing of the input is echoed back. */
export function parseReport(input: unknown): FeedbackReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) relayError(400, 'INVALID_REPORT')
  const { title, body, screenshot } = input as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim() || title.length > TITLE_MAX) relayError(400, 'INVALID_TITLE')
  if (typeof body !== 'string' || !body.trim() || body.length > BODY_MAX) relayError(400, 'INVALID_BODY')
  const report: FeedbackReport = { title: title.trim(), body }
  if (screenshot === undefined || screenshot === null) return report

  if (typeof screenshot !== 'object') relayError(400, 'INVALID_SCREENSHOT')
  const { path, content } = screenshot as Record<string, unknown>
  if (typeof path !== 'string' || !SCREENSHOT_PATH.test(path)) relayError(400, 'INVALID_SCREENSHOT')
  if (typeof content !== 'string' || !content) relayError(400, 'INVALID_SCREENSHOT')
  if (content.length > Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4) relayError(413, 'SCREENSHOT_TOO_LARGE')
  if (!BASE64.test(content)) relayError(400, 'INVALID_SCREENSHOT')
  const head = Buffer.from(content.slice(0, 12), 'base64')
  if (!PNG_MAGIC.every((byte, i) => head[i] === byte)) relayError(400, 'INVALID_SCREENSHOT')
  report.screenshot = { path, content }
  return report
}

export function relayTarget(env: Record<string, string | undefined> = process.env): { token: string, repo: string } {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim()
  if (!token) relayError(503, 'FEEDBACK_NOT_CONFIGURED')
  const repo = env.FEEDBACK_REPO?.trim() || FEEDBACK_REPO_DEFAULT
  if (!REPO.test(repo)) relayError(503, 'FEEDBACK_NOT_CONFIGURED')
  return { token, repo }
}

async function github(token: string, method: string, url: string, body?: unknown): Promise<{ status: number, json: unknown }> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kan-do-feedback-relay',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
  }
  catch {
    relayError(502, 'GITHUB_UNREACHABLE')
  }
  const json: unknown = await response.json().catch(() => null)
  return { status: response.status, json }
}

/** A GitHub answer the relay did not expect. The status is logged, never the token or the report. */
function upstreamFailed(step: string, status: number): never {
  console.error(`[feedback relay] ${step} answered ${status}`)
  relayError(502, 'GITHUB_ERROR')
}

/** Cap check, then the screenshot (when there is one), then the issue: a refused report leaves nothing behind. */
export async function fileReport(report: FeedbackReport, target: { token: string, repo: string }, now = Date.now()): Promise<void> {
  const { token, repo } = target
  const recent = await github(token, 'GET', `/repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=${FEEDBACK_HOURLY_CAP}`)
  if (recent.status !== 200 || !Array.isArray(recent.json)) upstreamFailed('issue list', recent.status)
  const cutoff = now - 60 * 60 * 1000
  const lastHour = (recent.json as Array<{ created_at?: string }>).filter(issue => Date.parse(issue.created_at ?? '') >= cutoff)
  if (lastHour.length >= FEEDBACK_HOURLY_CAP) relayError(429, 'FEEDBACK_RATE_LIMITED')

  if (report.screenshot) {
    const put = await github(token, 'PUT', `/repos/${repo}/contents/${report.screenshot.path}`, {
      message: `chore(feedback): screenshot ${report.screenshot.path.split('/').pop()?.replace('.png', '') ?? ''}`,
      content: report.screenshot.content,
    })
    // 422: the file is already there. The path holds a fresh uuid per image, so this is the retry of a report whose
    // issue create failed after the upload: go on to the issue instead of failing every retry.
    if (put.status !== 201 && put.status !== 422) upstreamFailed('screenshot upload', put.status)
  }

  const issue = await github(token, 'POST', `/repos/${repo}/issues`, { title: report.title, body: report.body, labels: ['inbox'] })
  if (issue.status !== 201) upstreamFailed('issue create', issue.status)
}
