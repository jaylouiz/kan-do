import type { CatalogEntry } from '../types'

export default {
  component: 'UBadge',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'display',
  description: 'A small label in the semantic colour roles: a neutral soft look in one size (12 px text, 20 px high; kd#180). The theme still holds the other Nuxt UI sizes and variants; no template uses them and the matrix leaves them out.',
  usage: 'A quiet status or count next to text, such as the Standard marker on a source row: `neutral` `soft`, the default size. A domain chip with its own look (the stack pill) stays its own component.',
  avoid: 'Not a button or a link (UButton), not a notification (UAlert) and not a task-status chip (the card footer chips are custom).',
  alternatives: ['TaskPriorityBadge', 'TaskStackPill'],
  theme: 'badge',
  matrix: { axes: ['color', 'variant', 'size'], only: { variant: ['soft'], size: ['md'] }, slot: { $t: 'sources.row.default' } },
  states: [
    { id: 'long-text', state: 'long-text', props: { color: 'neutral', variant: 'soft' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
