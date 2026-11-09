#!/usr/bin/env node
/**
 * UI kit manifest (#64, epic #58): `docs/design/ui-manifest.json`, generated from the component doc blocks.
 *
 * Every `components/**\/*.vue` (except `components/prototype/`) opens with an HTML comment whose lines start with a tag:
 * `@component` (name), `@kind`, `@category`, `@description`, `@usage`, `@avoid`, `@responsibility` (a `- ` list) and
 * optional `@accessibility`. A tag's value runs until the next known tag line or the closing `-->`. The doc block is
 * the only source: the manifest has no hand-written field (`npm run ui:manifest` rewrites it, a vitest test fails when
 * the committed file is stale).
 *
 * Entry: `{ name, path, kind, category, description, usage, avoid, responsibility, usedBy }`.
 * `usedBy` counts the files that render the component as a tag (`<Name`, `<kebab-name`, `<LazyName`) or import its file (`.../Name.vue`), split by
 * `components` / `pages` / `layouts` / `app` (app.vue); the component itself and `pages/styleguide.vue` (the dev showcase
 * #65 removes: it is no real use) are not counted. A component mounted by `<component :is>` is not seen.
 *
 * `checkDocBlock` is pure: the missing or unknown tags of one doc block, used by `tests/config/component-conventions.test.ts`.
 */
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const MANIFEST_PATH = join(ROOT, 'docs/design/ui-manifest.json')

export const UI_KINDS = ['primitive', 'component', 'compound', 'block']
export const UI_CATEGORIES = ['input', 'form-structure', 'action', 'navigation', 'keyboard', 'feedback', 'overlay', 'display', 'layout']
export const REQUIRED_TAGS = ['component', 'kind', 'category', 'description', 'usage', 'avoid']
const TAGS = [...REQUIRED_TAGS, 'responsibility', 'accessibility']
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

const oneLine = text => text.replace(/\s+/g, ' ').trim()

/**
 * The manifest of the doc blocks under `root`: an array sorted by path. Throws on a doc block `checkDocBlock` rejects or an `@component` that is not the file's name.
 * @param {string} [root]
 * @returns {Array<{ name: string, path: string, kind: string, category: string, description: string, usage: string, avoid: string, responsibility: string[], usedBy: Record<string, number> }>}
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
  return paths.map((path) => {
    const problems = checkDocBlock(source.get(path))
    if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`)
    const tags = /** @type {Record<string, string>} */ (parseDocBlock(source.get(path)))
    const name = oneLine(tags.component.split(/\s+/)[0])
    if (path.split('/').pop() !== `${name}.vue`) throw new Error(`${path}: @component "${name}" must equal the file name`)
    return {
      name,
      path,
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
      usedBy: usedBy(name, path, rendered),
    }
  })
}

export function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = renderManifest(buildManifest())
  writeFileSync(MANIFEST_PATH, text)
  console.log(`docs/design/ui-manifest.json: ${JSON.parse(text).length} components`)
}
