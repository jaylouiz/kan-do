import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'MiddleEllipsis',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'fits', label: 'a name that fits', props: { text: 'Karriere' } },
    { id: 'long', label: 'cut in the middle', props: { text: 'Karriere: Weiterbildung', class: 'w-28' } },
    { id: 'long-sibling', label: 'a name with the same beginning', props: { text: 'Karriere: Bewerbung', class: 'w-28' } },
  ],
  states: [],
} satisfies CatalogEntry
