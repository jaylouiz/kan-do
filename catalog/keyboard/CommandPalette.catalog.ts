import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/CommandPalette.vue` (the manifest).
 * No samples: it opens over the board from Cmd/Ctrl+K, reads the task store and the focused card, and runs commands
 * through useCommandPalette; `/ui` has none of them. `command-palette.spec.ts` covers empty, loading and the hints.
 */
export default {
  component: 'CommandPalette',
  source: 'app',
  alternatives: ['UCommandPalette', 'UKbd'],
  sampleNote:
    'it opens from Cmd/Ctrl+K over the board and reads the task store and the focused card; /ui has neither (command-palette.spec.ts exercises empty, loading and the hints).',
  states: [],
} satisfies CatalogEntry
