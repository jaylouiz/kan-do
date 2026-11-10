import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/AddTargetSwitch.vue` (the manifest). */
export default {
  component: 'AddTargetSwitch',
  source: 'app',
  alternatives: ['TaskPropertySelect'],
  screen: '/tasks',
  sampleNote:
    'it reads the connected sources from useAddTarget and shows only with two or more; add-task-source.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
