import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { UI_CATEGORIES, UI_KINDS, checkDocBlock } from '../../scripts/ui-manifest.mjs'

// CLAUDE.md "Component Conventions": every component under components/ names itself with `defineOptions({ name })`
// and carries an `@component` doc block. Pages and app.vue are exempt (Nuxt names a page by its route; pages use `@page`).
// The doc block also carries `@kind`, `@category`, `@description`, `@usage` and `@avoid` (#64; the manifest
// `docs/design/ui-manifest.json` is generated from them, tests/scripts/ui-manifest.test.ts).
// `components/prototype/` holds throwaway proto-branch code and is skipped.

const root = resolve(__dirname, '../..')
const componentsDir = join(root, 'components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'prototype' ? [] : vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

const files = vueFiles(componentsDir).map(path => ({ path, rel: relative(root, path), source: readFileSync(path, 'utf8') }))

describe('component conventions', () => {
  it('finds the components', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('every component calls defineOptions with a name', () => {
    const missing = files.filter(f => !/defineOptions\(\s*\{[^}]*\bname:\s*['"][A-Za-z0-9]+['"]/.test(f.source)).map(f => f.rel)
    expect(missing, `Add defineOptions({ name: 'ComponentName' }) to:\n${missing.join('\n')}`).toEqual([])
  })

  it('every component has an @component doc block', () => {
    const missing = files.filter(f => !/@component\s+\w+/.test(f.source)).map(f => f.rel)
    expect(missing, `Add a header doc block (@component, @description, @usage, @responsibility) to:\n${missing.join('\n')}`).toEqual([])
  })

  it('every doc block names @kind, @category, @description, @usage and @avoid, with known kind and category', () => {
    const problems = files.flatMap(f => checkDocBlock(f.source).map(problem => `${f.rel}: ${problem}`))
    expect(problems, `Fix the doc block (kinds: ${UI_KINDS.join(', ')}; categories: ${UI_CATEGORIES.join(', ')}):\n${problems.join('\n')}`).toEqual([])
  })
})
