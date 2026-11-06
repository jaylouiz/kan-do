/**
 * @module utils/sourceMeta
 * @description What the UI shows of a source (#322, #323): the i18n key of its name and its bundled icon
 * (Local `ph`, Notion and Todoist `simple-icons`: no remote fetch, ADR 012). One map for the card's source
 * icon and the "Verschieben nach …" entries, so the two never drift.
 */
import type { SourceId } from '~/types/taskSource'

export interface SourceMeta {
  /** i18n key of the source's display name ("Lokal", "Notion", "Todoist") */
  nameKey: string
  /** Iconify name from a bundled collection */
  icon: string
}

export const SOURCE_META: Record<SourceId, SourceMeta> = {
  local: { nameKey: 'source.name.local', icon: 'i-ph-desktop' },
  notion: { nameKey: 'source.name.notion', icon: 'i-simple-icons-notion' },
  todoist: { nameKey: 'source.name.todoist', icon: 'i-simple-icons-todoist' },
}

/** Meta of a source; a missing or unknown one (a task added without `source`) degrades to Local instead of throwing (#360) */
export function sourceMetaOf(source: string | null | undefined): SourceMeta {
  return (source != null && Object.hasOwn(SOURCE_META, source) ? SOURCE_META[source as SourceId] : undefined) ?? SOURCE_META.local
}

/** True for a source the app knows; a task without a valid one counts toward no source (#360) */
export function isKnownSource(source: string | null | undefined): source is SourceId {
  return source != null && Object.hasOwn(SOURCE_META, source)
}
