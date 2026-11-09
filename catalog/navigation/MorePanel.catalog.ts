import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/nav/MorePanel.vue` (the manifest).
 * No samples: the panel reads the board, sources and sync stores and lives inside the app bar's popover;
 * `/ui` has neither. `app-nav.spec.ts` covers it.
 */
export default {
  component: 'MorePanel',
  source: 'app',
  alternatives: ['AppNav', 'SettingsSubpageLink'],
  sampleNote:
    'the panel reads the board, sources and sync stores and sits inside the app bar\'s popover; /ui has neither (app-nav.spec.ts exercises it).',
  states: [],
} satisfies CatalogEntry
