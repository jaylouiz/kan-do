import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/BoardPageDots.vue` (the manifest). A pure indicator: not focusable, no text, so no focus or long-text state applies. */
export default {
  component: 'BoardPageDots',
  source: 'app',
  alternatives: ['UTabs'],
  variants: [
    { id: 'first-page', props: { page: 0, offsetPx: 0, live: false } },
    { id: 'middle-page', props: { page: 1, offsetPx: 0, live: false } },
  ],
  states: [
    { id: 'selected', state: 'selected', props: { page: 2, offsetPx: 0, live: false } },
  ],
} satisfies CatalogEntry
