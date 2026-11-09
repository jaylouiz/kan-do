/**
 * @module copy-editor/edits
 * @description State of the live copy editor (#59): the collected edits, the base locale files, term checks and the
 * mode / dialog flags. Module-level refs (one editor per page), like `composables/useCommandPalette.ts`.
 * An edit keeps both languages' text and where the second one comes from: `agent` (not translated yet, the language
 * still reads as before), `draft` (the agent wrote it at Publish, awaiting review) or `self` (the designer wrote it).
 * @responsibility Edit bookkeeping, validation for the editor UI, persistence to localStorage. No DOM, no network.
 */
import { computed, ref, watch } from 'vue'
// `?raw`: @nuxtjs/i18n compiles a plain locale JSON import into message ASTs, which is not the text the file holds.
import deRaw from '~/i18n/locales/de.json?raw'
import enRaw from '~/i18n/locales/en.json?raw'
import termsJson from '~/docs/copy/terms.json'
import { flattenMessages, parityProblems, type MessageTree } from '~/lib/copy-editor/messages'
import { blockingIssues, termIssues, type TermEntry } from '~/lib/copy-editor/terms'
import { EDITS_STORAGE_KEY } from './constants'

export type Lang = 'de' | 'en'
export type OtherSource = 'agent' | 'draft' | 'self'

export interface EditEntry {
  key: string
  /** The language the designer wrote. */
  written: Lang
  de: string
  en: string
  other: OtherSource
  /** Why the last agent draft was rejected (placeholders, decided term, ...). */
  draftProblems?: string[]
  /** The PR this edit went into: it stays visible in the app but is not published again. */
  publishedIn?: string
}

export const BASE: Record<Lang, Record<string, string>> = {
  de: flattenMessages(JSON.parse(deRaw) as MessageTree),
  en: flattenMessages(JSON.parse(enRaw) as MessageTree),
}
export const ALL_KEYS = Object.keys(BASE.de).filter(key => key in BASE.en)
const TERMS = termsJson as TermEntry[]

export const otherLang = (lang: Lang): Lang => (lang === 'de' ? 'en' : 'de')
export const baseValue = (key: string, lang: Lang) => BASE[lang][key] ?? ''

function load(): Record<string, EditEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EDITS_STORAGE_KEY) ?? '{}') as Record<string, EditEntry>
    return Object.fromEntries(Object.entries(parsed).filter(([key, entry]) => key in BASE.de && typeof entry?.de === 'string' && typeof entry?.en === 'string'))
  } catch {
    return {}
  }
}

export const edits = ref<Record<string, EditEntry>>(import.meta.client ? load() : {})
export const mode = ref(false)
export const dialogOpen = ref(false)
export const view = ref<'edit' | 'publish'>('edit')
export const selectedKey = ref<string | null>(null)
/** Several keys render the same text: the editor offers them as a choice. */
export const choices = ref<string[]>([])

watch(edits, (value) => {
  try { localStorage.setItem(EDITS_STORAGE_KEY, JSON.stringify(value)) } catch { /* storage blocked: edits stay in memory */ }
}, { deep: true })

export const pendingEdits = computed(() => Object.values(edits.value).filter(entry => !entry.publishedIn))
export const publishedEdits = computed(() => Object.values(edits.value).filter(entry => entry.publishedIn))
export const needsTranslation = computed(() => pendingEdits.value.filter(entry => entry.other === 'agent'))

export const currentValue = (key: string, lang: Lang) => edits.value[key]?.[lang] ?? baseValue(key, lang)

export interface ValueCheck { blocking: string[], warnings: string[] }

/** Term and (when `against` is given) placeholder checks for one value; `blocking` stops a save. */
export function checkText(key: string, lang: Lang, text: string, against?: string): ValueCheck {
  const issues = termIssues(text, lang, key, TERMS)
  const blocking = blockingIssues(issues).map(issue => `"${issue.form}" is an avoid form of the decided term "${issue.preferred}"`)
  const warnings = issues.filter(issue => issue.status === 'proposed').map(issue => `"${issue.form}" is an avoid form of the proposed term "${issue.preferred}"`)
  if (against !== undefined) blocking.push(...parityProblems(text, against))
  if (text.trim() === '') blocking.push('empty')
  return { blocking, warnings }
}

export interface SaveInput {
  key: string
  written: Lang
  text: string
  /** `agent`: the other language is translated at Publish; `self`: the designer's own text for it. */
  other: { kind: 'agent' } | { kind: 'self', text: string }
}

/** Saves an edit; returns what blocks it (nothing saved then). Writing the base text back with nothing else removes the edit. */
export function saveEdit({ key, written, text, other }: SaveInput): ValueCheck {
  const second = otherLang(written)
  const writtenCheck = checkText(key, written, text, other.kind === 'self' ? other.text : undefined)
  const otherCheck = other.kind === 'self' ? checkText(key, second, other.text, text) : { blocking: [], warnings: [] }
  const blocking = [...writtenCheck.blocking, ...otherCheck.blocking.map(message => `${second}: ${message}`)]
  const warnings = [...writtenCheck.warnings, ...otherCheck.warnings]
  if (blocking.length) return { blocking, warnings }
  const otherText = other.kind === 'self' ? other.text : baseValue(key, second)
  if (text === baseValue(key, written) && otherText === baseValue(key, second)) {
    revertEdit(key)
    return { blocking, warnings }
  }
  edits.value = {
    ...edits.value,
    [key]: { key, written, [written]: text, [second]: otherText, other: other.kind } as unknown as EditEntry,
  }
  return { blocking, warnings }
}

export function setDraft(key: string, draft: string | null, problems: string[] = []) {
  const entry = edits.value[key]
  if (!entry) return
  const second = otherLang(entry.written)
  edits.value = {
    ...edits.value,
    [key]: draft === null
      ? { ...entry, draftProblems: problems }
      : { ...entry, [second]: draft, other: 'draft', draftProblems: undefined },
  }
}

export function revertEdit(key: string) {
  const { [key]: _removed, ...rest } = edits.value
  edits.value = rest
}

export function markPublished(keys: string[], url: string) {
  edits.value = Object.fromEntries(Object.entries(edits.value).map(([key, entry]) => [key, keys.includes(key) ? { ...entry, publishedIn: url } : entry]))
}

export function clearPublished() {
  edits.value = Object.fromEntries(Object.entries(edits.value).filter(([, entry]) => !entry.publishedIn))
}

export function openEditor(key: string | null, keys: string[] = []) {
  selectedKey.value = key
  choices.value = keys.length > 1 ? keys : []
  view.value = 'edit'
  dialogOpen.value = true
}
