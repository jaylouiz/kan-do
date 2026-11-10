import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskStack',
  source: 'app',
  alternatives: ['TaskCard', 'TaskStackHeader', 'TaskStackPill'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'topic', label: 'three tasks of one topic', fixture: 'topicStack', props: { stackKey: 'Baustelle Müller', label: 'Baustelle Müller', taskStatus: 0, sortableIndex: 0 } }],
  states: [],
} satisfies CatalogEntry
