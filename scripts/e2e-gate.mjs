#!/usr/bin/env node
/**
 * Tier selection of the pre-merge E2E gate (#355, `.claude/hooks/e2e-before-merge.sh`).
 *
 * `selectE2e` is pure: given the PR's files and body it returns which specs the hook runs.
 * Rules in order: every file docs-only -> `skip`; a forced `full` (env `E2E_GATE=full`, an unresolved or
 * truncated file list) -> `full`; every file style-only (#375: `.css`, a `.vue` whose changed lines all lie in
 * `<style>` blocks or comments, docs, `tests/e2e/snapshots/**`) -> `style` = no E2E, or only the changed specs
 * when the PR also touches `tests/e2e/*.spec.ts`; otherwise `targeted` = the smoke set + the `map` specs of every
 * changed file + the specs that import a changed `tests/e2e/helpers/*.ts` file (directly or through another
 * helper) + every changed spec that still exists + the specs that name a changed label or `data-testid` (#525, see
 * `changedTextStrings`) + the names on an `E2E-specs:` line of the PR body. No glob and no label selects the whole
 * suite (#446): the risk areas are `map` rules. The rules live in
 * `.claude/hooks/e2e-gate.json`. The style check of a `.vue` file reads the diff against the merge base. The gate's
 * own files (`.claude/hooks/e2e-*`, this script) are never docs-only: they run the smoke set plus their `map` rule,
 * and a PR that changes them merges with `E2E_GATE=full`. A changed file that no rule maps, and a changed helper
 * that no spec imports, is reported as `unmapped` (unit-test files and their helpers and fixtures are exempt).
 *
 * Testing mode (#693, `.claude/testing-mode`, `scripts/testing-mode.mjs`): in `fast` the non-skip, non-full result is
 * tier `fast` = the smoke set + the `map` rules flagged `risk: true` + the changed specs and the specs importing a
 * changed helper + the `E2E-specs:` line; the `design` specs and the label/testid text matches are dropped (also from a
 * style-only PR, which then runs no E2E) except the style fingerprint (kd#230): a change that can move the computed style of a `/ui`
 * sample (`catalog` in the rules: stylesheets, `app.config.ts`, a component with a catalog entry) adds
 * `catalog.specs`, style-only PRs included. `KANDO_TESTING_MODE` in the environment overrides the file (the gate's CLI tests). `quality` (the default, also for a missing or unknown value) is the
 * behaviour above, unchanged. `E2E_GATE=full` and an unresolved list still run everything in both modes.
 *
 * CLI (the hook calls it from the worktree that has the PR head, so the PR's own config is used):
 *   `gh pr view --json files,body,baseRefName,headRefOid | node scripts/e2e-gate.mjs`  -> decision as JSON
 *   `node scripts/e2e-gate.mjs summary <log>`                                    -> `{ failed, flaky }` of a run log
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { dirname, join, matchesGlob, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

import { e2eArgs, FULL_KEY, parseSummary, stampKey } from './release/e2e.mjs'
import { parseTestingMode, readTestingMode } from './testing-mode.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_SUFFIX = '.spec.ts'
const SPEC_DIR = 'tests/e2e/'
const HELPER_DIR = 'tests/e2e/helpers/'
/** Docs-only paths, like CI's `paths-ignore`: `docs/**`, `**\/*.md`, `.claude/**`. */
const DOCS_ONLY = /^(docs\/|\.claude\/)|\.md$/
/** The gate's own rules, hook and script (#446): they decide what every later PR runs, so they are never docs-only. */
const GATE_FILES = /^(\.claude\/hooks\/e2e-[^/]+|scripts\/e2e-gate\.mjs)$/
/** @param {string} file */
const isDocsOnly = file => DOCS_ONLY.test(file) && !GATE_FILES.test(file)
/** Files below `tests/` the E2E suite never reads: unit tests, their helpers and fixtures. `tests/e2e/` and the Notion stub fixtures are E2E inputs. */
const UNIT_ONLY = /^tests\/(?!e2e\/|fixtures\/notion\/)/
/** Style-only paths (#375): stylesheets and the visual-regression baselines; docs count too (`DOCS_ONLY`). */
const STYLE_ONLY = /\.css$|^tests\/e2e\/snapshots\//
/** `gh pr view --json files` returns at most 100 files; a full page may be a truncated list. */
const GH_FILE_LIMIT = 100

/** @param {string} file @param {string[]} globs */
const matchesAny = (file, globs) => globs.some(glob => matchesGlob(file, glob))

/** Basename of a spec file below `tests/e2e/` (no subdirectories), else `null`. */
function specName(file) {
  if (!file.startsWith(SPEC_DIR) || !file.endsWith(SPEC_SUFFIX)) return null
  const name = file.slice(SPEC_DIR.length, -SPEC_SUFFIX.length)
  return name && !name.includes('/') ? name : null
}

/** Relative import specifiers (`from './x'`, `import './x'`) of a TypeScript source. */
function relativeImports(text) {
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => match[1])
}

/**
 * Specs that import one of the changed helpers, directly or through another helper (`seed.ts` imports
 * `constants.ts`, so a `constants.ts` change reaches every spec that imports `seed.ts`). Derived from the import
 * statements at gate time, never from a hand list (#446).
 * @param {string[]} changedHelpers repo-relative paths below `tests/e2e/helpers/`
 * @param {Record<string, string>} sources repo-relative path -> text of every `tests/e2e/*.spec.ts` and `tests/e2e/helpers/*.ts`
 * @returns {string[]} spec basenames, sorted
 */
export function specsImportingHelpers(changedHelpers, sources) {
  const resolveImport = (from, spec) => {
    const base = posix.normalize(posix.join(posix.dirname(from), spec))
    return [base, `${base}.ts`, `${base}/index.ts`].find(path => path in sources)
  }
  /** @type {Map<string, Set<string>>} module -> modules that import it */
  const importedBy = new Map()
  for (const [path, text] of Object.entries(sources)) {
    for (const spec of relativeImports(text)) {
      const target = resolveImport(path, spec)
      if (target) importedBy.set(target, (importedBy.get(target) ?? new Set()).add(path))
    }
  }
  const seen = new Set(changedHelpers.filter(path => path in sources))
  const queue = [...seen]
  while (queue.length > 0) {
    for (const importer of importedBy.get(queue.pop()) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer)
        queue.push(importer)
      }
    }
  }
  return [...seen].map(specName).filter(Boolean).sort()
}

/**
 * Names on `E2E-specs: a b c` lines of a PR body (spaces or commas), basenames without `.spec.ts`. A line that
 * starts with the literal `none` names no spec; the rest of it is a comment.
 */
export function bodySpecNames(body) {
  const names = []
  for (const match of (body ?? '').matchAll(/^[ \t]*E2E-specs:[ \t]*(.*)$/gim)) {
    const tokens = match[1].split(/[\s,]+/)
    if (tokens[0]?.toLowerCase() === 'none') continue
    for (const raw of tokens) {
      const name = raw.replace(/^`|`$/g, '').replace(/^tests\/e2e\//, '').replace(/\.spec\.ts$/, '')
      if (name) names.push(name)
    }
  }
  return names
}

/** Locale files whose changed values name the elements a spec addresses by label (#525). */
const LOCALE_FILE = /^i18n\/locales\/[a-z]+\.json$/
/** Source files whose changed `data-testid` values name the elements a spec addresses by testid (#525). */
const TESTID_SOURCE = /\.(vue|ts|js|mjs)$/
const MIN_LABEL_LENGTH = 3
const MIN_TESTID_LENGTH = 4

/** Nested locale JSON -> `dotted.key -> string value` (non-string leaves are ignored). */
function flattenLocale(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node ?? {})) {
    if (typeof value === 'string') out[`${prefix}${key}`] = value
    else if (value && typeof value === 'object') flattenLocale(value, `${prefix}${key}.`, out)
  }
  return out
}

/** The text a spec can see of a message: split on `{placeholders}` and `|` (plural), short fragments dropped. */
const labelFragments = value => value.split(/\{[^}]*\}|\|/).map(part => part.trim()).filter(part => part.length >= MIN_LABEL_LENGTH)

/**
 * Strings a spec may assert that changed between two versions of one locale file (#525). A changed or removed key
 * contributes its old value. An added or removed key also contributes the values of its sibling keys (same parent
 * object): a spec that counts or orders a list breaks when the list grows although it never names the new value.
 * @param {object} before parsed locale JSON of the merge base (`{}` for an absent file)
 * @param {object} after parsed locale JSON of the head
 * @returns {string[]}
 */
export function localeStrings(before, after) {
  const a = flattenLocale(before)
  const b = flattenLocale(after)
  const strings = new Set()
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === b[key]) continue
    if (a[key] !== undefined) labelFragments(a[key]).forEach(part => strings.add(part))
    if (a[key] !== undefined && b[key] !== undefined) continue
    const parent = key.slice(0, key.lastIndexOf('.') + 1)
    for (const [other, value] of Object.entries(b)) {
      if (other !== key && other.startsWith(parent) && !other.slice(parent.length).includes('.')) labelFragments(value).forEach(part => strings.add(part))
    }
  }
  return [...strings].sort()
}

/**
 * `data-testid` values on the added and removed lines of a unified diff (#525). A dynamic id (template literal or
 * concatenation) contributes its static prefix; prefixes shorter than 4 characters are dropped. A bound attribute
 * (`:data-testid="…"`) contributes every string and template literal of its expression, a compared literal
 * (`state === 'rejected'`) included: over-selecting is the safe side. Line-based: an expression split over several
 * lines, and the `{ 'data-testid': cond ? 'a' : 'b' }` form of a script, are not read.
 * @param {string} diffText
 * @returns {string[]}
 */
export function testIdStrings(diffText) {
  const ids = new Set()
  for (const line of (diffText ?? '').split('\n')) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue
    for (const match of line.matchAll(/(:|v-bind:)?data-testid['"]?\s*[=:]\s*(["'`])(.*?)\2/g)) {
      // a bound attribute (`:data-testid="…"`) holds an expression: its string and template literals are the ids
      // (`state === 'a-id' ? 'b-id' : 'c-id'`), a bare identifier is none
      const literals = match[1]
        ? [...match[3].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(part => (part[1] ?? part[2] ?? part[3] ?? '').split('${')[0])
        : [/^[`'"]?([^`'"$]*)/.exec(match[3])?.[1] ?? '']
      for (const prefix of literals) if (prefix.length >= MIN_TESTID_LENGTH) ids.add(prefix)
    }
  }
  return [...ids].sort()
}

/**
 * Specs whose own text, or the text of a helper they import (directly or transitively), contains one of the
 * strings (#525; case-sensitive substring). Reuses the import graph of `specsImportingHelpers`.
 * @param {string[]} strings
 * @param {Record<string, string>} sources see `specsImportingHelpers`
 * @returns {string[]} spec basenames, sorted
 */
export function specsMentioning(strings, sources) {
  if (strings.length === 0) return []
  const matching = Object.entries(sources).filter(([, text]) => strings.some(string => text.includes(string))).map(([path]) => path)
  return specsImportingHelpers(matching, sources)
}

/** A `<style>` or `<script>` tag (open or close) that does not start its line (after other text on it). */
const INLINE_BLOCK_TAG = /\S.*<\/?(?:style|script)\b/i

/**
 * The lines of a Vue SFC outside its `<style>` blocks. Everything else counts as code, comments included: a
 * comment-only edit in `<script>` or `<template>` is not style-only (an accepted false negative, more robust
 * than parsing JS). Returns `null` when the file cannot be tracked line by line (#380): a `<style>`/`<script>`
 * tag that does not start its line, text after the `<style>` open tag or after a closing `</style>`, an
 * unterminated `<style>` block.
 * @param {string} text
 * @returns {string[] | null}
 */
export function vueCodeLines(text) {
  const code = []
  let inStyle = false
  for (const line of text.split('\n')) {
    if (inStyle) {
      const end = line.search(/<\/style\s*>/i)
      if (end === -1) continue
      if (line.slice(end).replace(/^<\/style\s*>/i, '').trim()) return null
      inStyle = false
      continue
    }
    if (/^\s*<style\b/i.test(line)) {
      const end = line.search(/<\/style\s*>/i)
      if (end === -1) {
        if (line.slice(line.indexOf('>') + 1).trim() || !line.includes('>')) return null
        inStyle = true
      } else if (line.slice(end).replace(/^<\/style\s*>/i, '').trim()) return null
      continue
    }
    if (INLINE_BLOCK_TAG.test(line)) return null
    code.push(line)
  }
  return inStyle ? null : code
}

/** Whether going from `before` to `after` of a `.vue` file changes only `<style>` blocks. */
export function isStyleOnlyVue(before, after) {
  const a = vueCodeLines(before)
  const b = vueCodeLines(after)
  if (!a || !b) return false
  return a.length === b.length && a.every((line, i) => line === b[i])
}

/**
 * @param {{
 *   files: string[] | null | undefined,
 *   body?: string,
 *   config: { smoke: string[], map: { paths: string[], specs: string[], risk?: boolean }[], design?: { paths: string[], specs: string[] }, catalog?: { paths: string[], components: string, specs: string[] } },
 *   existingSpecs: string[],
 *   cataloguedComponents?: () => Set<string>,
 *   env?: Record<string, string | undefined>,
 *   mode?: string,
 *   specsImportingHelper?: (helpers: string[]) => string[],
 *   changedStrings?: (files: string[]) => { strings: string[], failed: string[] },
 *   specsMentioning?: (strings: string[]) => string[],
 *   isStyleOnlyVueFile?: (file: string) => { styleOnly: boolean, failed: boolean },
 * }} input `files` null/empty = the list could not be resolved; `isStyleOnlyVueFile` judges a changed `.vue`
 *   file from the diff against the merge base (default: never style-only); a file whose judgement `failed`
 *   (git could not read a side, #380) is named in the `reason` of a non-style decision; `changedStrings` reads the
 *   labels and test ids the diff changed (#525, default none) and `specsMentioning` finds the specs that name one
 * @returns {{ tier: 'skip' | 'style' | 'full' | 'targeted' | 'fast', reason: string, specs: string[], unmapped: string[], unknown: string[], byText: string[], key: string }}
 */
export function selectE2e({ files, body = '', config, existingSpecs, env = {}, mode: rawMode = 'quality', isStyleOnlyVueFile = () => ({ styleOnly: false, failed: false }), specsImportingHelper = () => [], changedStrings = () => ({ strings: [], failed: [] }), specsMentioning: findByText = () => [], cataloguedComponents = () => new Set() }) {
  const exists = new Set(existingSpecs)
  const fast = parseTestingMode(rawMode) === 'fast'
  /** @type {string[]} changed `.vue` files whose judgement failed */
  const failed = []
  const result = (tier, reason, specs = [], unmapped = [], unknown = [], byText = [], textFailed = []) => {
    const notes = tier === 'style' ? [] : [
      ...(failed.length > 0 ? [`style judge failed: ${failed.join(', ')}`] : []),
      ...(textFailed.length > 0 ? [`text judge failed: ${textFailed.join(', ')}`] : []),
    ]
    return {
      tier,
      reason: [reason, ...notes].join('; '),
      specs, unmapped, unknown, byText, key: tier === 'full' ? FULL_KEY : stampKey(specs),
    }
  }

  /** The rendered design scan (`config.design`) for a PR that touches a UI path. */
  const designSpecs = (list) => !fast && config.design && list.some(file => matchesAny(file, config.design.paths)) ? config.design.specs : []
  /**
   * The style fingerprint (`config.catalog`, kd#230) in fast mode, which drops the other design specs: a change that can move the
   * computed style of a `/ui` sample selects it. That is a stylesheet or `app.config.ts` (`paths`) and a `.vue` file of a component
   * with a catalog entry (`components` glob, the entry's file name `catalog/<category>/<Name>.catalog.ts` names the component).
   * Quality mode has it through `design`.
   */
  let names = null // read from catalog/ once per selection, and only when a component file asks
  const catalogued = () => (names ??= cataloguedComponents())
  const catalogSpecs = (list) => {
    const rule = config.catalog
    if (!fast || !rule) return []
    const isCatalogued = file => catalogued().has(posix.basename(file, '.vue'))
    const moves = file => matchesAny(file, rule.paths) || (file.endsWith('.vue') && matchesGlob(file, rule.components) && isCatalogued(file))
    return list.some(moves) ? rule.specs : []
  }
  const resolved = Array.isArray(files) && files.length > 0
  const full = (reason) => result('full', reason, [...exists].sort())
  // A truncated list is never judged docs-only; the env switch beats the docs-only skip.
  const truncated = resolved && files.length >= GH_FILE_LIMIT
  if (resolved && !truncated && env.E2E_GATE !== 'full' && files.every(isDocsOnly)) return result('skip', 'docs-only')

  if (env.E2E_GATE === 'full') return full('E2E_GATE=full')
  if (!resolved) return full('file list unresolved')
  if (truncated) return full(`${files.length} files, list may be truncated`)

  // Style-only (#375): a changed spec still runs, a PR that edits one tests it.
  const rest = files.filter(file => specName(file) === null)
  const isStyleVue = (file) => {
    const verdict = isStyleOnlyVueFile(file)
    if (verdict.failed && !failed.includes(file)) failed.push(file)
    return verdict.styleOnly
  }
  const isStyleFile = file => STYLE_ONLY.test(file) || (file.endsWith('.vue') && isStyleVue(file))
  if (rest.some(file => !isDocsOnly(file)) && rest.every(file => isDocsOnly(file) || isStyleFile(file))) {
    const changedSpecs = [...new Set(files.map(specName).filter(name => name && exists.has(name)))]
    // A style change is exactly what the rendered design scan judges, so it runs even when nothing else does.
    const design = designSpecs(files) // none in fast mode
    const fingerprint = catalogSpecs(files) // fast mode only
    const picked = [...new Set([...changedSpecs, ...design, ...fingerprint])].filter(name => exists.has(name)).sort()
    if (picked.length === 0) return result('style', 'style-only: css, <style> blocks, comments, docs, snapshots')
    const reason = design.length > 0 ? 'style-only + design scan' : fingerprint.length > 0 ? 'style-only + style fingerprint' : 'style-only + touched specs'
    return result('targeted', reason, picked)
  }
  const specs = new Set([...config.smoke, ...designSpecs(files), ...catalogSpecs(files)])
  const unmapped = []
  for (const file of files) {
    if (isDocsOnly(file)) continue
    const touched = specName(file)
    if (touched) {
      specs.add(touched)
      continue
    }
    if (file.startsWith(HELPER_DIR) && file.endsWith('.ts')) {
      // a helper is covered by the specs that import it; one that nothing imports selects nothing (#446)
      const importers = specsImportingHelper([file])
      for (const name of importers) specs.add(name)
      if (importers.length === 0) unmapped.push(file)
      continue
    }
    const mapped = config.map.filter(rule => matchesAny(file, rule.paths))
    // fast mode runs only the risk-area rules; `unmapped` still reads the whole map
    for (const rule of mapped) if (!fast || rule.risk) for (const name of rule.specs) specs.add(name)
    // unit tests, their helpers and fixtures have no E2E spec to pick
    if (mapped.length === 0 && !UNIT_ONLY.test(file)) unmapped.push(file)
  }
  // A spec that asserts a changed label or test id is affected whatever file the change sits in (#525).
  const text = fast ? { strings: [], failed: [] } : changedStrings(files)
  const byText = [...new Set(findByText(text.strings))].filter(name => exists.has(name)).sort()
  for (const name of byText) specs.add(name)
  const named = bodySpecNames(body)
  const unknown = [...new Set(named.filter(name => !exists.has(name)))]
  for (const name of named) specs.add(name)

  // A deleted spec (touched but gone) or a stale map entry is dropped, never run.
  const selected = [...specs].filter(name => exists.has(name)).sort()
  if (fast) return result('fast', 'fast mode: smoke + risk-area mapped + touched specs', selected, unmapped, unknown, [], [])
  const reason = byText.length > 0 ? 'smoke + mapped + touched specs + label/testid match' : 'smoke + mapped + touched specs'
  return result('targeted', reason, selected, unmapped, unknown, byText, text.failed)
}

/**
 * The E2E set of an `alpha` or `beta` release in `fast` mode (#693): the smoke set plus every spec of a risk-area
 * rule. A `stable` release (and `quality` mode) runs the full suite instead.
 * @param {{ smoke: string[], map: { specs: string[], risk?: boolean }[] }} config
 * @param {string[]} existingSpecs
 */
export function fastReleaseSpecs(config, existingSpecs) {
  const exists = new Set(existingSpecs)
  const names = [...config.smoke, ...config.map.filter(rule => rule.risk).flatMap(rule => rule.specs)]
  return [...new Set(names)].filter(name => exists.has(name)).sort()
}

/** Component names with a `/ui` catalog entry: the `<Name>` of every `catalog/<category>/<Name>.catalog.ts` in a checkout (kd#230). */
export function listCataloguedComponents(root = ROOT) {
  const names = new Set()
  const suffix = '.catalog.ts'
  try {
    for (const category of readdirSync(join(root, 'catalog'), { withFileTypes: true })) {
      if (!category.isDirectory()) continue
      for (const file of readdirSync(join(root, 'catalog', category.name))) {
        if (file.endsWith(suffix)) names.add(file.slice(0, -suffix.length))
      }
    }
  } catch {
    // no catalog folder in this checkout: nothing is catalogued
  }
  return names
}

/** Basenames of `tests/e2e/*.spec.ts` in a checkout. */
export function listSpecs(root = ROOT) {
  return readdirSync(join(root, SPEC_DIR))
    .filter(name => name.endsWith(SPEC_SUFFIX))
    .map(name => name.slice(0, -SPEC_SUFFIX.length))
    .sort()
}

/**
 * Text of every `tests/e2e/*.spec.ts` and every `.ts` below `tests/e2e/helpers/` (subdirectories included) in a
 * checkout, keyed by repo-relative path. A missing directory reads as empty, so a docs-only PR never fails here.
 */
export function readE2eSources(root = ROOT) {
  /** @type {Record<string, string>} */
  const sources = {}
  const walk = (dir, recursive) => {
    let entries
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (recursive) walk(`${dir}${entry.name}/`, recursive)
      } else if (entry.name.endsWith('.ts')) {
        sources[`${dir}${entry.name}`] = readFileSync(join(root, dir, entry.name), 'utf8')
      }
    }
  }
  walk(SPEC_DIR, false)
  walk(HELPER_DIR, true)
  return sources
}

/** Normalises the JSON of `gh pr view --json files,body` (or `{}` when gh failed). */
export function parsePr(json) {
  const pr = json ?? {}
  return {
    files: Array.isArray(pr.files) ? pr.files.map(file => (typeof file === 'string' ? file : file.path)) : null,
    body: typeof pr.body === 'string' ? pr.body : '',
    baseRefName: typeof pr.baseRefName === 'string' && pr.baseRefName ? pr.baseRefName : 'main',
    headRefOid: typeof pr.headRefOid === 'string' && pr.headRefOid ? pr.headRefOid : 'HEAD',
  }
}

/** `git` runner of a checkout and the merge base of the PR head with its base branch (`undefined` when git cannot tell). */
function gitAtMergeBase(baseRef, head, root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  let mergeBase
  for (const ref of [`origin/${baseRef}`, baseRef]) {
    try {
      mergeBase = git('merge-base', ref, head).trim()
      break
    } catch {
      // try the next candidate
    }
  }
  return { git, mergeBase }
}

/**
 * Judges a changed `.vue` file from the diff against the merge base of the PR head and its base branch.
 * Anything git cannot answer (object missing, no remote ref) counts as "not style-only" with `failed: true`.
 * @param {string} baseRef @param {string} head
 */
export function vueStyleJudge(baseRef, head, root = ROOT) {
  const { git, mergeBase } = gitAtMergeBase(baseRef, head, root)
  const judge = (file) => {
    const fail = { styleOnly: false, failed: true }
    if (!mergeBase) return fail
    const show = (rev) => {
      try {
        return git('show', `${rev}:${file}`)
      } catch (error) {
        // an absent file (added or deleted on that side) is empty; an unreadable revision is a failure
        if (!git('ls-tree', rev, '--', file).trim()) return ''
        throw error
      }
    }
    try {
      return { styleOnly: isStyleOnlyVue(show(mergeBase), show(head)), failed: false }
    } catch {
      return fail
    }
  }
  return judge
}

/**
 * The labels and test ids a PR changed (#525), read from the diff of the head against the merge base: the values
 * of changed locale files (`localeStrings`) and the `data-testid` values of changed source files (`testIdStrings`).
 * A file git cannot read is named in `failed` and adds nothing. Anything below `tests/` and docs add no strings.
 * @param {string} baseRef @param {string} head
 * @returns {(files: string[]) => { strings: string[], failed: string[] }}
 */
export function changedTextStrings(baseRef, head, root = ROOT) {
  const { git, mergeBase } = gitAtMergeBase(baseRef, head, root)
  /** a revision's file as parsed JSON; an absent file is `{}` and an unreadable revision throws */
  const showJson = (rev, file) => {
    try {
      return JSON.parse(git('show', `${rev}:${file}`))
    } catch (error) {
      if (!git('ls-tree', rev, '--', file).trim()) return {}
      throw error
    }
  }
  return (files) => {
    const strings = new Set()
    const failed = []
    for (const file of files) {
      const locale = LOCALE_FILE.test(file)
      if (!locale && (file.startsWith('tests/') || isDocsOnly(file) || !TESTID_SOURCE.test(file))) continue
      try {
        if (!mergeBase) throw new Error('no merge base')
        const found = locale
          ? localeStrings(showJson(mergeBase, file), showJson(head, file))
          : testIdStrings(git('diff', '--no-color', '-U0', mergeBase, head, '--', file))
        found.forEach(string => strings.add(string))
      } catch {
        failed.push(file)
      }
    }
    return { strings: [...strings].sort(), failed }
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}

async function main() {
  const [command, arg] = process.argv.slice(2)
  if (command === 'summary') {
    console.log(JSON.stringify(parseSummary(readFileSync(arg, 'utf8'))))
    return
  }
  let pr
  try {
    pr = JSON.parse(await readStdin())
  } catch {
    // unparsable gh output counts as an unresolved file list
  }
  const config = JSON.parse(readFileSync(join(ROOT, '.claude/hooks/e2e-gate.json'), 'utf8'))
  const sources = readE2eSources()
  const existingSpecs = Object.keys(sources).map(specName).filter(Boolean).sort()
  const parsed = parsePr(pr)
  const isStyleOnlyVueFile = vueStyleJudge(parsed.baseRefName, parsed.headRefOid)
  const specsImportingHelper = helpers => specsImportingHelpers(helpers, sources)
  const changedStrings = changedTextStrings(parsed.baseRefName, parsed.headRefOid)
  const findByText = strings => specsMentioning(strings, sources)
  const mode = readTestingMode(ROOT, process.env)
  const decision = selectE2e({ ...parsed, config, existingSpecs, env: process.env, mode, isStyleOnlyVueFile, specsImportingHelper, changedStrings, specsMentioning: findByText, cataloguedComponents: () => listCataloguedComponents() })
  const files = decision.tier === 'full' ? [] : decision.specs.map(name => `tests/e2e/${name}${SPEC_SUFFIX}`)
  const args = decision.tier === 'skip' || decision.tier === 'style' ? [] : e2eArgs({ files, load: loadavg()[0], cpus: cpus().length })
  console.log(JSON.stringify({ ...decision, mode, args }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
