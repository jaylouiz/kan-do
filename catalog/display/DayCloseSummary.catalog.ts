import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseSummary',
  source: 'app',
  alternatives: ['StatsVerdict'],
  variants: [
    { id: 'mixed', props: { openCount: 2, totalSeconds: 8400, done: [{ id: 'cat-1', source: 'local', externalId: null, status: 3, title: 'Angebot schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 4500, timerId: null }, { id: 'cat-2', source: 'local', externalId: null, status: 3, title: 'Steuerunterlagen sortieren', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 2700, timerId: null }, { id: 'cat-3', source: 'local', externalId: null, status: 3, title: 'Rückfrage beantwortet', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null }] } },
    { id: 'all-done', props: { openCount: 0, totalSeconds: 3600, done: [{ id: 'cat-1', source: 'local', externalId: null, status: 3, title: 'Angebot schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 3600, timerId: null }] } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { openCount: 0, totalSeconds: 0, done: [] } },
  ],
} satisfies CatalogEntry
