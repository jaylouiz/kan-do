import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TasksTable',
  source: 'app',
  alternatives: ['UTable', 'StatsWeekTable'],
  variants: [
    { id: 'default', props: { tasks: [{ taskId: 'o1', title: 'Gartenhaus Angebot', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }, { taskId: 'o2', title: 'Rechnung Müller prüfen', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }] } },
    { id: 'no-date', props: { tasks: [{ taskId: 'o1', title: 'Gartenhaus Angebot', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }], showCompletedDate: false } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { tasks: [], emptyStateText: 'Keine Aufgaben' } },
    { id: 'long-text', state: 'long-text', props: { tasks: [{ taskId: 'o1', title: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }] } },
  ],
} satisfies CatalogEntry
