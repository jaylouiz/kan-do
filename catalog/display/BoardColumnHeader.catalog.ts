import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'BoardColumnHeader',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 's0', props: { title: 'Offen', status: 0, taskCount: 4 } },
    { id: 's0-add', label: 'Offen with the add button', props: { title: 'Offen', status: 0, taskCount: 4, showAdd: true } },
    { id: 's1', props: { title: 'Jetzt', status: 1, taskCount: 1 } },
    { id: 's2', props: { title: 'Wartet', status: 2, taskCount: 3 } },
    { id: 's3', props: { title: 'Erledigt', status: 3, taskCount: 5 } },
  ],
  states: [
    { id: 'disabled', state: 'disabled', label: 'add button while a draft is open', props: { title: 'Offen', status: 0, taskCount: 4, showAdd: true, addDisabled: true } },
    { id: 'empty', state: 'empty', props: { title: 'Offen', status: 0, taskCount: 0, isEmpty: true } },
  ],
} satisfies CatalogEntry
