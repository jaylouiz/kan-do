import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// #557 (audit U9, U13): one tab implementation and no ALL CAPS eyebrows (the former styleguide's exception is gone with it, #65).
const root = resolve(__dirname, '../..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

describe('design patterns (#557)', () => {
  it('hand-rolls no tabs in pages: UTabs is the one tab implementation', () => {
    const pages = vueFiles(join(root, 'pages'))
    expect(pages.length).toBeGreaterThan(3)
    const offenders = pages.filter((f) => readFileSync(f, 'utf8').includes('role="tab'))
    expect(offenders.map((f) => relative(root, f))).toEqual([])
  })

  it('uses no uppercase class in components or pages', () => {
    const files = [...vueFiles(join(root, 'components')), ...vueFiles(join(root, 'pages')), ...vueFiles(join(root, 'layouts'))]
    expect(files.length).toBeGreaterThan(50)
    // also variant-prefixed (`md:uppercase`) and `@apply uppercase`
    const offenders = files.filter((f) => /(^|[\s"'`:])uppercase([\s"'`;]|$)/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => relative(root, f))).toEqual([])
  })

  it('renders no bare UModal: a dialog is an AppDialog, which names its width (DESIGN.md "Dialogs and overlays")', () => {
    // the palette is a UCommandPalette in a modal shell of its own; ResponsiveOverlay and AppDialog wrap UModal
    const allowed = ['components/CommandPalette.vue', 'components/ui/ResponsiveOverlay.vue', 'components/ui/AppDialog.vue']
    const files = [...vueFiles(join(root, 'components')), ...vueFiles(join(root, 'pages')), ...vueFiles(join(root, 'layouts'))]
    const offenders = files
      .filter(f => /<UModal[\s>]/.test(readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')))
      .map(f => relative(root, f))
      .filter(f => !allowed.includes(f))
    expect(offenders).toEqual([])
  })
})
