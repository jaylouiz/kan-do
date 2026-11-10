import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/mapping/PropertyMapper.vue` (the manifest). */
export default {
  component: 'PropertyMapper',
  source: 'app',
  alternatives: ['USelect', 'UFormField'],
  screen: '/settings/notion',
  variants: [{ id: 'demo', label: 'schema of a typical task database', fixture: 'notionSchema', props: { defaultMapping: { title: 'Name', status: 'Status', priority: 'Priority', dueDate: 'Due', topic: 'Topic' } } }],
  states: [],
} satisfies CatalogEntry
