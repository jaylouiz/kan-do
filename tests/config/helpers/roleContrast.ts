import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Contrast model of a Nuxt UI theme (kd#123): resolves the text and background colour tokens a colour role x variant
 * ends up with (the library's compound variants, then `app.config.ts`'s, later ones win) and computes the WCAG ratio
 * on the grounds the app paints. Same model as tests/config/button-contrast.test.ts (#97), which keeps its own copy
 * for the hover states; this one covers components whose role colours sit on one slot (`root`, `base`) at rest.
 */

const root = resolve(__dirname, '../../..')
const mainCss = readFileSync(resolve(root, 'assets/css/main.css'), 'utf8')
const tailwindCss = readFileSync(resolve(root, 'node_modules/tailwindcss/theme.css'), 'utf8')

export type Rgb = [number, number, number]
export const WHITE: Rgb = [255, 255, 255]
/** The grounds a component sits on: the white sheet, the fill inside a sheet (`--ui-bg-muted`) and the paper canvas (`--ui-page-bg`). */
export const GROUNDS: Array<[string, Rgb]> = [
  ['white', WHITE],
  ['sheet fill #f6f3ed', [246, 243, 237]],
  ['paper #f3efe6', [243, 239, 230]],
]
export const ROLES = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const
export type Role = (typeof ROLES)[number]

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
  if (hex) return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
  const ok = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (ok) return oklchToRgb(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]))
  throw new Error(`unsupported colour: ${value}`)
}

/** `--color-<ramp>-<step>`: the project's own palettes from main.css, the others from Tailwind's theme. */
export function rampStep(ramp: string, step: string): Rgb {
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

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Browser alpha compositing happens on the gamma-encoded channels. */
export function over(fg: Rgb, alpha: number, ground: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + ground[i]! * (1 - alpha)) as Rgb
}

export interface Compound { color?: string, variant?: string, class?: string | string[] | Record<string, string | string[]> }

const classesOf = (value: Compound['class'], slot: string): string[] => {
  const picked = typeof value === 'object' && !Array.isArray(value) ? value?.[slot] : value
  return [picked ?? ''].flat().join(' ').split(/\s+/).filter(Boolean)
}

/**
 * `ratios(role, variant)` for one theme: the rest-state text of `slot` against its own fill on every ground.
 * `textOpacity` is a further opacity on the text (UAlert's description is `opacity-90` unless the theme resets it).
 */
export function roleContrast(options: { stock: Compound[], app: Compound[], ramps: Record<string, string>, slot: string }) {
  const { stock, app, ramps, slot } = options

  function token(kind: 'text' | 'bg', name: string): Rgb {
    const neutral = ramps.neutral!
    const semantic: Record<string, Rgb> = kind === 'text'
      ? { inverted: WHITE, default: rampStep(neutral, '900'), highlighted: rampStep(neutral, '900') }
      : { default: WHITE, elevated: WHITE, accented: [240, 236, 228], inverted: rampStep(neutral, '500') }
    if (semantic[name]) return semantic[name]
    const [color, step] = name.split(/-(?=\d+$)/) as [Role, string | undefined]
    if (!(ROLES as readonly string[]).includes(color)) throw new Error(`unknown colour token "${kind}-${name}"`)
    return rampStep(ramps[color]!, step ?? '500')
  }

  function slotClasses(role: Role, variant: string, of: string = slot): string[] {
    return [...stock, ...app].filter(c => c.color === role && c.variant === variant).flatMap(c => classesOf(c.class, of))
  }

  function ratios(role: Role, variant: string, textOpacity = 1): Array<[string, number]> {
    let text: string | undefined
    let bg: string | undefined
    for (const cls of slotClasses(role, variant)) {
      if (cls.includes(':')) continue
      if (/^text-(?!(?:xs|sm|base|lg|xl|label|\d|\[)\b)/.test(cls)) text = cls.slice('text-'.length)
      else if (cls.startsWith('bg-')) bg = cls.slice('bg-'.length)
    }
    if (!text) throw new Error(`${role}/${variant}: no text colour resolved`)
    const [textBase, textPct] = text.split('/')
    const fg = token('text', textBase!)
    return GROUNDS.map(([name, ground]) => {
      let fill = ground
      if (bg) {
        const [base, pct] = bg.split('/')
        fill = over(token('bg', base!), pct ? Number(pct) / 100 : 1, ground)
      }
      return [`${role}/${variant} on ${name}`, contrast(over(fg, (textPct ? Number(textPct) / 100 : 1) * textOpacity, fill), fill)]
    })
  }

  return { ratios, slotClasses }
}
