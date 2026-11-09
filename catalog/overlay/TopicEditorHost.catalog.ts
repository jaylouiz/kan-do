import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TopicEditorHost',
  source: 'app',
  alternatives: ['UDrawer'],
  sampleNote: 'is an overlay: opened, it covers the page it is shown in, so it has no inline sample. It opens from its trigger in the app; it hosts the topic editor and needs the topic store.',
  states: [],
} satisfies CatalogEntry
