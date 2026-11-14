import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskCardContextMenu',
  source: 'app',
  alternatives: ['UContextMenu', 'UDropdownMenu'],
  screen: '/tasks',
  sampleNote: 'opens on right-click of a task card or its corner button on touch, so it has no inline sample (it wraps TaskCard and the board actions).',
  states: [],
} satisfies CatalogEntry
