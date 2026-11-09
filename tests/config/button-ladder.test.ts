import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// #552 (audit U4): one button size and variant ladder (DESIGN.md "Buttons"). The theme in `app.config.ts` carries
// the default size and the 44 px phone floor; call sites set a size only to climb the ladder (`lg` for the one
// primary of a surface, `sm` for rows and cards). This test keeps the theme and the call sites from drifting.

const root = resolve(__dirname, '../..')
const FOLDERS = ['components', 'pages', 'layouts']

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Source of the app files that ship UI (prototypes and the error test page are not part of the ladder; `/ui` is, it has no buttons). */
function appFiles(): string[] {
  const files = FOLDERS.flatMap((folder) => vueFiles(join(root, folder)))
  files.push(join(root, 'app.vue'))
  return files.filter((f) => !/error-test\.vue$|\/prototype\//.test(f))
}

interface ButtonTag { file: string; line: number; attrs: string }

/** Every `<UButton ...>` open tag; quote-aware, because attribute values hold `=>` and `>` (e.g. `@click="() => x"`). */
function buttonTags(): ButtonTag[] {
  const tags: ButtonTag[] = []
  for (const path of appFiles()) {
    const text = readFileSync(path, 'utf8')
    const open = /<u-?button(?=[\s/>])/gi
    let match: RegExpExecArray | null
    while ((match = open.exec(text))) {
      let i = match.index + match[0].length
      let quote = ''
      for (; i < text.length; i++) {
        const c = text[i]!
        if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      tags.push({
        file: relative(root, path),
        line: text.slice(0, match.index).split('\n').length,
        attrs: text.slice(match.index + match[0].length, i)
      })
    }
  }
  return tags
}

const attr = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?::|v-bind:)?${name}=("[^"]*"|'[^']*')`))
  return m ? m[1]!.slice(1, -1) : null
}

const where = (t: ButtonTag) => `${t.file}:${t.line}`

/** A solid primary in these files is deliberately not an `lg` CTA; each entry says why. */
const NOT_A_CTA: Record<string, string> = {}

/** The one CTA that is not a solid primary: "Tag abschließen" is a neutral soft `lg` button (#470). */
const SOFT_CTA_TESTIDS = ['day-close-cta']

describe('button ladder: call sites (#552)', () => {
  const tags = buttonTags()

  it('finds the buttons it scans', () => {
    expect(tags.length).toBeGreaterThan(100)
  })

  it('uses no `xl` size and no `outline` variant: they left the vocabulary', () => {
    const hits = tags.filter((t) => {
      const size = attr(t.attrs, 'size')
      const variant = attr(t.attrs, 'variant')
      return size === 'xl' || (variant ?? '').includes('outline')
    })
    expect(hits.map(where)).toEqual([])
  })

  it('sets no touch-target class: the theme floor makes every button 44 px on a phone', () => {
    const hits = tags.filter((t) => /touch-target/.test(t.attrs))
    expect(hits.map(where)).toEqual([])
  })

  it('names `md` nowhere: it is the default size', () => {
    const hits = tags.filter((t) => attr(t.attrs, 'size') === 'md')
    expect(hits.map(where)).toEqual([])
  })

  it('keeps `xs` for controls inside text or with their own hit area', () => {
    const allowed = ['components/feedback/FeedbackDialog.vue', 'components/task/TaskStackHeader.vue']
    const hits = tags.filter((t) => attr(t.attrs, 'size') === 'xs' && !allowed.includes(t.file))
    expect(hits.map(where)).toEqual([])
  })

  it('makes every solid primary or solid error button `lg`, the one CTA of its surface', () => {
    const hits = tags.filter((t) => {
      if (NOT_A_CTA[t.file]) return false
      // A bound prop is read as its source text: a footer action falls back to `?? 'primary'` / `?? 'solid'`, the
      // disconnect confirm has a solid branch. Both count, so a ternary cannot hide a CTA from the ladder.
      const variant = attr(t.attrs, 'variant')
      const color = attr(t.attrs, 'color') ?? 'primary'
      const solid = variant === null || /(^|')solid('|$)/.test(variant)
      const primary = /(^|')(primary|error)('|$)/.test(color)
      // A bound size counts when its source names `lg` (the disconnect confirm climbs only in its solid branch)
      return solid && primary && !/(^|')lg('|$)/.test(attr(t.attrs, 'size') ?? '')
    })
    expect(hits.map(where)).toEqual([])
  })

  it('has the soft CTA of the board at `lg` too', () => {
    for (const id of SOFT_CTA_TESTIDS) {
      const tag = tags.find((t) => attr(t.attrs, 'data-testid') === id)
      expect(tag, id).toBeDefined()
      expect(attr(tag!.attrs, 'size'), id).toBe('lg')
    }
  })
})

describe('button ladder: theme (#552)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  async function theme() {
    vi.stubGlobal('defineAppConfig', (config: unknown) => config)
    const { default: config } = await import('~/app.config')
    return (config as unknown as { ui: { button: ButtonTheme } }).ui.button
  }

  interface ButtonTheme {
    defaultVariants?: { size?: string }
    slots?: { base?: string | string[] }
    variants?: { size?: Record<string, { base?: string } | undefined> }
    compoundVariants?: Array<{ size?: string; square?: boolean; class?: string }>
  }

  const base = (t: ButtonTheme) => [t.slots?.base ?? []].flat().join(' ')

  it('pins `md` as the default size', async () => {
    expect((await theme()).defaultVariants?.size).toBe('md')
  })

  it('floors every button at 44 px on a phone', async () => {
    expect(base(await theme())).toContain('max-md:min-h-11')
  })

  it('lifts `lg` to 48 px on a phone', async () => {
    expect((await theme()).variants?.size?.lg?.base).toContain('max-md:min-h-12')
  })

  it('leaves `xs` without a floor', async () => {
    const xs = (await theme()).compoundVariants?.find((c) => c.size === 'xs')
    expect(xs?.class).toContain('max-md:min-h-0')
  })

  it('makes icon-only buttons 44 px wide on a phone', async () => {
    const square = (await theme()).compoundVariants?.find((c) => c.square === true)
    expect(square?.class).toContain('max-md:min-w-11')
  })
})
