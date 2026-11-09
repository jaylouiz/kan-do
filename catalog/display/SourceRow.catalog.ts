import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'SourceRow',
  source: 'app',
  alternatives: ['ListRow'],
  variants: [
    { id: 'default-source', props: { row: { id: 'local', name: 'Lokal', icon: 'i-ph-hard-drives', isDefault: true, statusText: 'Bereit', statusTone: 'muted', canSetDefault: false, canRepair: false, repairNeedsCredentials: false, canConfigure: false } } },
    { id: 'integration', props: { row: { id: 'notion', name: 'Notion', icon: 'i-ph-notion-logo', isDefault: false, statusText: 'Verbunden', statusTone: 'muted', canSetDefault: true, canRepair: false, repairNeedsCredentials: false, canConfigure: true } } },
  ],
  states: [
    { id: 'error', state: 'error', label: 'warning status with repair', props: { row: { id: 'notion', name: 'Notion', icon: 'i-ph-notion-logo', isDefault: false, statusText: 'Verbindung prüfen', statusTone: 'warning', canSetDefault: true, canRepair: true, repairNeedsCredentials: true, canConfigure: true } } },
    { id: 'long-text', state: 'long-text', props: { row: { id: 'notion', name: 'Notion-Arbeitsbereich der Gartenbau Müller-Lüdenscheidt GmbH', icon: 'i-ph-notion-logo', isDefault: false, statusText: 'Zuletzt synchronisiert vor 3 Minuten, 2 Änderungen warten auf den Upload', statusTone: 'muted', canSetDefault: true, canRepair: false, repairNeedsCredentials: false, canConfigure: true } } },
  ],
} satisfies CatalogEntry
