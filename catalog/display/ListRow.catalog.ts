import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'ListRow',
  source: 'app',
  alternatives: ['SourceRow', 'TasksTable'],
  variants: [
    { id: 'static-roomy', props: { density: 'roomy' }, slot: { $t: 'sources.row.default' } },
    { id: 'static-compact', props: { density: 'compact' }, slot: { $t: 'sources.row.default' } },
    { id: 'action', props: { action: true }, slot: { $t: 'common.save' } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { action: true }, slot: { $t: 'common.save' } },
    { id: 'long-text', state: 'long-text', props: { action: true }, slot: { $t: 'board.dropToComplete' } },
    { id: 'selected', state: 'selected', props: { action: true, expanded: true }, slot: { $t: 'common.save' } },
  ],
} satisfies CatalogEntry
