import type { CatalogEntry } from '../types'
import { ICONS } from '../../lib/icons.ts'

/**
 * Nuxt UI button. The matrix is read from the merged theme (`.nuxt/ui/button.ts` plus `app.config.ts`), so a colour,
 * variant or size the theme gains appears without an edit here. The button ladder (md default, lg for the one primary,
 * sm in rows, xs in text) is DESIGN.md "Components".
 */
export default {
  component: 'UButton',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'action',
  description: 'The one button of the app: solid, outline, soft, subtle, ghost and link variants in the semantic colour roles, in five sizes.',
  usage: 'Every action that is not a navigation; a text-style action inside a quiet surface is `ghost` neutral, a button that reads as a link `link`. Back and forward steps are a ghost neutral square button with `ICONS.back` / `ICONS.forward` and an `aria-label` (never a raw `<button>`). `md` is the default; the one primary action of a surface sets `size="lg"`, rows and cards use `sm`, `xs` only sits inside text (the button ladder, DESIGN.md "Components"). Icon-only buttons set `square` and an aria-label.',
  avoid: 'Not for navigation to a page (NuxtLink, ExternalLink for outside pages) and not for a toggle that stays pressed (UCheckbox, USwitch).',
  alternatives: ['ExternalLink', 'ULink', 'UDropdownMenu'],
  theme: 'button',
  matrix: {
    axes: ['color', 'variant', 'size'],
    slot: { $t: 'common.save' },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true }, slot: { $t: 'common.save' } },
    { id: 'loading', state: 'loading', props: { loading: true }, slot: { $t: 'common.save' } },
    { id: 'focus', state: 'focus', slot: { $t: 'common.save' } },
    { id: 'icon-only', state: 'icon-only', props: { icon: ICONS.close, square: true, 'aria-label': { $t: 'common.close' }, variant: 'ghost', color: 'neutral' } },
    // The step control recipe (#71, audit "Back and forward"): ghost, neutral, square, the semantic icon pair, always labelled. #73 applies it at the call sites.
    { id: 'step-back', state: 'icon-only', label: 'step control: back', props: { icon: ICONS.back, square: true, 'aria-label': { $t: 'board.quickAdd.back' }, variant: 'ghost', color: 'neutral' } },
    { id: 'step-forward', state: 'icon-only', label: 'step control: forward', props: { icon: ICONS.forward, square: true, 'aria-label': { $t: 'board.quickAdd.skip' }, variant: 'ghost', color: 'neutral' } },
    { id: 'block', state: 'long-text', label: 'block with long German label', props: { block: true, variant: 'soft', color: 'neutral' }, slot: { $t: 'board.dropToComplete' } },
    { id: 'icon-leading', state: 'long-text', label: 'long German label with icon', props: { icon: 'i-ph-warning' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
