/**
 * Contrast model of a Nuxt UI theme (kd#123): resolves the text and background colour tokens a colour role x variant
 * ends up with (the library's compound variants, then `app.config.ts`'s, later ones win) and computes the WCAG ratio
 * on the grounds the app paints. Same model as tests/config/button-contrast.test.ts (#97), which keeps its own copy
 * for the hover states; this one covers components whose role colours sit on one slot (`root`, `base`) at rest.
 */

import { WHITE, GROUNDS, SHEET_FILL_DEEP, rampStep, type Rgb } from './tokens'
export { WHITE, GROUNDS, rampStep, type Rgb } from './tokens'
export const ROLES = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const
export type Role = (typeof ROLES)[number]

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
      : { default: WHITE, elevated: WHITE, accented: SHEET_FILL_DEEP, inverted: rampStep(neutral, '500') }
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
