import { parseReleaseNotes, type Bullet } from '~/lib/releaseNotesFormat.mjs'
import { getActiveLocale } from '~/lib/i18n'
import { bulletsFor } from '~/lib/releaseNotes'
import type { AvailableUpdate } from '~/types/updater'

/**
 * The "what's new" content of the update dialog (#226): the Highlights of the new version in the UI
 * locale, parsed from the manifest `notes` (the release-notes file verbatim). `null` renders nothing:
 * missing, unparseable, or `None.`. Fixes are never returned.
 */
export function getUpdateNotes(update: AvailableUpdate): Bullet[] | null {
  if (!update.notes) return null
  const parsed = parseReleaseNotes(update.notes)
  if (!parsed.ok || !parsed.highlights) return null
  return bulletsFor(parsed.highlights, getActiveLocale())
}
