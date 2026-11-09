import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/task/TaskTimeboxNudge.vue` (the manifest).
 * No samples: the layer shows only while the board store's `timeboxNudgeTaskId` names its task, and it sits over a
 * TaskCard; `/ui` has neither. It is exercised by `timebox-nudge.spec.ts`. Its minute chips and icon controls are ChoiceChip
 * (#72).
 */
export default {
  component: 'TaskTimeboxNudge',
  source: 'app',
  alternatives: ['UButton'],
  sampleNote:
    'the layer shows only while the board store\'s timeboxNudgeTaskId names its task and sits over a TaskCard; /ui has neither (timebox-nudge.spec.ts exercises it).',
  states: [],
} satisfies CatalogEntry
