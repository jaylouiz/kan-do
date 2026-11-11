import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// kd#178: one field height. The `input`, `select`, `selectMenu` and `textarea` themes in `app.config.ts` set `lg` as the
// default size and an explicit height (the `--field-h` token), so a call site sets no size. This test keeps call sites
// from drifting, like `button-ladder.test.ts` does for buttons.

const root = resolve(__dirname, '../..')
const FOLDERS = ['components', 'pages', 'layouts']
/** The only call sites that set a field size: the title fields (own size, DESIGN.md "Type"); `InlineEditable` forwards its `size` prop to its input. */
const SIZE_ALLOWED: Record<string, number> = {
  'components/task/TaskForm.vue': 1,
  'components/ui/inline/InlineEditable.vue': 1,
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

interface Tag { file: string; line: number; name: string; attrs: string }

/** Every open tag of a field component; quote-aware, because attribute values hold `=>` and `>`. */
function fieldTags(): Tag[] {
  const files = [...FOLDERS.flatMap((folder) => vueFiles(join(root, folder))), join(root, 'app.vue')]
  const tags: Tag[] = []
  for (const path of files.filter((f) => !/error-test\.vue$|\/prototype\//.test(f))) {
    const text = readFileSync(path, 'utf8')
    const open = /<(u-?input|u-?select|u-?select-?menu|u-?textarea)(?=[\s/>])/gi
    let match: RegExpExecArray | null
    while ((match = open.exec(text))) {
      let i = match.index + match[0].length
      let quote = ''
      for (; i < text.length; i++) {
        const c = text[i]!
        if (quote) { if (c === quote) quote = '' }
        else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      tags.push({
        file: relative(root, path),
        line: text.slice(0, match.index).split('\n').length,
        name: match[1]!,
        attrs: text.slice(match.index + match[0].length, i),
      })
    }
  }
  return tags
}

describe('field size (kd#178)', () => {
  const tags = fieldTags()

  it('finds the field call sites', () => {
    expect(tags.length).toBeGreaterThan(20)
  })

  it('no UInput, USelect, USelectMenu or UTextarea sets a size, except the allowed title field', () => {
    const offenders: string[] = []
    const used: Record<string, number> = {}
    for (const tag of tags) {
      if (!/(^|\s):?size=/.test(tag.attrs)) continue
      used[tag.file] = (used[tag.file] ?? 0) + 1
      if ((used[tag.file] ?? 0) > (SIZE_ALLOWED[tag.file] ?? 0)) offenders.push(`${tag.file}:${tag.line} <${tag.name}> sets a size`)
    }
    expect(offenders).toEqual([])
  })

  it('a field that loads is also disabled, so it is locked like a loading button', () => {
    const offenders = tags
      .filter((tag) => /(^|\s):?loading(=|\s|$)/.test(tag.attrs) && !/(^|\s):?disabled(=|\s|$)/.test(tag.attrs))
      .map((tag) => `${tag.file}:${tag.line} <${tag.name}> has loading without disabled`)
    expect(offenders).toEqual([])
  })

  it('the themes carry the default size and an explicit height', () => {
    const config = readFileSync(join(root, 'app.config.ts'), 'utf8')
    for (const theme of ['input', 'select', 'selectMenu', 'textarea']) {
      const start = config.indexOf(`\n    ${theme}: {`)
      expect(start, `${theme} theme`).toBeGreaterThan(-1)
      const block = config.slice(start, start + 2500)
      expect(block, `${theme} default size`).toMatch(/defaultVariants:\s*\{\s*size: 'lg'/)
      expect(block, `${theme} height`).toMatch(/(min-)?h-\(--field-h\)/)
    }
  })
})
