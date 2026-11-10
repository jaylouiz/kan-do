import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nuxtUiAlert from '../../.nuxt/ui/alert'
import nuxtUiBadge from '../../.nuxt/ui/badge'
import { ROLES, roleContrast, type Compound } from './helpers/roleContrast'

// kd#123: every colour role x variant of UBadge and UAlert meets WCAG AA (4.5:1 text) at rest. The `/ui` matrix
// showed the roles no call site uses far below it (badge solid white 2.3 to 3.1:1, soft/subtle/outline text 1.8 to
// 2.8:1, alert soft description ~4.1:1), so no screen test could see it; the next use would have shipped below AA.
// Reads the merged theme the way `/ui` does (`.nuxt/ui/<name>.ts` plus `app.config.ts`). Light mode only.

type ThemeConfig = { compoundVariants?: Compound[], slots?: Record<string, string> }
const VARIANTS = ['solid', 'outline', 'soft', 'subtle'] as const

describe('role colour contrast of UBadge and UAlert (kd#123)', () => {
  let ui: { colors: Record<string, string>, badge: ThemeConfig, alert: ThemeConfig }

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('defineAppConfig', (config: unknown) => config)
    ui = ((await import('~/app.config')).default as unknown as { ui: typeof ui }).ui
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const failing = (rows: Array<[string, number]>) => rows.filter(([, ratio]) => ratio < 4.5).map(([label, ratio]) => `${label}: ${ratio.toFixed(2)}`)

  it('lists every variant of both themes (a new one must be added here)', () => {
    expect(Object.keys((nuxtUiBadge as unknown as { variants: { variant: object } }).variants.variant)).toEqual([...VARIANTS])
    expect(Object.keys((nuxtUiAlert as unknown as { variants: { variant: object } }).variants.variant)).toEqual([...VARIANTS])
  })

  it('UBadge: every role x variant has 4.5:1 text on every ground', () => {
    const model = roleContrast({ stock: nuxtUiBadge.compoundVariants as Compound[], app: ui.badge.compoundVariants ?? [], ramps: ui.colors, slot: 'base' })
    expect(failing(ROLES.flatMap(role => VARIANTS.flatMap(variant => model.ratios(role, variant))))).toEqual([])
  })

  it('UAlert: every role x variant has 4.5:1 text on every ground, the description included', () => {
    const model = roleContrast({ stock: nuxtUiAlert.compoundVariants as Compound[], app: ui.alert.compoundVariants ?? [], ramps: ui.colors, slot: 'root' })
    const rows = ROLES.flatMap(role => VARIANTS.flatMap((variant) => {
      // the description is `opacity-90` unless the theme sets it back to full
      const full = (ui.alert.slots?.description ?? '').split(/\s+/).includes('opacity-100') || model.slotClasses(role, variant, 'description').includes('opacity-100')
      const descriptionOpacity = full ? 1 : 0.9
      return [...model.ratios(role, variant), ...model.ratios(role, variant, descriptionOpacity).map(([label, ratio]) => [`${label} (description)`, ratio] as [string, number])]
    }))
    expect(failing(rows)).toEqual([])
  })
})
