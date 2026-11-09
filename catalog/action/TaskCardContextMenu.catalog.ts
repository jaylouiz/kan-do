import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/task/TaskCardContextMenu.vue` (the manifest).
 * No samples: it wraps a TaskCard and opens on right-click or a long press, and its items act on a task of the store.
 * `UContextMenu` itself joins `/ui` with the Overlay slice (#75).
 */
export default {
  component: 'TaskCardContextMenu',
  source: 'app',
  alternatives: ['UDropdownMenu'],
  noSamples:
    'it wraps a TaskCard and opens on right-click or a long press, and its items act on a task of the store. UContextMenu itself joins /ui with the Overlay slice (#75).',
  states: [],
} satisfies CatalogEntry
