import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskSheet',
  source: 'app',
  alternatives: ['ResponsiveOverlay', 'TaskDetailModal'],
  launch: 'open',
  screen: '/tasks',
  variants: [{ id: 'add', label: 'add-task sheet with a title', props: { title: 'Neue Aufgabe' }, slot: 'Inhalt des Blatts' }],
  states: [],
} satisfies CatalogEntry
