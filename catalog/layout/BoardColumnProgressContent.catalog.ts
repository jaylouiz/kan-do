import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'BoardColumnProgressContent',
  source: 'app',
  alternatives: ['BoardColumn', 'AddTaskSlot'],
  host: 'board',
  variants: [
    { id: 'with-task', label: 'the Jetzt card', demoTasks: 'progress', props: { listId: 'catalog-progress-list', isDragging: false, taskStatus: 1 } },
  ],
  states: [
    { id: 'empty', state: 'empty', label: 'empty (the add-and-start slot)', demoTasks: 'none', props: { listId: 'catalog-progress-list-empty', isDragging: false, taskStatus: 1 } },
  ],
} satisfies CatalogEntry
