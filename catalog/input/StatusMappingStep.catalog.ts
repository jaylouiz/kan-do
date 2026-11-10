import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/StatusMappingStep.vue` (the manifest). */
export default {
  component: 'StatusMappingStep',
  source: 'app',
  alternatives: ['USelect'],
  screen: '/settings/notion',
  variants: [
    { id: 'empty', fixture: 'notionSchema', props: { statusPropertyName: 'Status' } },
    { id: 'mapped', label: 'mapped', fixture: 'notionSchema', props: { statusPropertyName: 'Status', defaultMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting', archive: 'Archived' } } },
  ],
  states: [],
} satisfies CatalogEntry
