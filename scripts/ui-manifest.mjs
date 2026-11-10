#!/usr/bin/env node
/**
 * UI kit manifest (#64, epic #58): one row per component, derived from the component doc blocks and `catalog/` (#117:
 * never committed, so parallel UI PRs have nothing to conflict on and a clean merge cannot leave it stale).
 * `buildManifest()` is the only source; `npm run ui:find` and the `/ui` page (`__UI_MANIFEST__`, nuxt.config.ts) call it,
 * `npm run ui:manifest` prints it as JSON.
 *
 * Every `components/**\/*.vue` (except `components/prototype/`) opens with an HTML comment whose lines start with a tag:
 * `@component` (name), `@kind`, `@category`, `@description`, `@usage`, `@avoid`, `@responsibility` (a `- ` list) and
 * optional `@accessibility`. A tag's value runs until the next known tag line or the closing `-->`. The doc block is
 * the only source: the manifest has no hand-written field.
 *
 * Row: `{ name, path, source, kind, category, tier, area, description, usage, avoid, responsibility, variants, states, usedBy }`.
 * A library row also has `usedValues` (the static values the app's templates pass for its matrix axes, `usedValues()`).
 * `tier` (`kit` or `feature`) and `area` are derived (`tierOf`, `areaOf`), never written in a doc block.
 * `source` is `app` (a component of this repo, text from its doc block) or `nuxt-ui` (a library component the catalog
 * (#66) shows; its row comes from `catalog/<category>/<Name>.catalog.ts`, which carries the text). `variants` and
 * `states` are the names an entry declares (`[]` for a component without an entry): the variant names of an app
 * component, the theme axes (`color`, `variant`, `size`) of a library one, and the state labels. App rows come first
 * (sorted by path), then the library rows.
 * `usedBy` counts the files that render the component as a tag (`<Name`, `<kebab-name`, `<LazyName`) or import its file (`.../Name.vue`), split by
 * `components` / `pages` / `layouts` / `app` (app.vue); the component itself and `pages/styleguide.vue` (the dev showcase
 * #65 removes: it is no real use) are not counted. A component mounted by `<component :is>` is not seen.
 *
 * `checkDocBlock` is pure: the missing or unknown tags of one doc block, used by `tests/config/component-conventions.test.ts`.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const UI_KINDS = ['primitive', 'component', 'compound', 'block']
export const UI_CATEGORIES = ['input', 'action', 'navigation', 'feedback', 'overlay', 'display', 'layout']
/** A component is kit from this many consumers on (the wrapper rule of DESIGN.md: a shared element earns its place at three call sites). */
export const KIT_MIN_CONSUMERS = 3

const consumers = counts => Object.values(counts).reduce((sum, n) => sum + n, 0)

/**
 * `kit` = what a new screen is built from: every Nuxt UI component, everything under `components/ui/`, and an app
 * component with `KIT_MIN_CONSUMERS` or more consumers. Everything else is a `feature` part: a composition that serves
 * one screen. Derived, never tagged, so a part that gains consumers moves into the kit by itself.
 * @param {{ source: string, path: string, usedBy: Record<string, number> }} row
 * @returns {'kit' | 'feature'}
 */
export function tierOf(row) {
  if (row.source === 'nuxt-ui' || row.path.startsWith('components/ui/')) return 'kit'
  return consumers(row.usedBy) >= KIT_MIN_CONSUMERS ? 'kit' : 'feature'
}

/**
 * The feature area of an app component: its folder under `components/` (`board`, `task`, `settings`, ...), `app` for a
 * file directly in `components/`, `nuxt-ui` for a library component.
 * @param {{ source: string, path: string }} row
 */
export function areaOf(row) {
  if (row.source === 'nuxt-ui') return 'nuxt-ui'
  const parts = row.path.split('/')
  return parts.length > 2 ? parts[1] : 'app'
}
export const REQUIRED_TAGS = ['component', 'kind', 'category', 'description', 'usage', 'avoid']
const TAGS = [...REQUIRED_TAGS, 'responsibility', 'accessibility']
const CATALOG_DIR = 'catalog'
const USAGE_EXCLUDED = new Set(['pages/styleguide.vue'])

/**
 * Splits the leading `<!-- ... -->` doc block of a component into `{ tag: text }` (text trimmed, lines joined by a newline).
 * @param {string} source
 * @returns {Record<string, string> | null}
 */
export function parseDocBlock(source) {
  const match = /^<!--\r?\n([\s\S]*?)\r?\n-->/.exec(source)
  if (!match) return null
  /** @type {Record<string, string>} */
  const tags = {}
  /** @type {string | null} */
  let current = null
  for (const line of match[1].split(/\r?\n/)) {
    const tag = /^@([a-z]+)\b[ \t]*(.*)$/.exec(line)
    if (tag && TAGS.includes(tag[1])) {
      current = tag[1]
      tags[current] = tag[2]
    } else if (current) {
      tags[current] += `\n${line}`
    }
  }
  for (const key of Object.keys(tags)) tags[key] = tags[key].trim()
  return tags
}

/**
 * Problems of one doc block (`[]` when fine): a missing doc block or required tag, an unknown `@kind` or `@category`.
 * @param {string} source
 * @returns {string[]}
 */
export function checkDocBlock(source) {
  const tags = parseDocBlock(source)
  if (!tags) return ['no doc block (<!-- @component ... --> at the top of the file)']
  const problems = REQUIRED_TAGS.filter(tag => !tags[tag]).map(tag => `missing @${tag}`)
  if (tags.kind && !UI_KINDS.includes(tags.kind)) problems.push(`@kind "${tags.kind}" is not one of ${UI_KINDS.join(', ')}`)
  if (tags.category && !UI_CATEGORIES.includes(tags.category)) problems.push(`@category "${tags.category}" is not one of ${UI_CATEGORIES.join(', ')}`)
  return problems
}

function walk(dir, accept, skipDir = () => false) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return skipDir(entry.name) ? [] : walk(path, accept, skipDir)
      return accept(entry.name) ? [path] : []
    })
}

/**
 * Every component file, relative to the repo root with `/` separators, sorted. `components/prototype/` is skipped.
 * @param {string} [root]
 * @returns {string[]}
 */
export function componentFiles(root = ROOT) {
  return walk(join(root, 'components'), name => name.endsWith('.vue'), name => name === 'prototype')
    .map(path => relative(root, path).split('\\').join('/'))
}

const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function usedBy(name, path, sources) {
  const pattern = new RegExp(`<(?:Lazy)?(?:${escapeRegExp(name)}|${escapeRegExp(kebab(name))})(?![A-Za-z0-9-])|/${escapeRegExp(basename(path))}['"]`)
  const counts = { components: 0, pages: 0, layouts: 0, app: 0 }
  for (const [file, source] of sources) {
    if (file === path || USAGE_EXCLUDED.has(file) || !pattern.test(source)) continue
    counts[file === 'app.vue' ? 'app' : file.split('/')[0]] += 1
  }
  return counts
}

/**
 * The static values the app's templates pass for the given props (`<UButton size="sm">` gives `{ size: ['sm'] }`),
 * sorted; a prop nothing sets is left out. Bound props (`:size="x"`) are not seen, so this is the floor of what is in use, not the ceiling; `/ui` uses it
 * to show the values the app really uses before the whole theme.
 * @param {string} name
 * @param {Array<[string, string]>} sources
 * @param {string[]} props
 * @returns {Record<string, string[]>}
 */
export function usedValues(name, sources, props) {
  const tag = new RegExp(`<(?:Lazy)?(?:${escapeRegExp(name)}|${escapeRegExp(kebab(name))})(?![A-Za-z0-9-])([^>]*)`, 'g')
  /** @type {Record<string, Set<string>>} */
  const values = {}
  for (const [, source] of sources) {
    for (const match of source.matchAll(tag)) {
      for (const attr of match[1].matchAll(/(?:^|\s)([a-z][a-zA-Z-]*)="([a-z0-9-]+)"/g)) if (props.includes(attr[1])) (values[attr[1]] ??= new Set()).add(attr[2])
    }
  }
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()]))
}

/**
 * Every catalog entry file (`catalog/<category>/<Name>.catalog.ts`), relative to the repo root, sorted.
 * @param {string} [root]
 * @returns {string[]}
 */
export function catalogFiles(root = ROOT) {
  try {
    return walk(join(root, CATALOG_DIR), name => name.endsWith('.catalog.ts')).map(path => relative(root, path).split('\\').join('/'))
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return []
    throw error
  }
}

/**
 * The parsed entries (`export default` of each entry file). They are plain data with type-only imports, so Node 24
 * loads the `.ts` itself (type stripping); no bundler is needed.
 * @param {string} [root]
 * @returns {Array<{ path: string, entry: any }>}
 */
export function loadCatalogEntries(root = ROOT) {
  const require = createRequire(join(root, 'package.json'))
  return catalogFiles(root).map(path => ({ path, entry: require(join(root, path)).default }))
}

const oneLine = text => text.replace(/\s+/g, ' ').trim()

/**
 * The manifest: the doc-block rows of `components/` (sorted by path), then one row per Nuxt UI entry of `catalog/`.
 * Throws on a doc block `checkDocBlock` rejects, an `@component` that is not the file's name, or a library entry that lacks a required field.
 * @param {string} [root]
 * @returns {Array<{ name: string, path: string, source: string, kind: string, category: string, tier: string, area: string, description: string, usage: string, avoid: string, responsibility: string[], variants: string[], states: string[], usedBy: Record<string, number> }>}
 */
export function buildManifest(root = ROOT) {
  const paths = componentFiles(root)
  const sources = [
    ...paths,
    ...walk(join(root, 'pages'), name => name.endsWith('.vue')).map(path => relative(root, path).split('\\').join('/')),
    ...walk(join(root, 'layouts'), name => name.endsWith('.vue')).map(path => relative(root, path).split('\\').join('/')),
    'app.vue',
  ].map(file => [file, readFileSync(join(root, file), 'utf8')])
  // A tag written in a comment (a doc block's `@usage <TaskCard ...>`) is no use.
  const rendered = sources.map(([file, text]) => [file, text.replace(/<!--[\s\S]*?-->/g, '')])
  const source = new Map(sources)
  const entries = loadCatalogEntries(root)
  const entryOf = name => entries.find(({ entry }) => entry.component === name)?.entry
  /** Names an entry declares: its variants (an app component's, or the theme axes of a library one) and its state labels. */
  const declared = (entry) => {
    if (!entry) return { variants: [], states: [] }
    return {
      variants: entry.matrix ? [...entry.matrix.axes] : (entry.variants ?? []).map(variant => variant.id),
      states: [...new Set((entry.states ?? []).map(state => state.state))],
    }
  }
  const appRows = paths.map((path) => {
    const problems = checkDocBlock(source.get(path))
    if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`)
    const tags = /** @type {Record<string, string>} */ (parseDocBlock(source.get(path)))
    const name = oneLine(tags.component.split(/\s+/)[0])
    if (path.split('/').pop() !== `${name}.vue`) throw new Error(`${path}: @component "${name}" must equal the file name`)
    return {
      name,
      path,
      source: 'app',
      kind: tags.kind,
      category: tags.category,
      description: oneLine(tags.description),
      usage: oneLine(tags.usage),
      avoid: oneLine(tags.avoid),
      responsibility: (tags.responsibility ?? '')
        .split(/\n(?=- )/)
        .map(oneLine)
        .filter(Boolean)
        .map(item => item.replace(/^- /, '')),
      ...declared(entryOf(name)),
      usedBy: usedBy(name, path, rendered),
    }
  })
  const libraryRows = entries
    .filter(({ entry }) => entry.source === 'nuxt-ui')
    .map(({ path, entry }) => {
      const missing = REQUIRED_TAGS.filter(tag => tag !== 'component' && !entry[tag])
      if (missing.length > 0) throw new Error(`${path}: a nuxt-ui entry needs ${missing.join(', ')}`)
      if (!UI_KINDS.includes(entry.kind)) throw new Error(`${path}: kind "${entry.kind}" is not one of ${UI_KINDS.join(', ')}`)
      if (!UI_CATEGORIES.includes(entry.category)) throw new Error(`${path}: category "${entry.category}" is not one of ${UI_CATEGORIES.join(', ')}`)
      return {
        name: entry.component,
        path,
        source: 'nuxt-ui',
        kind: entry.kind,
        category: entry.category,
        description: oneLine(entry.description),
        usage: oneLine(entry.usage),
        avoid: oneLine(entry.avoid),
        responsibility: [],
        ...declared(entry),
        usedBy: usedBy(entry.component, path, rendered),
        usedValues: usedValues(entry.component, rendered, entry.matrix?.axes ?? []),
      }
    })
  return [...appRows, ...libraryRows].map(row => ({ ...row, tier: tierOf(row), area: areaOf(row) }))
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(buildManifest(), null, 2)}\n`)
}
