import type { CatalogEntry } from '../types'

const steps = [
  { key: 'token', label: { $t: 'notion.modal.steps.token' } },
  { key: 'database', label: { $t: 'notion.modal.steps.database' } },
  { key: 'mapping', label: { $t: 'notion.modal.steps.mapping' } },
]
const shared = { steps, label: { $t: 'notion.modal.stepsLabel' }, doneLabel: { $t: 'notion.modal.stepDone' } }

/** Description, usage and avoid come from the doc block of `components/setup/SetupRail.vue` (the manifest). */
export default {
  component: 'SetupRail',
  source: 'app',
  alternatives: ['UTabs'],
  variants: [
    { id: 'first', props: { ...shared, current: 0 } },
    { id: 'middle', props: { ...shared, current: 1 } },
  ],
  states: [
    { id: 'selected', state: 'selected', props: { ...shared, current: 2 } },
    {
      id: 'long-text',
      state: 'long-text',
      props: { ...shared, current: 1, steps: [{ key: 'custom-properties', label: { $t: 'notion.modal.steps.customProperties' } }, { key: 'priority-mapping', label: { $t: 'notion.modal.steps.priority' } }] },
    },
  ],
} satisfies CatalogEntry
