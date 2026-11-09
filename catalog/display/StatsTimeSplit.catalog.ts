import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTimeSplit',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'topic-chart', props: { split: { taskCount: 8, seconds: 14400, unplannedShare: 20, byTopic: [{ key: 'Angebote', seconds: 7200, count: 3, share: 50 }, { key: 'Personal', seconds: 4320, count: 3, share: 30 }, { key: 'Fuhrpark', seconds: 2880, count: 2, share: 20 }], byActivity: [{ key: 'Planung', seconds: 9000, count: 4, share: 62 }, { key: 'Büro', seconds: 5400, count: 4, share: 38 }] }, by: 'topic' } },
    { id: 'activity-rows', props: { split: { taskCount: 8, seconds: 14400, unplannedShare: 20, byTopic: [{ key: 'Angebote', seconds: 7200, count: 3, share: 50 }, { key: 'Personal', seconds: 4320, count: 3, share: 30 }, { key: 'Fuhrpark', seconds: 2880, count: 2, share: 20 }], byActivity: [{ key: 'Planung', seconds: 9000, count: 4, share: 62 }, { key: 'Büro', seconds: 5400, count: 4, share: 38 }] }, by: 'activity', mode: 'rows' } },
    { id: 'stacked', props: { split: { taskCount: 8, seconds: 14400, unplannedShare: 20, byTopic: [{ key: 'Angebote', seconds: 7200, count: 3, share: 50 }, { key: 'Personal', seconds: 4320, count: 3, share: 30 }, { key: 'Fuhrpark', seconds: 2880, count: 2, share: 20 }], byActivity: [{ key: 'Planung', seconds: 9000, count: 4, share: 62 }, { key: 'Büro', seconds: 5400, count: 4, share: 38 }] }, by: 'topic', stacked: true } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { split: { taskCount: 0, seconds: 0, unplannedShare: 20, byTopic: [], byActivity: [] }, by: 'topic' } },
  ],
} satisfies CatalogEntry
