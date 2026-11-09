import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseTaskRow',
  source: 'app',
  alternatives: ['ListRow'],
  variants: [
    { id: 'default', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
    { id: 'waiting', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 2, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
  ],
} satisfies CatalogEntry
