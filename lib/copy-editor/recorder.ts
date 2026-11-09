/**
 * @module copy-editor/recorder
 * @description Remembers which i18n key produced which rendered string (#59). vue-i18n's `postTranslation` hook
 * (set in `i18n/i18n.config.ts` only when the tool is built in) calls `recordTranslation` for every message, so
 * interpolated and plural strings map to their key exactly, which a reverse lookup against the locale files cannot do.
 * @responsibility The text -> keys map. No DOM, no editing.
 */

const MAX_ENTRIES = 20000
let byText = new Map<string, Set<string>>()

/** Collapses whitespace the way the browser renders it, so DOM text and message text compare equal. */
export const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The `postTranslation` hook: records and returns the text unchanged. */
export function recordTranslation(translated: string, key: string): string {
  if (typeof translated !== 'string' || typeof key !== 'string' || translated === key) return translated
  const text = normalizeText(translated)
  if (text === '') return translated
  if (byText.size >= MAX_ENTRIES) byText = new Map()
  const keys = byText.get(text)
  if (keys) keys.add(key)
  else byText.set(text, new Set([key]))
  return translated
}

/** Keys that rendered exactly `text` (after whitespace normalisation), in recording order. */
export function keysForText(text: string): string[] {
  return [...(byText.get(normalizeText(text)) ?? [])]
}

export function resetRecorder(): void {
  byText = new Map()
}
