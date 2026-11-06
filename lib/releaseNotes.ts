/**
 * @module releaseNotes
 * @description The bundled `release-notes/<X.Y.Z>.md` files as data for the "What's new" dialog (#226).
 * Parsing and the format live in `lib/releaseNotesFormat.mjs` (shared with the release script). The files
 * are imported lazily, so the web build never loads them; `## Fixes` is never exposed.
 * The selection functions are pure so Vitest needs no Tauri.
 */
import { compareVersions, parseReleaseNotes, type Bullet, type Highlights } from '~/lib/releaseNotesFormat.mjs'
import type { AppLocale } from '~/utils/localeResolution'

export const REOPEN_LIMIT = 5

export interface VersionNotes {
  version: string
  bullets: Bullet[]
}

/** One bundled version with the Highlights of its file (`null` = `None.`). */
export interface BundledNotes {
  version: string
  highlights: Highlights | null
}

const VERSION_FILE = /\/(\d+\.\d+\.\d+)\.md$/

/** The locale's bullets, `de` when that subsection is somehow missing. */
export function bulletsFor(highlights: Highlights, locale: AppLocale): Bullet[] {
  const own = highlights[locale]
  return own?.length ? own : highlights.de
}

/** Parses raw files keyed by path. An unparseable file is skipped (dev log only); it never blocks startup. */
export function parseBundle(files: Record<string, string>): BundledNotes[] {
  const bundle: BundledNotes[] = []
  for (const [path, text] of Object.entries(files)) {
    const version = VERSION_FILE.exec(path)?.[1]
    if (!version) continue
    const parsed = parseReleaseNotes(text)
    if (parsed.ok) {
      bundle.push({ version, highlights: parsed.highlights })
    } else if (import.meta.dev) {
      console.warn(`[release-notes] ${path} skipped:`, parsed.errors)
    }
  }
  return bundle.sort((a, b) => compareVersions(b.version, a.version))
}

/** Versions `v` with `lastSeen < v <= current` that have highlights, newest first. */
export function versionsToShow(bundle: BundledNotes[], lastSeen: string, current: string, locale: AppLocale): VersionNotes[] {
  return bundle
    .filter(entry => entry.highlights && compareVersions(entry.version, lastSeen) > 0 && compareVersions(entry.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(entry => ({ version: entry.version, bullets: bulletsFor(entry.highlights as Highlights, locale) }))
}

/** The `count` newest versions with highlights, up to the running version. */
export function latestWithHighlights(bundle: BundledNotes[], count: number, locale: AppLocale, current?: string): VersionNotes[] {
  return bundle
    .filter(entry => entry.highlights && (!current || compareVersions(entry.version, current) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, count)
    .map(entry => ({ version: entry.version, bullets: bulletsFor(entry.highlights as Highlights, locale) }))
}

/** Memoizes an async loader, but forgets a rejection so the next call retries. */
export function retryingOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    promise ??= load().catch((error: unknown) => {
      promise = null
      throw error
    })
    return promise
  }
}

/** Loads and parses the bundled files once (dynamic import: the web build never calls this). */
export const loadBundledNotes = retryingOnce(async (): Promise<BundledNotes[]> => {
  const modules = import.meta.glob<string>('/release-notes/[0-9]*.md', { query: '?raw', import: 'default' })
  const files: Record<string, string> = {}
  await Promise.all(Object.entries(modules).map(async ([path, load]) => { files[path] = await load() }))
  return parseBundle(files)
})
