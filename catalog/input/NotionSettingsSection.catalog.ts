import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/NotionSettingsSection.vue` (the manifest). */
export default {
  component: 'NotionSettingsSection',
  source: 'app',
  alternatives: ['PropertyMapper'],
  screen: '/settings/notion',
  variants: [
    { id: 'saved', label: 'nothing to save', props: { title: 'Statuszuordnung', description: 'Welche Notion-Status zu Offen, Jetzt, Wartet und Erledigt gehören.' }, slot: 'Inhalt des Abschnitts' },
    { id: 'changed', label: 'unsaved changes', props: { title: 'Statuszuordnung', hasChanges: true }, slot: 'Inhalt des Abschnitts' },
  ],
  states: [{ id: 'saving', state: 'loading', props: { title: 'Statuszuordnung', hasChanges: true, isSaving: true }, slot: 'Inhalt des Abschnitts' }],
} satisfies CatalogEntry
