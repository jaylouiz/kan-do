import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/CustomPropertiesStep.vue` (the manifest). */
export default {
  component: 'CustomPropertiesStep',
  source: 'app',
  alternatives: ['PropertyMapper'],
  screen: '/settings/notion',
  variants: [{ id: 'demo', label: 'schema of a typical task database', fixture: 'notionSchema', props: { defaultMapping: { title: 'Name', status: 'Status', priority: 'Priority', dueDate: 'Due', topic: 'Topic' } } }],
  states: [],
} satisfies CatalogEntry
