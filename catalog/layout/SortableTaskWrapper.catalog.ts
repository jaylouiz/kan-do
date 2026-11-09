import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'SortableTaskWrapper',
  source: 'app',
  alternatives: ['BoardColumnItem', 'TaskCard'],
  sampleNote: 'is a behaviour wrapper without a look: it registers the card it wraps with the drag-and-drop manager and names it for assistive tech, so it renders only around a card in a column list; BoardColumn shows it in context.',
  states: [],
} satisfies CatalogEntry
