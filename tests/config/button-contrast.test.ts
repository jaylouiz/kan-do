import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nuxtUiButton from '../../.nuxt/ui/button'

// #97: every colour role x variant of UButton meets WCAG AA (4.5:1 text) at rest, and a solid fill also on
// hover/press. The `/ui` matrix showed `secondary`, `success`, `info`, `warning` (and error ghost/subtle/link) far
// below it, while the app renders none of them on a button, so no screen test could see it. This test reads the merged
// theme (Nuxt UI's `.nuxt/ui/button.ts` plus `app.config.ts`, the way the `/ui` catalog does) and the colour ramps
// (`assets/css/main.css`, Tailwind's theme) and the grounds, shadow colour and fill alphas from the tokens in `main.css` (kd#194), and fails when a role or variant added or changed later drops below AA.
// Disabled states are exempt (WCAG 1.4.3). Light mode only, like the design checks.

import { FILLS_ON_CANVAS, GROUNDS, SHADOW_COLOR, SHEET_FILL_DEEP, WHITE, rampStep, type Rgb } from './helpers/tokens'

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
        accented: SHEET_FILL_DEEP,
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

  it('no button compound overrides the focus ring: every button shows Nuxt UI\'s halo (DESIGN.md "States")', () => {
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
