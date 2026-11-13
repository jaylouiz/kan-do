import type { CatalogEntry } from '../types'

/**
 * The Offen variant (`status: 0`) has no button of its own since #248: it is the draft host at the start of the list, opened by
 * the header's add button, and paints nothing while no draft is open, so it has no sample here. The Jetzt variant is the card-sized
 * add-and-start control of the empty Jetzt column (revealed on hover, so its resting sample is the focused one).
 * Description, usage and avoid come from the doc block of `components/board/AddTaskSlot.vue` (the manifest).
 */
export default {
  component: 'AddTaskSlot',
  source: 'app',
  alternatives: ['UButton'],
  variants: [
    { id: 'progress', label: 'Jetzt', props: { status: 1, label: { $t: 'task.createAdHoc' }, icon: 'i-ph-lightning' } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { status: 1, label: { $t: 'task.createAdHoc' }, icon: 'i-ph-lightning' } },
    { id: 'long-text', state: 'long-text', label: 'long German label', props: { status: 1, label: { $t: 'board.dropToComplete' }, icon: 'i-ph-lightning' } },
    { id: 'disabled', state: 'disabled', label: 'hidden during a drag (inert, invisible)', props: { status: 1, label: { $t: 'task.createAdHoc' }, icon: 'i-ph-lightning', hidden: true } },
  ],
} satisfies CatalogEntry
