/**
 * @module copy-editor/publish
 * @description The Publish flow of the live copy editor (#59, decisions D2/D6): one batch translation of every edit
 * whose other language is left to the agent, a review of the drafts, then the push. Both steps are explicit; nothing
 * is pushed before the designer has seen the drafts. Failures keep every edit.
 * @responsibility Phase, errors and results of translate/push. State only; calls `api.ts`.
 */
import { ref } from 'vue'
import { requestPublish, requestTranslation, type PublishResponse } from './api'
import { edits, markPublished, needsTranslation, pendingEdits, setDraft } from './edits'

export type Phase = 'idle' | 'translating' | 'publishing'

export const phase = ref<Phase>('idle')
export const errors = ref<string[]>([])
export const result = ref<Extract<PublishResponse, { ok: true }> | null>(null)

export async function translateDrafts(): Promise<void> {
  const items = needsTranslation.value.map(entry => ({ key: entry.key, from: entry.written, value: entry[entry.written] }))
  if (!items.length || phase.value !== 'idle') return
  phase.value = 'translating'
  errors.value = []
  const response = await requestTranslation(items)
  if (!response.ok) {
    errors.value = response.errors
  } else {
    for (const item of items) {
      const draft = response.drafts[item.key]
      if (draft?.text) setDraft(item.key, draft.text)
      else setDraft(item.key, null, draft?.problems ?? ['no draft'])
    }
  }
  phase.value = 'idle'
}

export async function pushPullRequest(): Promise<void> {
  if (phase.value !== 'idle' || needsTranslation.value.length > 0 || pendingEdits.value.length === 0) return
  phase.value = 'publishing'
  errors.value = []
  const keys = pendingEdits.value.map(entry => entry.key)
  const response = await requestPublish(keys.map(key => ({ key, de: edits.value[key]!.de, en: edits.value[key]!.en })))
  if (response.ok) {
    result.value = response
    markPublished(keys, response.prUrl ?? response.branch)
  } else {
    errors.value = response.step ? [`Publish stopped at "${response.step}":`, ...response.errors] : response.errors
  }
  phase.value = 'idle'
}

export function resetPublishState(): void {
  errors.value = []
  result.value = null
}

