import type { CatalogEntry } from '../types'

export default {
  component: 'UTable',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'display',
  description: 'A data table with sortable columns, an empty text and a loading state, built on TanStack Table.',
  usage: 'Tabular records with several comparable columns (the completed-tasks table of the Statistik page, TasksTable). Pass `data` and `columns`.',
  avoid: 'Not for a list of one-line rows with actions (ListRow) and not for layout.',
  alternatives: ['TasksTable', 'ListRow'],
  theme: 'table',
  variants: [
    { id: 'default', props: { data: [{ title: 'Angebot Müller schreiben', time: '60 min' }, { title: 'Rechnung prüfen', time: '30 min' }], columns: [{ accessorKey: 'title', header: 'Aufgabe' }, { accessorKey: 'time', header: 'Zeit' }] } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { data: [], columns: [{ accessorKey: 'title', header: 'Aufgabe' }] } },
    { id: 'loading', state: 'loading', props: { data: [], loading: true, columns: [{ accessorKey: 'title', header: 'Aufgabe' }] } },
  ],
} satisfies CatalogEntry
