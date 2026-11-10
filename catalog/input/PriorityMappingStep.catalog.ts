import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/PriorityMappingStep.vue` (the manifest). */
export default {
  component: 'PriorityMappingStep',
  source: 'app',
  alternatives: ['USelectMenu'],
  screen: '/settings/notion',
  variants: [
    { id: 'empty', fixture: 'notionSchema', props: { priorityPropertyName: 'Priority' } },
    { id: 'mapped', label: 'mapped', fixture: 'notionSchema', props: { priorityPropertyName: 'Priority', defaultMapping: { high: ['Urgent', 'High'], regular: ['Medium'], low: ['Low'] } } },
  ],
  states: [],
} satisfies CatalogEntry
