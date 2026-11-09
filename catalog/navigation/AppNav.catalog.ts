import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/nav/AppNav.vue` (the manifest).
 * No samples: the block reads the route, the app-nav composable, the sync and settings stores and teleports its
 * panel; `/ui` has none of them. `app-nav.spec.ts` covers selected state, `aria-current` and the more panel.
 */
export default {
  component: 'AppNav',
  source: 'app',
  alternatives: ['MorePanel', 'UTabs'],
  sampleNote:
    'the block reads the route, useAppNav, the sync and settings stores and opens the more panel in a popover; /ui has none of them (app-nav.spec.ts exercises selected, open and the problem dot).',
  states: [],
} satisfies CatalogEntry
