/**
 * @module copy-editor/api
 * @description Client for the two dev-only routes (`server/copy-editor/`). Never throws: a network or HTTP failure is
 * returned as `errors`, so the editor shows it and keeps the edits.
 * @responsibility fetch with the marker header and a uniform result shape.
 */
import { API_HEADER } from './constants'

export interface Failure { ok: false, step?: string, errors: string[] }
export interface DraftResult { text: string | null, problems: string[], warnings: string[] }
export type TranslateResponse = { ok: true, drafts: Record<string, DraftResult> } | Failure
export type PublishResponse =
  | { ok: true, branch: string, prUrl: string | null, note: string | null, edits: number, files: number, warnings: string[] }
  | Failure

async function post<T extends { ok: boolean }>(route: string, body: unknown): Promise<T | Failure> {
  try {
    const response = await fetch(`/api/dev/copy/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [API_HEADER]: '1' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null) as T | null
    if (data && typeof data.ok === 'boolean') return data
    return { ok: false, errors: [`The dev server answered ${response.status}. Is this \`nuxt dev\` on your machine?`] }
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'request failed'] }
  }
}

export const requestTranslation = (items: { key: string, from: 'de' | 'en', value: string }[]) => post<TranslateResponse>('translate', { items })
export const requestPublish = (edits: { key: string, de: string, en: string }[]) => post<PublishResponse>('publish', { edits })
