import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DataBackupList',
  source: 'app',
  alternatives: ['ListRow'],
  screen: '/settings/data',
  sampleNote: 'reads the data-folder composable (backups, restore state) of /settings/data; its rows are ListRow, shown there.',
  states: [],
} satisfies CatalogEntry
