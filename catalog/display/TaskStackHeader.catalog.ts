import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskStackHeader',
  source: 'app',
  alternatives: ['TaskStackPill'],
  variants: [
    { id: 'default', props: { groupKey: 'Angebote', label: 'Angebote', count: 3, firstTask: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: { groupKey: 'x', label: 'Baustelle Müller-Lüdenscheidt Gartenhaus', count: 12, firstTask: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
  ],
} satisfies CatalogEntry
