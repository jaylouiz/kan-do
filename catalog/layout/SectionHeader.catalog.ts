import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). The five roles of the closed list (kd#180). */
export default {
  component: 'SectionHeader',
  source: 'app',
  alternatives: ['PageHeader'],
  variants: [
    { id: 'headline', label: 'headline, 22 px (the default)', props: { text: { $t: 'task.field.notes' }, tag: 'h2' } },
    { id: 'sub', label: 'sub, 18 px', props: { text: { $t: 'task.field.properties' }, tag: 'h3', size: 'sub' } },
    { id: 'display', label: 'display, 36 px', props: { text: { $t: 'task.field.notes' }, tag: 'h2', size: 'display' } },
    { id: 'hero', label: 'hero, 48 px (36 on a phone)', props: { text: { $t: 'task.field.notes' }, tag: 'h2', size: 'hero' } },
    { id: 'label', label: 'label, 12 px (a field group of the task sheet)', props: { text: { $t: 'task.field.properties' }, tag: 'h3', size: 'label' } },
    { id: 'label-icon', label: 'label with icon', props: { text: { $t: 'task.field.properties' }, tag: 'h3', size: 'label', icon: 'i-ph-sliders' } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { text: { $t: 'board.dropToComplete' }, tag: 'h3', size: 'sub' } },
  ],
} satisfies CatalogEntry
