import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'Board',
  source: 'app',
  alternatives: ['BoardColumn', 'BoardColumnProgressContent', 'TaskCard'],
  sampleNote: 'is a whole page: its root is a three-column grid that is 300vw wide on a phone with its own swipe, drag overlay, focus overlay and page-wide drag-and-drop state, so it has no inline sample. Its four columns are shown by BoardColumn (Offen, Jetzt, Wartet, Erledigt, empty and populated, from the demo board).',
  states: [],
} satisfies CatalogEntry
