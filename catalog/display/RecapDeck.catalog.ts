import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'RecapDeck',
  source: 'app',
  alternatives: ['TaskCard'],
  host: 'board',
  screen: '/tasks',
  variants: [
    { id: 'done', label: 'done yesterday', demoTasks: 'done', props: { kind: 'done' } },
    { id: 'undone', label: 'still open', demoTasks: 'open', props: { kind: 'undone' } },
  ],
  states: [],
} satisfies CatalogEntry
