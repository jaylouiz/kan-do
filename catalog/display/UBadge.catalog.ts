import type { CatalogEntry } from '../types'

export default {
  component: 'UBadge',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'display',
  description: 'A small label in the semantic colour roles: soft, subtle, solid and outline variants, in five sizes (the theme sets the 11 px label step for sm).',
  usage: 'A quiet status or count next to text, such as the Standard marker on a source row: `neutral` with `soft` or `subtle`, size `sm`. A domain chip with its own look (the stack pill) stays its own component.',
  avoid: 'Not a button or a link (UButton), not a notification (UAlert) and not a task-status chip (the card footer chips are custom).',
  alternatives: ['TaskPriorityBadge', 'TaskStackPill'],
  theme: 'badge',
  matrix: { axes: ['color', 'variant', 'size'], slot: { $t: 'sources.row.default' } },
  states: [
    { id: 'long-text', state: 'long-text', props: { color: 'neutral', variant: 'subtle' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
