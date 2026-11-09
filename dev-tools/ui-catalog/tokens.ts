/**
 * Token catalog of the `/ui` Tokens part (#65): turns the real stylesheets and the app config into the groups the page
 * lists. Nothing here is typed in by hand: a token appears when a scanned source defines it, with the file and line of
 * the definition (a later source overrides an earlier one, the earlier definition is kept as `replaces`).
 *
 * Sources, in override order: Tailwind's theme (breakpoints, type, radius, shadow, easing; its colour palette is
 * deliberately skipped, the app uses the role ramps below), Nuxt UI's runtime CSS, then `assets/css/*`.
 */
import { BREAKPOINT_QUERIES } from '../../lib/breakpoints'
import { scanDeclarations, type CssDeclaration } from './cssScan'

export type TokenGroupId = 'colors' | 'typography' | 'radius' | 'shadows' | 'spacing' | 'zIndex' | 'motion' | 'breakpoints' | 'iconSizes' | 'other'

export interface TokenSource {
  /** Label shown as "defined in", e.g. `assets/css/main.css`. */
  file: string
  css: string
  /** Tailwind's own theme: only the listed token families are taken (see `TAILWIND_FAMILIES`). */
  vendor?: 'tailwind'
}

export interface ResponsiveValue {
  when: string
  value: string
  file: string
  line: number
}

export interface Token {
  name: string
  value: string
  file: string
  line: number
  note: string
  group: TokenGroupId
  /** Values under a media query, e.g. the mobile `--task-note-height`. */
  responsive: ResponsiveValue[]
  /** The earlier definition this one overrides (Tailwind or Nuxt UI default), if any. */
  replaces: { value: string, file: string } | null
}

export interface TokenCatalog {
  tokens: Token[]
  /** `z-index` declarations with a literal value: the local stacking (20 and below) that stays a number; layers are `--z-*` tokens (#70). */
  zIndexLiterals: CssDeclaration[]
  /** Custom properties set on a component selector (not on `:root`): local, not listed as tokens. */
  scopedCount: number
}

const TAILWIND_FAMILIES = /^--(breakpoint-|font-|text-|leading-|tracking-|radius-|shadow-|drop-shadow-|inset-shadow-|ease-|animate-|container-|default-transition-|spacing$)/
const ROOT_SELECTORS = new Set([':root', ':host', 'html', '.light'])

/** Which group a custom property belongs to. By name first; the value decides for the app's own tokens. */
export function groupOf(name: string, value: string): TokenGroupId {
  if (/^--(color-|ui-(text|bg|border|chart|page-bg)|ui-primary)/.test(name)) return 'colors'
  if (/^--breakpoint-/.test(name)) return 'breakpoints'
  if (/^--z-/.test(name)) return 'zIndex'
  if (/(^--icon-|-icon-size|^--ui-icon)/.test(name)) return 'iconSizes'
  if (/^--(ui-radius$|radius-)|-radius$/.test(name)) return 'radius'
  if (/^--(shadow|drop-shadow|inset-shadow)-/.test(name)) return 'shadows'
  if (/^--(font-|text-|leading-|tracking-|lh-)/.test(name)) return 'typography'
  if (/(duration|easing|^--ease-|^--animate-|^--nav-move$|^--nav-ease$|^--default-transition)/.test(name)) return 'motion'
  if (/^(#|oklch\(|oklab\(|rgba?\(|hsla?\(|color-mix\(|var\(--(ui-color|color)-)/.test(value)) return 'colors'
  if (/^--(spacing$|container-|ui-(header-height|container))/.test(name)) return 'spacing'
  if (/^[-+]?[\d.]+(px|rem|em|%|vh|vw|dvh)$/.test(value) || /^(calc|min|max|clamp)\(.*\)$/.test(value)) return 'spacing'
  return 'other'
}

/** The media preludes as a reader wants them: `@media (--phone)` as the query it stands for (lib/breakpoints.ts, #70). */
const whenOf = (media: string[]) => media.join(' and ').replace(/\(--(\w+)\)/g, (match, name: string) => (BREAKPOINT_QUERIES as Record<string, string>)[name] ?? match)

type Placement = { kind: 'root' } | { kind: 'media', when: string } | { kind: 'scoped' } | { kind: 'skip' }

/** Where a declaration applies: on the root (a token), under a media query on the root (a responsive value), on a component selector, or in a dark/other scope that does not count. */
function placement(decl: CssDeclaration): Placement {
  const media = decl.context.filter(c => /^@(media|supports|container)\b/.test(c))
  const selectors = decl.context.filter(c => !/^@/.test(c))
  const own = selectors.at(-1)
  if (own === undefined) {
    // `@theme` and bare `@layer` blocks put their declarations on the root
    return media.length ? { kind: 'media', when: whenOf(media) } : { kind: 'root' }
  }
  if (own.split(',').some(s => s.trim() === '.dark')) return { kind: 'skip' }
  const onRoot = own.split(',').every(s => ROOT_SELECTORS.has(s.trim()))
  if (!onRoot) return { kind: 'scoped' }
  return media.length ? { kind: 'media', when: whenOf(media) } : { kind: 'root' }
}

/** Reads every source and returns the catalog. */
export function buildTokenCatalog(sources: TokenSource[]): TokenCatalog {
  const byName = new Map<string, Token>()
  const zIndexLiterals: CssDeclaration[] = []
  let scopedCount = 0

  for (const source of sources) {
    for (const decl of scanDeclarations(source.css, source.file)) {
      if (decl.prop === 'z-index') {
        if (!source.vendor && /^-?\d+$/.test(decl.value)) zIndexLiterals.push(decl)
        continue
      }
      if (!decl.prop.startsWith('--')) continue
      if (source.vendor === 'tailwind' && !TAILWIND_FAMILIES.test(decl.prop)) continue
      const place = placement(decl)
      if (place.kind === 'skip') continue
      if (place.kind === 'scoped') {
        scopedCount++
        continue
      }
      if (place.kind === 'media') continue // attached below, once every base definition is known
      const before = byName.get(decl.prop)
      byName.set(decl.prop, {
        name: decl.prop,
        value: decl.value,
        file: decl.file,
        line: decl.line,
        note: decl.note,
        group: groupOf(decl.prop, decl.value),
        responsive: [],
        replaces: before ? { value: before.value, file: before.file } : null,
      })
    }
  }

  for (const source of sources) {
    for (const decl of scanDeclarations(source.css, source.file)) {
      if (!decl.prop.startsWith('--')) continue
      const place = placement(decl)
      const token = byName.get(decl.prop)
      if (place.kind !== 'media' || !token) continue
      token.responsive.push({ when: place.when, value: decl.value, file: decl.file, line: decl.line })
    }
  }

  return { tokens: [...byName.values()], zIndexLiterals, scopedCount }
}

/** A colour ramp: `--color-custom-ink-50 ... -950` under one name. */
export interface Ramp {
  name: string
  steps: Token[]
}

/** Splits `--color-<ramp>-<step>` tokens into ramps (the app's own palettes); `rest` is every other colour token. */
export function splitRamps(colors: Token[]): { ramps: Ramp[], rest: Token[] } {
  const ramps = new Map<string, Token[]>()
  const rest: Token[] = []
  for (const token of colors) {
    const match = /^--color-(.+)-(\d{2,3})$/.exec(token.name)
    if (match) ramps.set(match[1]!, [...(ramps.get(match[1]!) ?? []), token])
    else rest.push(token)
  }
  return { ramps: [...ramps].map(([name, steps]) => ({ name, steps })), rest }
}

/** What the Tokens part reads from `useAppConfig().ui` (the values of `app.config.ts`). */
export interface AppConfigSummary {
  colorRoles: { role: string, palette: string }[]
  radius: { key: string, value: string }[]
  components: { name: string, defaultVariants: string, slots: string[], variants: string[] }[]
}

const NOT_COMPONENTS = new Set(['colors', 'radius', 'icons', 'fonts', 'prefix', 'colorMode', 'theme'])

export function summarizeAppConfig(ui: Record<string, unknown>): AppConfigSummary {
  const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {})
  const components = Object.entries(ui)
    .filter(([key, value]) => !NOT_COMPONENTS.has(key) && ['slots', 'variants', 'defaultVariants', 'compoundVariants'].some(k => k in object(value)))
    .map(([name, value]) => {
      const config = object(value)
      return {
        name,
        defaultVariants: Object.entries(object(config.defaultVariants)).map(([k, v]) => `${k}: ${String(v)}`).join(', '),
        slots: Object.keys(object(config.slots)),
        variants: Object.keys(object(config.variants)),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    colorRoles: Object.entries(object(ui.colors)).map(([role, palette]) => ({ role, palette: String(palette) })),
    radius: Object.entries(object(ui.radius)).map(([key, value]) => ({ key, value: String(value) })),
    components,
  }
}
