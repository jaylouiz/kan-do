import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TopicEditorHost',
  source: 'app',
  alternatives: ['UDrawer'],
  screen: '/settings/topics',
  sampleNote: 'has no inline sample: on a phone it is a bottom drawer that covers the page, from 768 px an inline panel beside the board. It opens from its trigger in the app; it hosts the topic editor and needs the topic store.',
  states: [],
} satisfies CatalogEntry
