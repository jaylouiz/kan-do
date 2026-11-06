/**
 * @module uploadAccess
 * @description Tells "this token may not write contents" from "GitHub is limiting us" (#247, ADR 014).
 * GitHub answers primary and secondary rate limits with 403, so the status alone cannot disable uploads.
 * @responsibility
 * - `denied` only for a 404, or a 403 whose message says the token lacks the permission
 * - `rateLimited` for a 429 or a 403 whose message names a rate limit or abuse detection
 * - `other` for everything else, including a 403 without a recognisable message (proxy, captive
 *   portal): transient until proven otherwise, so uploads stay enabled and the user can retry
 */
export type UploadAccess = 'denied' | 'rateLimited' | 'other'

const RATE_LIMIT = /rate limit|abuse detection|too many requests/i
const NO_PERMISSION = /not accessible by|resource not accessible|must have (admin|write|push)|permission|insufficient|requires? (the )?contents/i

function messageOf(body: unknown): string {
  if (typeof body === 'string') return body
  const message = (body as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : ''
}

export function classifyUploadStatus(status: number, body: unknown): UploadAccess {
  if (status === 429) return 'rateLimited'
  const message = messageOf(body)
  if (status === 403) {
    if (RATE_LIMIT.test(message)) return 'rateLimited'
    return NO_PERMISSION.test(message) ? 'denied' : 'other'
  }
  if (status === 404) return 'denied'
  return 'other'
}
