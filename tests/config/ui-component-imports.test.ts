import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Nuxt registers `components/ui/EmptyNote.vue` as `UiEmptyNote`, so a bare `<EmptyNote>` only resolves
// through an explicit import. Without it Vue renders an unknown `<emptynote>` element in default ink at
// 16 px and only a visual check notices (#74). Every `components/ui/*.vue` used in a template must be
// imported (that is also how `GithubTokenRow` uses `ExternalLink`).

const root = resolve(__dirname, '../..')
const UI_DIR = join(root, 'components/ui')
const SKIP_DIRS = new Set(['node_modules', 'tests', 'docs', 'src-tauri', 'public', 'release-notes'])

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...vueFiles(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const uiComponents = readdirSync(UI_DIR).filter(f => f.endsWith('.vue')).map(f => f.replace(/\.vue$/, ''))

describe('components/ui users import what they render', () => {
  const files = vueFiles(root).filter(f => !f.startsWith(UI_DIR))

  for (const name of uiComponents) {
    it(`${name} is imported wherever <${name}> appears`, () => {
      const missing: string[] = []
      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        if (!new RegExp(`<${name}[\\s>/]`).test(text)) continue
        if (!new RegExp(`import\\s+${name}\\s+from\\s+['"][^'"]*components/ui/${name}\\.vue['"]`).test(text)) {
          missing.push(file.slice(root.length + 1))
        }
      }
      expect(missing).toEqual([])
    })
  }
})
