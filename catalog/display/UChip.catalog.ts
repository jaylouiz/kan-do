import type { CatalogEntry } from '../types'

/** Nuxt UI chip (#73): the one use is the app bar's problem dot (`AppNav`). Category display, as in the audit table. */
export default {
  component: 'UChip',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'display',
  description: 'A small dot or count anchored to the corner of another element.',
  usage: 'A status dot on an icon or control (the problem dot on the app bar\'s more pill): `color: error`, a size from the scale, `inset` to sit on the corner. The wrapped element is the default slot.',
  avoid: 'Not a label or count in a row (UBadge) and not a notice (UAlert); it carries no text of its own, so the element it marks needs the accessible name.',
  alternatives: ['UBadge'],
  theme: 'chip',
  matrix: { axes: ['color', 'size'], props: { show: true, standalone: false }, slot: { $t: 'common.save' } },
  states: [],
} satisfies CatalogEntry
