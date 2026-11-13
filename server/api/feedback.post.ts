import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { fileReport, parseReport, relayError, relayTarget, setCorsHeaders } from '~/server/utils/feedbackRelay'

/**
 * `POST /api/feedback` (#268): files an in-app report as an issue in the private feedback repository.
 * Answers 201 `{ ok: true }` and nothing about the issue: the repository is private.
 */
export default defineEventHandler(async (event) => {
  setCorsHeaders(event)
  const input: unknown = await readBody(event).catch(() => relayError(400, 'INVALID_REPORT'))
  // Honeypot: a filled `website` field is a bot. It gets the same answer as a real report.
  const trap = (input as { website?: unknown } | null)?.website
  if (typeof trap === 'string' && trap.trim()) {
    setResponseStatus(event, 201)
    return { ok: true }
  }
  const report = parseReport(input)
  await fileReport(report, relayTarget())
  setResponseStatus(event, 201)
  return { ok: true }
})
