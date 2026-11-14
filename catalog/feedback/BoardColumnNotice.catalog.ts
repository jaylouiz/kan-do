import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/BoardColumnNotice.vue` (the manifest). */
export default {
  component: 'BoardColumnNotice',
  source: 'app',
  alternatives: ['UAlert'],
  variants: [
    { id: 'trash', label: 'deleted card (tone trash)', props: { tone: 'trash', actionLabel: { $t: 'common.undo' } }, slot: { $t: 'trash.inTrash' } },
    { id: 'done', label: 'yesterday note (tone done)', props: { tone: 'done', actionLabel: { $t: 'board.yesterday.ack' } }, slot: { $t: 'board.yesterday.headingYesterday' } },
  ],
  states: [
    { id: 'disabled', state: 'disabled', props: { tone: 'trash', actionLabel: { $t: 'common.undo' }, actionDisabled: true }, slot: { $t: 'trash.inTrash' } },
  ],
} satisfies CatalogEntry
