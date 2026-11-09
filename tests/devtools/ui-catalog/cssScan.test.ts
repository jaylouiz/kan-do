import { describe, expect, it } from 'vitest'
import { scanDeclarations } from '../../../dev-tools/ui-catalog/cssScan'

describe('scanDeclarations (#65)', () => {
  it('reads declarations with their line, value, trailing note and enclosing preludes', () => {
    const css = [
      '@layer base {',
      '  :root {',
      '    --a: 1rem; /* the a token */',
      '    color: red;',
      '  }',
      '}',
    ].join('\n')
    expect(scanDeclarations(css, 'x.css')).toEqual([
      { prop: '--a', value: '1rem', file: 'x.css', line: 3, context: ['@layer base', ':root'], note: 'the a token' },
      { prop: 'color', value: 'red', file: 'x.css', line: 4, context: ['@layer base', ':root'], note: '' },
    ])
  })

  it('ignores commented-out declarations and keeps line numbers across multi-line comments', () => {
    const css = '/* --gone: 1;\n   still comment */\n:root { --kept: 2 }'
    const result = scanDeclarations(css, 'x.css')
    expect(result.map(d => [d.prop, d.value, d.line])).toEqual([['--kept', '2', 3]])
  })

  it('reads a multi-line value as one declaration and does not split on ; inside url() or strings', () => {
    const css = ':root {\n  --edge:\n    inset 0 1px 0 red,\n    inset 0 -1px 0 blue;\n  --img: url(data:image/svg+xml;base64,AAA);\n  --s: "a;b";\n}'
    const result = scanDeclarations(css, 'x.css')
    expect(result.map(d => [d.prop, d.value])).toEqual([
      ['--edge', 'inset 0 1px 0 red, inset 0 -1px 0 blue'],
      ['--img', 'url(data:image/svg+xml;base64,AAA)'],
      ['--s', '"a;b"'],
    ])
    expect(result[0]!.line).toBe(2)
  })

  it('reads minified input and a last declaration without a semicolon', () => {
    const result = scanDeclarations('@layer theme{:host,:root{--ui-radius:0.25rem;--ui-container:80rem}}.dark{--ui-bg:#000}', 'm.css')
    expect(result.map(d => [d.prop, d.value, d.context])).toEqual([
      ['--ui-radius', '0.25rem', ['@layer theme', ':host,:root']],
      ['--ui-container', '80rem', ['@layer theme', ':host,:root']],
      ['--ui-bg', '#000', ['.dark']],
    ])
  })

  it('does not take selectors with a colon (a:hover) or at-rule preludes for declarations', () => {
    const css = 'a:hover { color: red }\n@media (min-width: 768px) { :root { --m: 1 } }'
    expect(scanDeclarations(css, 'x.css').map(d => d.prop)).toEqual(['color', '--m'])
  })
})
