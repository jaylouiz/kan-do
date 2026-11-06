import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Warning notices are `UAlert` (subtle, warning), not hand-built boxes, and warning status text on
// `bg-default` is one step: `text-warning-700` (DESIGN.md "Notices and toasts", #558). The 800 step lives
// only in `app.config.ts` (the alert wash) and the base `text-warning` orange fails 4.5:1 as text.

const root = resolve(__dirname, '../..')
const FOLDERS = ['components', 'pages', 'layouts']

// A hand-built box (`border-warning/20 bg-warning/10`) and the drifting text steps.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/border-warning\//, 'hand-rolled warning box: use <UAlert color="warning" variant="subtle">'],
  [/text-warning-800/, 'use text-warning-700 for warning text on bg-default'],
]

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('warning notices (#558)', () => {
  it('no hand-rolled warning box and no drifting warning text step in app source', () => {
    const hits: string[] = []
    for (const folder of FOLDERS) {
      for (const file of files(join(root, folder))) {
        const text = readFileSync(file, 'utf8')
        for (const [pattern, why] of FORBIDDEN) {
          if (pattern.test(text)) hits.push(`${file.slice(root.length + 1)}: ${why}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
