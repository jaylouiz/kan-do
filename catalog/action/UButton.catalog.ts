import type { CatalogEntry } from '../types'
import { ICONS } from '../../lib/icons.ts'

/**
 * Nuxt UI button. The matrix is read from the merged theme (`.nuxt/ui/button.ts` plus `app.config.ts`), so a colour,
 * variant or size the theme gains appears without an edit here. The button ladder (kd#177, DESIGN.md "Components"): two
 * heights, `md` 32 px (the default) and `lg` 36 px (the one main action of a surface), and four looks (solid, soft, ghost,
 * link). The theme still holds Nuxt UI's `xs`, `sm`, `xl`, `outline` and `subtle` (a theme cannot delete a key); no template uses them and the matrix (`only`) leaves them out.
 */
export default {
  component: 'UButton',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'action',
  description: 'The one button of the app: solid, soft, ghost and link looks in the semantic colour roles, in two heights (32 px, and 36 px for the one main action of a surface).',
  usage: 'Every action that is not a navigation; a text-style action inside a quiet surface is `ghost` neutral, a button that reads as a link `link`. Back and forward steps are a ghost neutral square button with `ICONS.back` / `ICONS.forward` and an `aria-label` (never a raw `<button>`). `md` is the default; the one primary action of a surface sets `size="lg"`, every other button keeps the default; soft for a neutral action that stands alone and the one main action of a row, ghost for further actions in a row, card, menu or toolbar and every icon-only button (the button ladder, DESIGN.md "Components"). Icon-only buttons set `square` and an aria-label.',
  avoid: 'Not for navigation to a page (NuxtLink, ExternalLink for outside pages) and not for a toggle that stays pressed (UCheckbox, USwitch).',
  alternatives: ['ExternalLink', 'ULink', 'UDropdownMenu'],
  theme: 'button',
  matrix: {
    axes: ['color', 'variant', 'size'],
    only: { variant: ['solid', 'soft', 'ghost', 'link'], size: ['md', 'lg'] },
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
