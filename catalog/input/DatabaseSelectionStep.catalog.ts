import type { CatalogEntry } from '../types'

const databases = [
  { id: 'db-1', title: 'Aufgaben', dataSources: [{ id: 'ds-1', name: 'Aufgaben', databaseId: 'db-1', databaseTitle: 'Aufgaben' }] },
  { id: 'db-2', title: 'Projekte', dataSources: [{ id: 'ds-2', name: 'Projekte', databaseId: 'db-2', databaseTitle: 'Projekte' }] },
]

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/DatabaseSelectionStep.vue` (the manifest). */
export default {
  component: 'DatabaseSelectionStep',
  source: 'app',
  alternatives: ['USelect'],
  screen: '/settings/notion',
  variants: [{ id: 'selected', label: 'two databases, one selected', props: { databases, selectedDatabase: 'db-1', selectedDataSource: 'ds-1' } }],
  states: [
    { id: 'loading', state: 'loading', props: { databases: [], selectedDatabase: '', selectedDataSource: '', loading: true } },
    { id: 'error', state: 'error', props: { databases: [], selectedDatabase: '', selectedDataSource: '', error: 'Die Datenbanken konnten nicht geladen werden.' } },
  ],
} satisfies CatalogEntry
