import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'ResponsiveOverlay',
  source: 'app',
  alternatives: ['UModal', 'UDrawer', 'USlideover'],
  sampleNote: 'is the one overlay shell (modal or slideover from 768 px, bottom drawer below): opened, it covers the page it is shown in, so it has no inline sample. Its hosts are DayCloseDialog and TaskSheet.',
  states: [],
} satisfies CatalogEntry
