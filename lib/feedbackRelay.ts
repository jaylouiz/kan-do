/**
 * @module feedbackRelay
 * @description The one network call of the feedback relay path (#268, ADR 010 "Amendment: relay"): posts a
 * report to the app's own server route, which files it in the private feedback repository. No token, no
 * cookie and no GitHub host is involved here; the GitHub feedback code (`lib/feedback/`, `useFeedback.ts`)
 * still never calls `fetch` itself and reaches GitHub through Rust only.
 * @responsibility
 * - Maps every outcome to one of a few results; never throws, never retries
 * - `unavailable`: there is no relay behind the URL (static host, fork) or it has no token. The caller
 *   falls back to the browser path for the session.
 */
export interface RelayReport {
  title: string
  body: string
  screenshot?: { path: string, content: string }
}

export type RelayResult = 'sent' | 'offline' | 'blocked' | 'server' | 'unavailable' | 'invalid'

const TIMEOUT_MS = 30000
/** Largest PNG the relay takes (decoded bytes); the same number as `SCREENSHOT_MAX_BYTES` on the server. */
export const RELAY_IMAGE_MAX_BYTES = 3 * 1024 * 1024

export async function sendToRelay(url: string, report: RelayReport): Promise<RelayResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
  catch {
    return 'offline'
  }
  if (response.status === 201) {
    // A static host can answer a POST with its HTML shell: only the relay's own JSON counts as sent.
    const answer = await response.json().catch(() => null) as { ok?: unknown } | null
    return answer?.ok === true ? 'sent' : 'unavailable'
  }
  if (response.status === 429) return 'blocked'
  if (response.status === 400 || response.status === 413) return 'invalid'
  if (response.status >= 500 && response.status !== 503 && response.status !== 501) return 'server'
  return 'unavailable'
}
