import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'ColumnDropZone',
  source: 'app',
  alternatives: ['BoardColumn', 'SortableTaskWrapper'],
  sampleNote: 'is invisible by design (a droppable sentinel); its only visible state, the drop ghost of an empty column, appears while a card is dragged over a column and is shown in context by the drag-and-drop specs.',
  states: [],
} satisfies CatalogEntry
