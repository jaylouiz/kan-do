import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'SectionHeader',
  source: 'app',
  alternatives: ['PageHeader'],
  variants: [
    { id: 'default', props: { text: { $t: 'task.field.notes' } } },
    { id: 'h3', label: 'tag h3 (a section inside a form or sheet)', props: { text: { $t: 'task.field.properties' }, tag: 'h3' } },
    { id: 'h2', label: 'tag h2', props: { text: { $t: 'task.field.properties' }, tag: 'h2' } },
    { id: 'icon', label: 'with icon', props: { text: { $t: 'task.field.properties' }, tag: 'h3', icon: 'i-ph-sliders' } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { text: { $t: 'board.dropToComplete' }, tag: 'h3', icon: 'i-ph-sliders' } },
  ],
} satisfies CatalogEntry
