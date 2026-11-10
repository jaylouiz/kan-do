/**
 * Validation of a catalog entry (#66) against the manifest, used by tests/devtools/ui-catalog/entries.test.ts. Pure: it
 * returns the problems as text, so the test can also prove that a bad entry is caught.
 */
import { CATALOG_DEMO_TASKS, CATALOG_STATES, type CatalogEntry } from '~/catalog/types'
import { isI18nRef, type ManifestRow } from './catalogModel'

/** Every i18n key an entry refers to (slots and props, nested). */
export function referencedKeys(entry: CatalogEntry): string[] {
  const keys: string[] = []
  const visit = (value: unknown) => {
    if (isI18nRef(value)) keys.push(value.$t)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(entry.matrix)
  for (const example of [...(entry.variants ?? []), ...entry.states]) visit([example.props, example.slot])
  return keys
}

/** What is wrong with the entry stored at `path` (`catalog/<category>/<Name>.catalog.ts`): `[]` when it is fine. */
export function entryProblems(path: string, entry: CatalogEntry, manifest: ManifestRow[], locales: Record<string, Set<string>> = {}): string[] {
  const problems: string[] = []
  const row = manifest.find(r => r.name === entry.component)
  const [, folder, file] = /^catalog\/([^/]+)\/([^/]+)$/.exec(path) ?? []
  if (!row) problems.push(`${entry.component} has no manifest row`)
  if (file !== `${entry.component}.catalog.ts`) problems.push(`the file must be named ${entry.component}.catalog.ts`)
  if (row && folder !== row.category) problems.push(`the folder must be catalog/${row.category}/ (the category of its manifest row), not ${folder}`)
  if (row && row.source !== entry.source) problems.push(`source "${entry.source}" differs from the manifest row's "${row.source}"`)
  if (entry.source === 'nuxt-ui' && !entry.theme && !entry.sampleNote) problems.push('a nuxt-ui entry names its theme (only a provider without a theme, such as UApp, says why it has none in `sampleNote`)')
  if (entry.matrix && !entry.theme) problems.push('a matrix needs the theme it reads its axes from')
  if (entry.matrix && entry.matrix.axes.length === 0) problems.push('a matrix needs at least one axis')
  if (entry.source === 'app' && (entry.description || entry.usage || entry.avoid || entry.kind || entry.category)) {
    problems.push('an app entry takes description, usage, avoid, kind and category from the doc block; do not type them again')
  }
  const hasSamples = Boolean(entry.matrix) || (entry.variants?.length ?? 0) > 0 || entry.states.length > 0
  if (!hasSamples && !entry.sampleNote) problems.push('an entry without samples says why in `sampleNote`')
  if (hasSamples && entry.sampleNote) problems.push('`sampleNote` is set but the entry has samples')
  for (const example of [...(entry.variants ?? []), ...entry.states]) {
    if (example.trigger && example.slot === undefined) problems.push(`example "${example.id}" is a trigger but has no slot (nothing would render)`)
  }
  if (entry.host && entry.source !== 'app') problems.push('`host` is for an app component; a Nuxt UI component renders bare')
  for (const example of [...(entry.variants ?? []), ...entry.states]) {
    if (example.demoTasks && !entry.host) problems.push(`example "${example.id}" sets demoTasks but the entry has no host`)
    if (example.demoTasks && !(CATALOG_DEMO_TASKS as readonly string[]).includes(example.demoTasks)) problems.push(`example "${example.id}": unknown demoTasks "${example.demoTasks}"`)
  }
  for (const name of entry.alternatives) {
    if (!manifest.some(r => r.name === name)) problems.push(`alternative ${name} has no manifest row`)
  }
  const ids = [...(entry.variants ?? []), ...entry.states].map(example => example.id)
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) problems.push(`example id "${id}" is used twice`)
  for (const example of entry.states) {
    if (!(CATALOG_STATES as readonly string[]).includes(example.state)) problems.push(`unknown state "${example.state}" (${CATALOG_STATES.join(', ')})`)
  }
  for (const [locale, keys] of Object.entries(locales)) {
    for (const key of referencedKeys(entry)) if (!keys.has(key)) problems.push(`i18n key ${key} is missing in ${locale}`)
  }
  return problems
}

/**
 * Kit components that lack an entry: the kit is what a screen is built from, so each of its members shows its variants
 * and states on `/ui`. A feature part may have an entry (when it renders from fixtures) but does not need one: its
 * manifest row already carries the texts, and its look is reviewed on the screen it serves.
 */
export function missingEntries(manifest: ManifestRow[], entries: CatalogEntry[]): string[] {
  return manifest
    .filter(row => row.tier === 'kit' && !entries.some(entry => entry.component === row.name))
    .map(row => row.name)
}
