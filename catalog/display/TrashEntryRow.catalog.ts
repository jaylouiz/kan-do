import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TrashEntryRow',
  source: 'app',
  alternatives: ['TaskCard', 'ListRow'],
  variants: [
    { id: 'default', props: { entry: { taskId: 'cat-1', task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, deletedAt: 1762650000000, fromStatus: 0, carryOver: null } } },
    { id: 'forever', props: { forever: true, entry: { taskId: 'cat-1', task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot Müller schreiben', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, deletedAt: 1762650000000, fromStatus: 2, carryOver: null } } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: { forever: true, entry: { taskId: 'cat-1', task: { id: 'cat-1', source: 'local', externalId: null, status: 0, title: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', activity: 'Planung', topic: 'Angebote', topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 3600, timeSpentSeconds: 0, timerId: null }, deletedAt: 1762650000000, fromStatus: 1, carryOver: null } } },
  ],
} satisfies CatalogEntry
