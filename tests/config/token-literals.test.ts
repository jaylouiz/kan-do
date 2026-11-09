import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkTokenLiterals, LITERAL_ALLOWLIST } from '../../scripts/lint/design-tokens.mjs'

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

describe('allowlist', () => {
  it('names a reason for every entry and skips those files', () => {
    for (const reason of Object.values(LITERAL_ALLOWLIST)) expect(reason.length).toBeGreaterThan(10)
    mkdirSync(join(dir, 'assets/css'), { recursive: true })
    const file = join(dir, 'assets/css/integrations.css')
    writeFileSync(file, '.x { color: #db4035; }')
    expect(checkTokenLiterals(dir, [file])).toEqual([])
  })
})
