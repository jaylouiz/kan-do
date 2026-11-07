/**
 * @module feedback/trimPrefilledUrl
 * @description Builds the prefilled `issues/new` link of the browser path (#227; everyone without a feedback token
 * since the repository went public). The encoded URL stays within a safe length: the log tail is shortened first
 * (oldest lines go, the newest stay), then dropped, then the context table is shortened, then dropped. The title
 * and the user's own description are never cut.
 */
import { buildIssueBody } from '~/lib/feedback/buildIssueBody'
import { FEEDBACK_REPO, type IssueBodyInput } from '~/lib/feedback/types'

/** Encoded URL length that GitHub and browsers accept comfortably (about 7.5 KB, under GitHub's ~8 KB). */
export const MAX_URL_LENGTH = 7500

export type TrimmedPart = 'log' | 'context'

export interface PrefilledUrl {
  url: string
  /** What was shortened or left out, in that order. `log` covers a shortened and a dropped log alike. */
  trimmed: TrimmedPart[]
  /** True when the title and description alone exceed the limit: nothing of them is cut. */
  overflow: boolean
}

function urlFor(title: string, body: string): string {
  // `labels` only applies for users with triage rights; the template's own `labels: inbox` applies for everyone.
  const query = ['template=feedback.md', `title=${encodeURIComponent(title)}`, `body=${encodeURIComponent(body)}`, 'labels=inbox'].join('&')
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${query}`
}

/** The newest `count` lines of the log tail. */
function lastLines(logTail: string, count: number): string {
  return logTail.replace(/\s+$/, '').split('\n').slice(-count).join('\n')
}

export function buildPrefilledUrl(title: string, input: IssueBodyInput, maxLength = MAX_URL_LENGTH): PrefilledUrl {
  const fits = (url: string) => url.length <= maxLength
  const full = urlFor(title, buildIssueBody(input))
  if (fits(full)) return { url: full, trimmed: [], overflow: false }

  const logTail = input.logTail?.trim() ? input.logTail : null
  if (logTail) {
    // The longest tail that still fits; the lengths grow with the line count, so a binary search finds it.
    const total = logTail.replace(/\s+$/, '').split('\n').length
    const withLines = (count: number) => urlFor(title, buildIssueBody({ ...input, logTail: lastLines(logTail, count) }))
    let low = 1
    let high = total - 1
    let best: string | null = null
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const url = withLines(mid)
      if (fits(url)) {
        best = url
        low = mid + 1
      }
      else {
        high = mid - 1
      }
    }
    if (best) return { url: best, trimmed: ['log'], overflow: false }
  }

  const dropped: TrimmedPart[] = logTail ? ['log'] : []
  const steps: Array<Parameters<typeof buildIssueBody>[1]> = [
    ...(logTail ? [{ withLog: false }] : []),
    { withLog: false, short: true },
    { withLog: false, withContext: false },
  ]
  let last: PrefilledUrl = { url: full, trimmed: [], overflow: true }
  for (const [index, options] of steps.entries()) {
    const url = urlFor(title, buildIssueBody(input, options))
    const trimmed: TrimmedPart[] = logTail && index === 0 ? dropped : [...dropped, 'context']
    last = { url, trimmed, overflow: false }
    if (fits(url)) return last
  }
  return { ...last, overflow: true }
}
