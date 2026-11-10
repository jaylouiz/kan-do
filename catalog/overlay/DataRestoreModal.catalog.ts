import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). The request's `run` of the sample replaces nothing. */
export default {
  component: 'DataRestoreModal',
  source: 'app',
  alternatives: ['DataConflictModal', 'UModal'],
  launch: 'open',
  screen: '/settings/data',
  variants: [{ id: 'backup', label: 'restore a backup', fixture: 'restoreRequest' }],
  states: [],
} satisfies CatalogEntry
