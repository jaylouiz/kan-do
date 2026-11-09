import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). Statuses: Offen 0, Jetzt 1, Wartet 2, Erledigt 3. */
export default {
  component: 'BoardColumn',
  source: 'app',
  alternatives: ['BoardColumnProgressContent', 'ColumnDropZone', 'TaskStack'],
  host: 'board',
  variants: [
    { id: 'open', label: 'Offen, grouped by topic', demoTasks: 'open', props: { taskStatus: 0, isDragging: false, staticMode: true, groupingEnabled: true, groupingKey: 'topic' } },
    { id: 'progress', label: 'Jetzt', demoTasks: 'progress', props: { taskStatus: 1, isDragging: false, staticMode: true } },
    { id: 'waiting', label: 'Wartet', demoTasks: 'waiting', props: { taskStatus: 2, isDragging: false, staticMode: true } },
    { id: 'done', label: 'Erledigt', demoTasks: 'done', props: { taskStatus: 3, isDragging: false, staticMode: true } },
  ],
  states: [
    { id: 'empty-open', state: 'empty', label: 'Offen, empty', demoTasks: 'none', props: { taskStatus: 0, isDragging: false, staticMode: true } },
    { id: 'empty-progress', state: 'empty', label: 'Jetzt, empty', demoTasks: 'none', props: { taskStatus: 1, isDragging: false, staticMode: true } },
    { id: 'empty-done', state: 'empty', label: 'Erledigt, empty', demoTasks: 'none', props: { taskStatus: 3, isDragging: false, staticMode: true } },
    { id: 'muted', state: 'disabled', label: 'muted (another column holds the focus)', demoTasks: 'waiting', props: { taskStatus: 2, isDragging: false, staticMode: true, muteOthers: true } },
  ],
} satisfies CatalogEntry
