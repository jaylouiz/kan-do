#!/usr/bin/env node
/**
 * Search the UI kit manifest by job words (#79, epic #58): `npm run ui:find -- <words>`.
 *
 * First step of the Pattern check (`.claude/rules/ui-patterns.md`). Reads the manifest (`buildManifest()` in
 * scripts/ui-manifest.mjs, derived from the doc blocks on every run, no committed file; nothing is hard-coded here), scores every entry by how many query words start a word of its
 * `name`, `description`, `usage` or `avoid`, and prints the best matches: name, kind, category, source, `@usage`,
 * `@avoid` and the declared variants. `usage` and `description` weigh more than `avoid` (an `avoid` hit often says what
 * the component is NOT for, it is shown so you see the neighbour).
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildManifest } from './ui-manifest.mjs'

const WEIGHTS = { name: 4, description: 3, usage: 3, avoid: 1 }
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'with', 'is', 'it'])

const tokens = (text) => String(text ?? '').toLowerCase().match(/[a-zà-ÿ0-9]+/g) ?? []

/** Query words: lowercased, stop words dropped, words under 2 characters dropped. */
export function queryWords(query) {
  return tokens(query).filter(w => w.length > 1 && !STOP.has(w))
}

/**
 * @param {Array<Record<string, any>>} manifest
 * @param {string[]} words
 * @returns {Array<{ entry: Record<string, any>, score: number, hits: string[] }>} best first, score 0 dropped
 */
export function findEntries(manifest, words) {
  return manifest
    .map((entry) => {
      const fields = Object.fromEntries(Object.keys(WEIGHTS).map(f => [f, tokens(entry[f] ?? '')]))
      // camelCase names ("ConfirmDialog") also match their parts
      fields.name.push(...(String(entry.name).match(/[A-Z][a-z0-9]+/g) ?? []).map(p => p.toLowerCase()))
      let score = 0
      const hits = []
      for (const word of words) {
        const stem = word.length > 6 ? word.slice(0, -2) : word
        for (const [field, weight] of Object.entries(WEIGHTS)) {
          if (fields[field].some(t => t.startsWith(stem))) {
            score += weight
            if (field !== 'avoid') hits.push(word)
          }
        }
      }
      return { entry, score, hits: [...new Set(hits)] }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
}

export function formatResult({ entry, score }) {
  const variants = entry.variants?.length ? entry.variants.join(', ') : '-'
  return [
    `${entry.name}  [${entry.kind} · ${entry.category} · ${entry.source}]  score ${score}`,
    `  path:     ${entry.path}`,
    `  usage:    ${String(entry.usage).replace(/\s+/g, ' ')}`,
    `  avoid:    ${String(entry.avoid).replace(/\s+/g, ' ')}`,
    `  variants: ${variants}`,
  ].join('\n')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const words = queryWords(process.argv.slice(2).join(' '))
  if (!words.length) {
    console.error('usage: npm run ui:find -- <job words>   e.g. npm run ui:find -- "confirm destructive"')
    process.exit(2)
  }
  let manifest
  try {
    manifest = buildManifest()
  } catch (error) {
    console.error(`the manifest could not be built: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
  const found = findEntries(manifest, words)
  if (!found.length) {
    console.log(`no manifest entry matches "${words.join(' ')}": try other wordings, then /ui and the old searches (rule step 2)`)
  } else {
    console.log(found.slice(0, 8).map(formatResult).join('\n\n'))
  }
}
