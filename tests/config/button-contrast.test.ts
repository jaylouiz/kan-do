import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import nuxtUiButton from '../../.nuxt/ui/button'

// #97: every colour role x variant of UButton meets WCAG AA (4.5:1 text) at rest, and a solid fill also on
// hover/press. The `/ui` matrix showed `secondary`, `success`, `info`, `warning` (and error ghost/subtle/link) far
// below it, while the app renders none of them on a button, so no screen test could see it. This test reads the merged
// theme (Nuxt UI's `.nuxt/ui/button.ts` plus `app.config.ts`, the way the `/ui` catalog does) and the colour ramps
// (`assets/css/main.css`, Tailwind's theme), and fails when a role or variant added or changed later drops below AA.
// Disabled states are exempt (WCAG 1.4.3). Light mode only, like the design checks.

const root = resolve(__dirname, '../..')
const mainCss = readFileSync(resolve(root, 'assets/css/main.css'), 'utf8')
const tailwindCss = readFileSync(resolve(root, 'node_modules/tailwindcss/theme.css'), 'utf8')

type Rgb = [number, number, number]

const WHITE: Rgb = [255, 255, 255]
/** The grounds a button sits on: the white sheet, the fill inside a sheet (`--ui-bg-muted`) and the paper canvas (`--ui-page-bg`, neutral-100). */
const GROUNDS: Array<[string, Rgb]> = [
  ['white', WHITE],
  ['sheet fill #f6f3ed', [246, 243, 237]],
  ['paper #f3efe6', [243, 239, 230]],
]

function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180
  const a = Math.cos(h) * c
  const b = Math.sin(h) * c
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const enc = (v: number) => {
    const x = Math.min(1, Math.max(0, v))
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
  }
  return [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!)]
}

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
  const ok = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (ok) return oklchToRgb(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]))
  throw new Error(`unsupported colour: ${value}`)
}

/** `--color-<ramp>-<step>` declarations of the project's own palettes first, Tailwind's default theme second. */
function rampStep(ramp: string, step: string): Rgb {
  const source = ramp.startsWith('custom-') ? mainCss : tailwindCss
  const value = source.match(new RegExp(`--color-${ramp}-${step}:\\s*([^;]+);`))?.[1]?.trim()
  if (!value) throw new Error(`ramp ${ramp}-${step} not found`)
  return parseColor(value)
}

function luminance([r, g, b]: Rgb): number {
  const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Browser alpha compositing happens on the gamma-encoded channels. */
function over(fg: Rgb, alpha: number, ground: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + ground[i]! * (1 - alpha)) as Rgb
}

/** The fills that sit on the canvas (`assets/css/main.css`): the shadow colour at 7 % and at 13 % over whatever lies below. */
const SHADOW_COLOR: Rgb = [70, 48, 20]
const FILLS_ON_CANVAS: Record<string, number> = { '(--fill-on-canvas)': 0.07, '(--fill-on-canvas-hover)': 0.13 }

const COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const
const VARIANTS = ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link'] as const
type Role = (typeof COLORS)[number]

interface Compound { color?: string; variant?: string; class?: string }
interface Theme { compoundVariants?: Compound[] }

describe('button colour contrast (#97)', () => {
  let ramps: Record<string, string>
  let appCompounds: Compound[]

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('defineAppConfig', (config: unknown) => config)
    const { default: config } = await import('~/app.config')
    const ui = (config as unknown as { ui: { colors: Record<string, string>; button: Theme } }).ui
    ramps = ui.colors
    appCompounds = ui.button.compoundVariants ?? []
  })
  afterEach(() => { vi.unstubAllGlobals() })

  /** A semantic token or a role step as an RGB: `inverted`, `elevated`, `warning`, `success-700`. Text and background tokens of the same name differ (`text-inverted` is white, `bg-inverted` the neutral-500 of `--ui-bg-inverted`). */
  function token(kind: 'text' | 'bg', name: string, role: Role): Rgb {
    const neutral = ramps.neutral!
    const semantic: Record<string, Rgb> = kind === 'text'
      ? {
        inverted: WHITE,
        default: rampStep(neutral, '900'),
        highlighted: rampStep(neutral, '900'),
        muted: rampStep(neutral, '600'),
        toned: rampStep(neutral, '700'),
        dimmed: rampStep(neutral, '400'),
      }
      : {
        default: WHITE,
        elevated: WHITE,
        accented: [240, 236, 228],
        inverted: rampStep(neutral, '500'),
      }
    if (semantic[name]) return semantic[name]
    const [color, step] = name.split(/-(?=\d+$)/) as [Role, string | undefined]
    if (!(COLORS as readonly string[]).includes(color)) throw new Error(`unknown colour token "${kind}-${name}" on ${role}`)
    return rampStep(ramps[color]!, step ?? '500')
  }

  /** The colour tokens that apply in one state: `rest` takes the unprefixed ones, `hover` lets `hover:`/`active:` and then `enabled:hover:`/`enabled:active:` override. */
  function resolve(role: Role, variant: string, state: 'rest' | 'hover') {
    const classes = [...(nuxtUiButton.compoundVariants as Compound[]), ...appCompounds]
      .filter((c) => c.color === role && c.variant === variant)
      .flatMap((c) => (c.class ?? '').split(/\s+/).filter(Boolean))
    const prefixes = state === 'rest' ? [''] : ['', 'hover:', 'active:', 'enabled:hover:', 'enabled:active:']
    let text: string | undefined
    let bg: string | undefined
    for (const prefix of prefixes) {
      for (const cls of classes) {
        if (!cls.startsWith(prefix) || cls.slice(prefix.length).includes(':')) continue
        const bare = cls.slice(prefix.length)
        if (/^text-(?!(?:xs|sm|base|lg|xl|\d)\b)/.test(bare)) text = bare.slice('text-'.length)
        else if (bare.startsWith('bg-')) bg = bare.slice('bg-'.length)
      }
    }
    return { text, bg }
  }

  function ratios(role: Role, variant: string, state: 'rest' | 'hover'): Array<[string, number]> {
    const { text, bg } = resolve(role, variant, state)
    if (!text) throw new Error(`${role}/${variant}: no text colour resolved`)
    const [textBase, textPct] = text.split('/')
    const fg = token('text', textBase!, role)
    return GROUNDS.map(([name, ground]) => {
      let fill = ground
      if (bg && FILLS_ON_CANVAS[bg]) {
        fill = over(SHADOW_COLOR, FILLS_ON_CANVAS[bg], ground)
      } else if (bg) {
        const [base, pct] = bg.split('/')
        fill = over(token('bg', base!, role), pct ? Number(pct) / 100 : 1, ground)
      }
      return [`${role}/${variant}/${state} on ${name}`, contrast(over(fg, textPct ? Number(textPct) / 100 : 1, fill), fill)]
    })
  }

  it('lists every colour role and variant of the theme (a new one must be added here)', () => {
    const theme = nuxtUiButton as unknown as { variants: { color: object; variant: object } }
    expect(Object.keys(theme.variants.color)).toEqual([...COLORS])
    expect(Object.keys(theme.variants.variant)).toEqual([...VARIANTS])
  })

  it('every role x variant has 4.5:1 text at rest on every ground', () => {
    const failing = COLORS.flatMap((role) => VARIANTS.flatMap((variant) => ratios(role, variant, 'rest')))
      .filter(([, ratio]) => ratio < 4.5)
      .map(([label, ratio]) => `${label}: ${ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('every role x variant keeps 4.5:1 on hover and press (WCAG 1.4.3 applies to the hover state of text, kd#124)', () => {
    const failing = COLORS.flatMap((role) => VARIANTS.flatMap((variant) => ratios(role, variant, 'hover')))
      .filter(([, ratio]) => ratio < 4.5)
      .map(([label, ratio]) => `${label}: ${ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('no button compound overrides the focus ring: every button shows Nuxt UI\'s halo (DESIGN.md "Focus")', () => {
    // The owner chose the soft halo (3px, 25% of the role colour, no offset) over a solid 3:1 ring on 2026-11-11;
    // the earlier contrast check on the ring colour went with that decision. One ring: no variant brings its own.
    const overriding = appCompounds
      .filter((c) => (c.class ?? '').split(/\s+/).some((name) => name.startsWith('focus-visible:outline-')))
      .map((c) => `${c.color}/${c.variant}`)
    expect(overriding).toEqual([])
  })

  it('measures what the /ui detector found: the stock secondary solid is far below AA', () => {
    // Sanity of the model: Nuxt UI's own warning/secondary solid (orange-500, white text) is the 3.1:1 of the issue.
    const stock = contrast(WHITE, rampStep('custom-orange', '500'))
    expect(stock).toBeGreaterThan(3.0)
    expect(stock).toBeLessThan(3.2)
  })
})
