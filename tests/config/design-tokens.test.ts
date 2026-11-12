import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBaselineSlack, checkCssVars, checkScaleLiterals, checkTokenLiterals, NON_UTILITY_CLASS, projectCssClasses } from '../../scripts/lint/design-tokens.mjs'

// Token use (scripts/lint/design-tokens.mjs): a `var(--x)` the project, Tailwind and Nuxt UI do not define renders
// nothing (or only its fallback), and no other check notices. The per-edit hook checks the edited file; this test
// checks every styling source, so a token removed elsewhere also fails here.

const root = resolve(__dirname, '../..')

describe('design tokens', () => {
  it('every var() in the styling sources resolves to a defined custom property', () => {
    const findings = checkCssVars(root) as { file: string, line: number, message: string }[]
    expect(findings.map(f => `${f.file.replace(`${root}/`, '')}:${f.line} ${f.message}`)).toEqual([])
  })

  it('has no colour, shadow-colour or radius literal outside the allowlist (#69)', () => {
    const findings = checkTokenLiterals(root) as { file: string, line: number, message: string }[]
    expect(findings.map(f => `${f.file.replace(`${root}/`, '')}:${f.line} ${f.message}`)).toEqual([])
  })

  it('has no new z-index, breakpoint, type, spacing or motion literal beyond the baseline (#70)', () => {
    const findings = [...checkScaleLiterals(root), ...checkBaselineSlack(root)] as { file: string, line: number, message: string }[]
    expect(findings.map(f => `${f.file.replace(`${root}/`, '')}:${f.line} ${f.message}`)).toEqual([])
  })

  it('tells tailwind-merge every type role of main.css, so a text-<role> class replaces Nuxt UI\'s own size (#70)', async () => {
    // `body` is the one role that is a utility (`@utility text-body`, utilities.css) and not a size token
    const roles = [...readFileSync(resolve(root, 'assets/css/main.css'), 'utf8').matchAll(/^\s*--text-([a-z]+):/gm)].map(m => m[1]).concat('body').sort()
    const config = readFileSync(resolve(root, 'app.config.ts'), 'utf8')
    const listed = /text: \[([^\]]*)\]/.exec(config)?.[1]?.match(/[a-z]+/g)?.sort()
    expect(listed).toEqual(roles)
  })

  it('lets text-body replace Nuxt UI\'s text-sm in a theme slot (kd#190)', async () => {
    const { extendTailwindMerge } = await import('tailwind-merge')
    const config = readFileSync(resolve(root, 'app.config.ts'), 'utf8')
    const roles = /text: \[([^\]]*)\]/.exec(config)?.[1]?.match(/[a-z]+/g) ?? []
    const merge = extendTailwindMerge({ extend: { theme: { text: roles } } })
    expect(merge('mt-1 text-sm text-muted', 'text-body')).toBe('mt-1 text-muted text-body')
    expect(merge('text-sm', 'text-label')).toBe('text-label')
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
    expect(classes).toEqual(expect.arrayContaining(['font-display', 'tracking-display']))
    const nonUtility = new RegExp(NON_UTILITY_CLASS)
    expect(['task-card', 'is-on', 'more-panel'].every(c => nonUtility.test(c))).toBe(true)
    expect(['text-muted-foreground', 'hover:bg-elevate', 'border-border', '!px-safe'].some(c => nonUtility.test(c))).toBe(false)
  })
})
