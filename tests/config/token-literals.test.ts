import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkBaselineSlack, checkScaleLiterals, checkTokenLiterals, LITERAL_ALLOWLIST, SCALE_ALLOWLIST } from '../../scripts/lint/design-tokens.mjs'

// The literal ratchet (#69, scripts/lint/design-tokens.mjs `checkTokenLiterals`): a new raw colour, shadow colour,
// palette-hue class or off-scale radius fails. Each rule has one failing and one allowed fixture here; the repo-wide
// assertion is in design-tokens.test.ts.

type Finding = { file: string, line: number, message: string }

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'token-literals-'))
  mkdirSync(join(dir, 'components'), { recursive: true })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Findings of one fixture file as `line: first word of the message`. */
function scan(name: string, source: string) {
  const file = join(dir, 'components', name)
  writeFileSync(file, source)
  return (checkTokenLiterals(dir, [file]) as Finding[]).sort((a, b) => a.line - b.line).map(f => `${f.line}: ${f.message.split(' ')[0]}`)
}

const style = (...decls: string[]) => `<template><div class="probe" /></template>\n<style scoped>\n${decls.map(d => `.probe { ${d} }`).join('\n')}\n</style>`

describe('colour literals', () => {
  it('flags hex, rgb(a), hsl, oklch and named colours, also inside a shadow', () => {
    expect(scan('Hex.vue', style('color: #b8256f;', 'background: rgba(15, 23, 42, 0.1);', 'color: oklch(0.5 0.1 255);', 'color: white;', 'box-shadow: 0 1px 2px rgba(0,0,0,.1);')))
      .toEqual(['3: color:', '4: background:', '5: color:', '6: color:', '7: box-shadow:'])
  })

  it('flags a named colour used as a var() fallback', () => {
    expect(scan('Fallback.vue', style('color: var(--ui-color-primary-50, white);'))).toEqual(['3: color:'])
  })

  it('passes tokens, compositions of tokens and keywords', () => {
    expect(scan('Tokens.vue', style(
      'color: var(--ui-text-muted);',
      'background: color-mix(in srgb, var(--ui-primary) 40%, transparent);',
      'box-shadow: inset 0 0 0 1px var(--ui-border-accented);',
      'border-color: currentColor;',
      'color: var(--ui-color-success-700);',
      'background: var(--color-white);',
    ))).toEqual([])
  })

  it('flags a quoted hex and an rgb() call in script text, ignores comments', () => {
    const source = '<script setup lang="ts">\n// #fff is a colour in a comment, #470 an issue\nconst a = \'#b8256f\'\nconst b = `rgba(0, 0, 0, 0.3)`\n</script>\n<template><div /></template>'
    expect(scan('Script.vue', source)).toEqual(['3: \'#b8256f\'', '4: rgba(0,'])
  })
})

describe('false positives the review found', () => {
  it('skips anchors, ids, url() fragments, selectors named like a colour and quoted strings', () => {
    const source = [
      '<script setup lang="ts">',
      'const target = document.querySelector(\'#fade\') // see https://x.test/#cafe12',
      'const href = \'//cdn.example/a\'; const bg = \'#b8256f\'',
      '</script>',
      '<template><a href="#add">x</a></template>',
      '<style scoped>',
      '.a:is(.red) { filter: url(#fade); mask: url(#cafe); }',
      '.btn:not(.white):hover { content: "red"; animation-name: lime; --my-radius: var(--radius-xs); }',
      '.probe { color: rebeccapurple; background: lab(50% 40 59); }',
      '</style>',
    ].join('\n')
    expect(scan('Review.vue', source)).toEqual(['3: \'#b8256f\'', '9: color:', '9: background:'])
  })
})

describe('recall (review round 2)', () => {
  it('still flags short quoted hex, colour functions in script and a named colour inside a function value', () => {
    const source = [
      '<script setup lang="ts">',
      'const a = \'#fff\'; const b = \'#0008\'; const c = \'lab(50% 40 59)\'',
      'const ok = document.querySelector(\'#add\');// #fff in a comment',
      '</script>',
      '<style scoped>',
      '.x { filter: drop-shadow(0 2px 4px red); text-emphasis: filled tomato }',
      '.y { color: #fff }',
      '</style>',
    ].join('\n')
    expect(scan('Recall.vue', source)).toEqual(['2: \'#fff\'', '2: \'#0008\'', '2: lab(50%', '6: filter:', '6: text-emphasis:', '7: color:'])
  })
})

describe('palette classes', () => {
  it('flags a raw hue, a custom-* palette step and the white/black utilities, also behind variants', () => {
    expect(scan('Classes.vue', '<template>\n<p class="bg-red-500" />\n<p class="hover:text-slate-700" />\n<p class="bg-custom-ink-900" />\n<p class="text-white border-black/10" />\n</template>'))
      .toEqual(['2: bg-red-500', '3: hover:text-slate-700', '4: bg-custom-ink-900', '5: text-white', '5: border-black/10'])
  })

  it('passes semantic roles with or without a step', () => {
    expect(scan('Roles.vue', '<template>\n<p class="text-error-700 bg-primary/10 text-warning-800 bg-elevated text-muted border-default text-success hover:bg-primary-600" />\n</template>')).toEqual([])
  })
})

describe('radius', () => {
  it('flags px and rem values and an arbitrary rounded-[…]', () => {
    expect(scan('Radius.vue', `<template><div class="rounded-[3px]" /></template>\n${style('border-radius: 0.25rem;', 'border-radius: 2px 4px;', 'border-top-left-radius: 1rem;')}`))
      .toEqual(['1: rounded-[3px]', '4: border-radius:', '5: border-radius:', '6: border-top-left-radius:'])
  })

  it('passes the scale tokens, calc over a token and the shape keywords', () => {
    expect(scan('Scale.vue', style(
      'border-radius: var(--radius-xs);',
      'border-radius: calc(var(--ui-radius) * 0.75);',
      'border-radius: var(--radius-lg) var(--radius-lg) 0 0;',
      'border-radius: 9999px;',
      'border-radius: 50%;',
      'border-radius: 0;',
      'border-radius: inherit;',
    ))).toEqual([])
  })
})

describe('gaps closed by #110', () => {
  it('flags a literal radius behind a var() fallback, passes a token or scale fallback', () => {
    expect(scan('RadiusFallback.vue', style(
      'border-radius: var(--radius-md, 4px);',
      'border-radius: var(--radius-md, var(--radius-sm));',
      'border-radius: var(--radius-md, 0);',
      'border-radius: var(--a, 2px) var(--b);',
    ))).toEqual(['3: border-radius:', '6: border-radius:'])
  })

  it('flags a colour literal in scrollbar-color, passes tokens and keywords', () => {
    expect(scan('Scrollbar.vue', style(
      'scrollbar-color: #888 transparent;',
      'scrollbar-color: white transparent;',
      'scrollbar-color: color-mix(in oklab, var(--focus-dusk) 35%, transparent) transparent;',
      'scrollbar-color: auto;',
      'scroll-snap-type: x mandatory;',
    ))).toEqual(['3: scrollbar-color:', '4: scrollbar-color:'])
  })

  it('does not let a glob string open a fake comment that hides what follows', () => {
    const source = '<script setup lang="ts">\nconst glob = \'components/*.vue\'\nconst bad = \'#b8256f\'\nconst other = \'a/*b*/\'\n</script>\n<template><div class="bg-red-500" /></template>\n<style scoped>\n.a { color: #fff; }\n</style>'
    expect(scan('Glob.vue', source)).toEqual(['3: \'#b8256f\'', '6: bg-red-500', '8: color:'])
  })

  it('still ignores a real comment, also one after a closed string', () => {
    const source = '<script setup lang="ts">\nconst a = \'x\' /* \'#fff\' */ + \'y\'\n/* "#000" */\n</script>\n<template><div /></template>'
    expect(scan('Real.vue', source)).toEqual([])
  })
})

describe('allowlist', () => {
  it('names a reason for every entry and skips those files', () => {
    for (const reason of Object.values(LITERAL_ALLOWLIST)) expect(reason.length).toBeGreaterThan(10)
    mkdirSync(join(dir, 'assets/css'), { recursive: true })
    const file = join(dir, 'assets/css/main.css')
    writeFileSync(file, '.x { color: #db4035; }')
    expect(checkTokenLiterals(dir, [file])).toEqual([])
  })
})

// The #70 ratchet (`checkScaleLiterals`): z-index, breakpoint, type, spacing and motion. The fixture folder has no
// baseline file, so every motion literal counts as new.

/** Findings of `checkScaleLiterals` for one fixture as `line: first word of the message`. */
function scale(name: string, source: string) {
  const file = join(dir, 'components', name)
  writeFileSync(file, source)
  return (checkScaleLiterals(dir, [file]) as Finding[]).sort((a, b) => a.line - b.line).map(f => `${f.line}: ${f.message.split(' ')[0]}`)
}

describe('z-index (#70)', () => {
  it('flags a layer above 20 in CSS and as a class, passes local stacking and tokens', () => {
    expect(scale('Z.vue', `<template><div class="z-2100 md:z-[500] z-10 z-(--z-overlay)" /></template>\n${style('z-index: 450;', 'z-index: 20;', 'z-index: -1;', 'z-index: var(--z-bar);', 'z-index: calc(var(--z-item-base) + var(--item-index, 0));')}`))
      .toEqual(['1: z-2100', '1: md:z-[500]', '4: z-index:'])
  })
})

describe('breakpoints (#70)', () => {
  it('flags a width written as a number in @media, matchMedia and useMediaQuery', () => {
    expect(scale('Bp.vue', `<script setup>\nconst a = window.matchMedia('(max-width: 767px)')\nconst b = useMediaQuery("(min-width: 768px)")\n</script>\n<template><div /></template>\n<style>\n@media (max-width: 767px) { .a { color: var(--ui-text); } }\n@container (min-width: 20rem) { .b { color: var(--ui-text); } }\n</style>`))
      .toEqual(['2: matchMedia(\'(max-width:', '3: useMediaQuery("(min-width:', '7: @media', '8: @container'])
  })

  it('passes a named breakpoint and other media features', () => {
    expect(scale('BpOk.vue', `<script setup>\nconst a = window.matchMedia(BREAKPOINT_QUERIES.phone)\nconst b = window.matchMedia('(prefers-reduced-motion: reduce)')\n</script>\n<template><div /></template>\n<style>\n@media (--phone) { .a { color: var(--ui-text); } }\n@media (pointer: coarse), (--phone) { .b { color: var(--ui-text); } }\n</style>`)).toEqual([])
  })
})

describe('type (#70)', () => {
  it('flags a font-size that equals a role or Tailwind step and an arbitrary text size', () => {
    expect(scale('Type.vue', `<template><div class="text-[0.6875rem]/3" /></template>\n${style('font-size: 0.9375rem;', 'font-size: 0.875rem;')}`))
      .toEqual(['1: text-[0.6875rem]/3', '4: font-size:', '5: font-size:'])
  })

  it('passes tokens, em and off-scale sizes', () => {
    expect(scale('TypeOk.vue', `<template><div class="text-label/3 text-sm" /></template>\n${style('font-size: var(--text-title);', 'font-size: 0.9em;', 'font-size: 0.8125rem;', 'font-size: inherit;')}`)).toEqual([])
  })
})

describe('spacing (#70)', () => {
  it('flags an arbitrary spacing or size class, passes calc, viewport units and the scale', () => {
    expect(scale('Space.vue', '<template><div class="min-w-[260px] gap-[7px] md:p-[1rem] max-h-[80vh] w-[calc(100%-2.5rem)] p-3 gap-(--task-list-gap) w-65" /></template>'))
      .toEqual(['1: min-w-[260px]', '1: gap-[7px]', '1: md:p-[1rem]'])
  })
})

describe('motion (#70)', () => {
  it('counts durations and curves in transition and animation, not tokens, custom properties or 0', () => {
    const file = join(dir, 'components', 'Motion.vue')
    writeFileSync(file, `<template><div class="duration-300 ease-[cubic-bezier(0.1,0,0,1)] duration-(--duration-fast)" /></template>\n${style(
      'transition: color 150ms ease, opacity var(--duration-base) var(--ease-standard);',
      'animation: pop 0.2s cubic-bezier(0.4, 0, 0.2, 1);',
      '--local-ease: cubic-bezier(0.2, 0, 0, 1);',
      '--local-duration: 220ms;',
      'transition-duration: 0ms;',
      'transition: opacity calc(var(--duration-fast) * 2);',
    )}`)
    expect((checkScaleLiterals(dir, [file]) as Finding[]).map(f => f.message.split(' ').slice(0, 3).join(' '))).toEqual(['5 motion literals'])
  })

  it('fails above the baseline and reports a baseline above the count', () => {
    mkdirSync(join(dir, 'scripts/lint'), { recursive: true })
    const file = join(dir, 'components', 'Base.vue')
    writeFileSync(file, style('transition: opacity 150ms ease;', 'transition: color 150ms ease;'))
    writeFileSync(join(dir, 'scripts/lint/literal-baseline.json'), JSON.stringify({ motion: { 'components/Base.vue': 2, 'components/Gone.vue': 3 } }))
    expect(checkScaleLiterals(dir, [file])).toEqual([])
    writeFileSync(join(dir, 'scripts/lint/literal-baseline.json'), JSON.stringify({ motion: { 'components/Base.vue': 1 } }))
    expect(checkScaleLiterals(dir, [file])).toHaveLength(1)
    writeFileSync(join(dir, 'scripts/lint/literal-baseline.json'), JSON.stringify({ motion: { 'components/Base.vue': 5 } }))
    expect((checkBaselineSlack(dir) as Finding[]).map(f => f.message)).toEqual([expect.stringContaining('has 2 motion literals, the baseline says 5')])
    rmSync(join(dir, 'scripts/lint/literal-baseline.json'))
  })
})

describe('scale allowlist (#70)', () => {
  it('names a reason for every entry', () => {
    for (const { reason, literals } of Object.values(SCALE_ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(10)
      expect(literals.length).toBeGreaterThan(0)
    }
  })

  it('allows the named literal in an allowlisted file, not another one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-'))
    const file = join(dir, 'app.config.ts')
    writeFileSync(file, "export default { a: 'text-[0.5rem]/3', b: 'text-[13px]', c: 'p-[7px]' }\n")
    const messages = (checkScaleLiterals(dir, [file]) as Finding[]).map(f => f.message)
    expect(messages).toHaveLength(2)
    expect(messages.join('\n')).toContain('text-[13px]')
    expect(messages.join('\n')).toContain('p-[7px]')
    rmSync(dir, { recursive: true, force: true })
  })
})
