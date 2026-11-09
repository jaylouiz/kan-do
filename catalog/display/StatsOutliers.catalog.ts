import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsOutliers',
  source: 'app',
  alternatives: ['ListRow'],
  variants: [
    { id: 'default', props: { outliers: [{ record: { taskId: 'o1', title: 'Gartenhaus Angebot', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }, overSeconds: 1800 }, { record: { taskId: 'o2', title: 'Rechnung Müller prüfen', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }, overSeconds: 900 }] } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { outliers: [] } },
    { id: 'long-text', state: 'long-text', props: { outliers: [{ record: { taskId: 'o1', title: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', completedAt: '2026-11-05T10:00:00.000Z', timeBoxSeconds: 1800, actualTimeSpentSeconds: 3600, estimationAccuracy: 200, topic: 'Angebote', topicColorCode: null, activity: 'Planung', isUnplanned: false }, overSeconds: 1800 }] } },
  ],
} satisfies CatalogEntry
