import type { Page } from '@playwright/test'

/** What the feedback relay route received (#268). */
export interface RelayReport {
  title: string
  body: string
  screenshot?: { path: string, content: string }
}

/**
 * Answers `POST /api/feedback` in the page, so no spec reaches a real relay (the E2E build posts to its own
 * origin, `nuxt.config.ts`). 201 is the relay's success; 503 is "no relay here", which sends the dialog to the
 * browser path. Returns the reports received so far.
 */
export async function mockFeedbackRelay(page: Page, status: 201 | 429 | 502 | 503 = 201): Promise<RelayReport[]> {
  const reports: RelayReport[] = []
  await page.route('**/api/feedback', async (route) => {
    reports.push(route.request().postDataJSON() as RelayReport)
    if (status === 201) await route.fulfill({ status, json: { ok: true } })
    else await route.fulfill({ status, json: { data: { error: 'RELAY' } } })
  })
  return reports
}

/** No relay behind the URL: the first send fails over to the browser path ("Auf GitHub öffnen"). */
export async function failOverToBrowserPath(page: Page): Promise<void> {
  await page.getByTestId('feedback-send-relay').click()
  await page.getByTestId('feedback-open-browser').waitFor()
}
