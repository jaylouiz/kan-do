import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskSourceIcon',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'local', props: { source: 'local' } },
    { id: 'notion', props: { source: 'notion' } },
    { id: 'todoist', props: { source: 'todoist' } },
  ],
  states: [],
} satisfies CatalogEntry
