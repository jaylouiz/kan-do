import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDetailMetadata',
  source: 'app',
  alternatives: ['UCollapsible'],
  variants: [
    { id: 'local', props: { createdAt: '9. Nov. 2026', taskId: 'cat-1' } },
    { id: 'notion', props: { source: 'Notion', createdAt: '9. Nov. 2026', taskId: 'cat-1' } },
    { id: 'pinned', props: { source: 'Notion', createdAt: '9. Nov. 2026', taskId: 'cat-1', pinned: true } },
  ],
  states: [],
} satisfies CatalogEntry
