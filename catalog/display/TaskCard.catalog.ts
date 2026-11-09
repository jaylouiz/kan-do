import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskCard',
  source: 'app',
  alternatives: ['TrashEntryRow', 'UCard'],
  variants: [
    { id: 'default', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
    { id: 'waiting', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 2, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, muted: true } },
    { id: 'now', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 1, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 900, timerId: null } } },
    { id: 'done', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 3, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 3000, timerId: null } } },
    { id: 'draft', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: '', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, draft: true } },
    { id: 'readonly', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, readonly: true, preview: true } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: 'Mit Pergola', timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null } } },
    { id: 'selected', state: 'selected', label: 'drag preview', props: { task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, preview: true } },
  ],
} satisfies CatalogEntry
