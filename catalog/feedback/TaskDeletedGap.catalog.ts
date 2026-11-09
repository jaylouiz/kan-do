import type { CatalogEntry } from '../types'

const task = { id: 'catalog-gap', source: 'local', externalId: null, status: 0, title: 'Angebot für Familie Berger schreiben', activity: null, topic: null, topicColorCode: null, priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null }
const gap = { taskId: 'catalog-gap', task, fromStatus: 0, afterId: null, height: 72, state: 'open', paused: true, requestedAt: 0 }

/** Description, usage and avoid come from the doc block of `components/task/TaskDeletedGap.vue` (the manifest). The timer is paused, so the drain line stands still. */
export default {
  component: 'TaskDeletedGap',
  source: 'app',
  alternatives: ['UAlert'],
  variants: [
    { id: 'open', props: { gap } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'long German title', props: { gap: { ...gap, task: { ...task, title: 'Rückruf wegen der verspäteten Lieferung der Pflastersteine und der Rechnung vom Oktober' } } } },
    { id: 'focus', state: 'focus', props: { gap } },
  ],
} satisfies CatalogEntry
