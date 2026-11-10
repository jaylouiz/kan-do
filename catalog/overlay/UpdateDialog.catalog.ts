import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'UpdateDialog',
  source: 'app',
  alternatives: ['WhatsNewDialog', 'UModal'],
  screen: '/settings/updates',
  sampleNote: 'is an overlay: opened, it covers the page it is shown in, so it has no inline sample. It opens from its trigger in the app; it needs the updater state.',
  states: [],
} satisfies CatalogEntry
