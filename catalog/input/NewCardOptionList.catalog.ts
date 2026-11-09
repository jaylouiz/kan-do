import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/NewCardOptionList.vue` (the manifest). */
export default {
  component: 'NewCardOptionList',
  source: 'app',
  alternatives: ['ChoiceChip', 'UInput'],
  sampleNote:
    'its props include a label function and the step\'s source rules, and it lives in the new-card flow\'s popover or drawer; new-card-flow.spec.ts and NewCardOptionList.spec.ts exercise it (its rows are ChoiceChip `row`).',
  states: [],
} satisfies CatalogEntry
