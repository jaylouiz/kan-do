import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCssVars, NON_UTILITY_CLASS, projectCssClasses } from '../../scripts/lint/design-tokens.mjs'

// Token use (scripts/lint/design-tokens.mjs): a `var(--x)` the project, Tailwind and Nuxt UI do not define renders
// nothing (or only its fallback), and no other check notices. The per-edit hook checks the edited file; this test
// checks every styling source, so a token removed elsewhere also fails here.

const root = resolve(__dirname, '../..')

describe('design tokens', () => {
  it('every var() in the styling sources resolves to a defined custom property', () => {
    const findings = checkCssVars(root) as { file: string, line: number, message: string }[]
    expect(findings.map(f => `${f.file.replace(`${root}/`, '')}:${f.line} ${f.message}`)).toEqual([])
  })

  it('reports a misspelt token with its line, and accepts real, runtime and dynamic ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-tokens-'))
    try {
      const file = join(dir, 'Probe.vue')
      writeFileSync(file, [
        '<template><div class="probe" :style="{ \'--probe-h\': h }" /></template>',
        '<style scoped>',
        '/* var(--in-a-comment) is not a use */',
        '.probe { color: var(--ui-text-mutd); }',
        '.probe { background: var(--ui-bg-elevated); border-color: var(--ui-color-primary-500); }',
        '.probe { height: var(--probe-h); width: var(--task-card-width); margin: var(--card-fallback, 1rem); }',
        '</style>',
      ].join('\n'))
      const findings = checkCssVars(root, [file]) as { line: number, message: string }[]
      expect(findings.map(f => [f.line, f.message.split(' ')[0]])).toEqual([[4, 'var(--ui-text-mutd)'], [6, 'var(--card-fallback)']])
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('knows the project-defined utilities and leaves component classes to the lint rule\'s ignore', () => {
    const classes = projectCssClasses(root) as string[]
    expect(classes).toEqual(expect.arrayContaining(['font-display', 'text-2xs', 'tracking-display']))
    const nonUtility = new RegExp(NON_UTILITY_CLASS)
    expect(['task-card', 'is-on', 'more-panel'].every(c => nonUtility.test(c))).toBe(true)
    expect(['text-muted-foreground', 'hover:bg-elevate', 'border-border', '!px-safe'].some(c => nonUtility.test(c))).toBe(false)
  })
})
