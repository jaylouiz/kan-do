import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsRing',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'single', props: { segments: [{ value: 64, step: 0 }], label: '64 Prozent im Zeitfenster' } },
    { id: 'with-tick', props: { segments: [{ value: 64, step: 0 }], label: '64 Prozent im Zeitfenster', tick: 52 } },
    { id: 'split', props: { segments: [{ value: 50, step: 0 }, { value: 30, step: 3 }, { value: 20, step: 5 }], label: 'Verteilung' } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { segments: [{ value: 0, step: 0 }], label: 'Kein Wert' } },
  ],
} satisfies CatalogEntry
