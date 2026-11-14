import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Two findings of the performance audit (#275) that come back silently: nothing breaks, the app only gets slower.

const root = resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'src-tauri', 'tests', 'docs', 'release-notes', 'public', 'scripts'])

function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path, pattern)
    return pattern.test(entry.name) ? [path] : []
  })
}

/** CSS comments removed, so a rule that explains the old selector does not count. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** The CSS of a file: all of a stylesheet, the `<style>` blocks of a component (its script may name the selector in a comment). */
const cssOf = (file: string, text: string) =>
  file.endsWith('.vue') ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n') : text

/** `html:has(`, `body:has(` or `:root:has(` as a selector in `text`. */
export function findPageLevelHas(text: string): string[] {
  return [...withoutComments(text).matchAll(/(?<![\w-])(?:html|body|:root)(?:\[[^\]]*\]|\.[\w-]+)*:has\(/g)].map(m => m[0])
}

/** Static value imports of the Todoist integration in `text` (`import type` is erased and fine). */
export function findStaticSdkImports(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/^\s*import\s+(type\s+)?[^;'"]*?from\s+['"]([^'"]+)['"]/gm)) {
    const [whole, typeOnly, specifier] = m
    if (typeOnly) continue
    if (/(^|\/)integrations\/TodoistIntegration$/.test(specifier ?? '') || specifier === '@doist/todoist-api-typescript') found.push(whole.trim())
  }
  return found
}

describe('page-level :has() selectors (#275)', () => {
  // A rule whose `:has()` sits on the root keeps the whole document in its scope: every change below that the
  // argument might care about restyles every element (measured: 2 whole-page restyles per task sheet, 5 per drag on
  // a 73-task board). The state belongs on <html> as an attribute, set by the component that owns it
  // (Board.vue: data-focus-lit, data-sheet-open; NewDayRecap.vue: data-recap-stage).
  it('finds the selector forms and ignores comments and descendants', () => {
    expect(findPageLevelHas('html:has(.a) .b { color: red }')).toHaveLength(1)
    expect(findPageLevelHas('html.dark:has(.a), body:has(.b), :root:has(.c) {}')).toHaveLength(3)
    expect(findPageLevelHas('/* html:has(.a) was here */ html[data-a] .b {}')).toHaveLength(0)
    expect(findPageLevelHas('.task:has(.task-topic) {} .x-html:has(.a) {}')).toHaveLength(0)
  })

  it('no stylesheet or component uses one', () => {
    const offenders = sourceFiles(root, /\.(css|vue)$/).flatMap((file) =>
      findPageLevelHas(cssOf(file, readFileSync(file, 'utf8'))).map(hit => `${relative(root, file)}: ${hit}`))
    expect(offenders, 'put the state on <html> as a data attribute instead (see the comment above)').toEqual([])
  })
})

describe('the Todoist SDK stays out of the first load (#275)', () => {
  // `useTaskSources` imports every adapter on every board. A static import of the integration pulls the SDK and its
  // validation library (321 kB, 88 kB gzipped) into the first load of a board that has no Todoist source.
  it('tells a static value import from a type import and a dynamic one', () => {
    expect(findStaticSdkImports(`import { TodoistIntegration } from '~/integrations/TodoistIntegration'`)).toHaveLength(1)
    expect(findStaticSdkImports(`import { TodoistApi } from "@doist/todoist-api-typescript";`)).toHaveLength(1)
    expect(findStaticSdkImports(`import type { TodoistIntegration } from '~/integrations/TodoistIntegration'`)).toHaveLength(0)
    expect(findStaticSdkImports(`const m = await import('~/integrations/TodoistIntegration')`)).toHaveLength(0)
  })

  it('only the integration itself imports the SDK, and nothing imports the integration statically', () => {
    const offenders = sourceFiles(root, /\.(vue|ts)$/)
      .filter(file => relative(root, file) !== join('integrations', 'TodoistIntegration.ts'))
      .flatMap(file => findStaticSdkImports(readFileSync(file, 'utf8')).map(hit => `${relative(root, file)}: ${hit}`))
    expect(offenders, 'load it with `await import(...)` inside the async call instead').toEqual([])
  })
})
