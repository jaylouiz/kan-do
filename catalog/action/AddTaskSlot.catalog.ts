import type { CatalogEntry } from '../types'

/**
 * The Jetzt variant (`status: 1`) is an overlay of the empty Jetzt column (BoardColumnProgressContent) and paints nothing
 * on its own, so it has no sample here. Description, usage and avoid come from the doc block of `components/board/AddTaskSlot.vue` (the manifest).
 */
export default {
  component: 'AddTaskSlot',
  source: 'app',
  alternatives: ['UButton'],
  variants: [
    { id: 'open', label: 'Offen', props: { status: 0, label: { $t: 'board.addTask' } } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { status: 0, label: { $t: 'board.addTask' } } },
    { id: 'long-text', state: 'long-text', label: 'long German label', props: { status: 0, label: { $t: 'board.dropToComplete' } } },
    { id: 'disabled', state: 'disabled', label: 'hidden during a drag (inert, invisible)', props: { status: 0, label: { $t: 'board.addTask' }, hidden: true } },
  ],
} satisfies CatalogEntry
