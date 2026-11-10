import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailNotes.vue` (the manifest). */
export default {
  component: 'TaskDetailNotes',
  source: 'app',
  alternatives: ['UTextarea', 'InlineEditable'],
  screen: '/tasks',
  variants: [
    { id: 'markdown', label: 'notes as Markdown', props: { notes: 'Hainbuchenhecke an der Südgrenze, Staudenbeet am Sitzplatz.\n\n- Frau Müller möchte **mehr Blühfarbe im Frühjahr**\n- Pflanzliste an die Baumschule weitergeben' } },
  ],
  states: [{ id: 'empty', state: 'empty', label: 'no notes: placeholder', props: { notes: null } }],
} satisfies CatalogEntry
