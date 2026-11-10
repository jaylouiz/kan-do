import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). Each sample opens the dialog in one named width. */
export default {
  component: 'AppDialog',
  source: 'app',
  alternatives: ['ResponsiveOverlay', 'UModal', 'UDrawer'],
  launch: 'open',
  variants: [
    { id: 'sm', label: 'sm: confirmation', props: { size: 'sm', title: { $t: 'sync.warning.title' }, description: { $t: 'whatsNew.description' } } },
    { id: 'md', label: 'md (default): form', props: { title: { $t: 'settings.data.modal.title' }, description: { $t: 'whatsNew.description' } } },
    { id: 'lg', label: 'lg: wide content', props: { size: 'lg', title: { $t: 'whatsNew.title' }, description: { $t: 'whatsNew.description' } } },
  ],
  states: [
    { id: 'hidden-description', state: 'open', label: 'description for screen readers only', props: { size: 'sm', hideDescription: true, title: { $t: 'whatsNew.title' }, description: { $t: 'whatsNew.description' } } },
  ],
} satisfies CatalogEntry
