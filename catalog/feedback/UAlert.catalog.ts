import type { CatalogEntry } from '../types'

/**
 * Nuxt UI alert: the one inline notice (a failure or a state inside a flow, the system notice). The matrix is read from
 * the merged theme, so the subtle `error` contrast step of `app.config.ts` shows here as well.
 */
export default {
  component: 'UAlert',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'feedback',
  description: 'The inline notice: a short message with an optional title, icon and actions in the semantic colour roles (DESIGN.md "Notices and toasts").',
  usage: '`variant="subtle"` with `color` `error` for a failure, `warning` for "needs attention", `info` for a hint, `success` for a confirmed good result, `neutral` for a quiet result. The call site sets `role` (`alert` for a failure that appears, `status` for a state) and `data-testid`; text goes into `description` (and `title` when a second line helps). A system notice with actions is `orientation="horizontal"` (DataStorageNotice).',
  avoid: 'Not for a field\'s own error (UFormField error), not for a reaction to an action that passes by (a toast, raised with `useToast`), and no hand-built tinted box or coloured `<p role="alert">` line next to it.',
  alternatives: ['DataStorageNotice', 'EmptyNote'],
  theme: 'alert',
  matrix: {
    axes: ['color', 'variant'],
    props: { icon: 'i-ph-info', description: { $t: 'settings.data.backups.loadFailed' } },
  },
  variants: [
    { id: 'failure', label: 'failure line (subtle error)', props: { color: 'error', variant: 'subtle', icon: 'i-ph-x-circle', role: 'alert', description: { $t: 'feedback.screenshot.failed' } } },
    { id: 'title-description', label: 'title and description', props: { color: 'warning', variant: 'subtle', icon: 'i-ph-warning', title: { $t: 'sync.warning.alertTitle' }, description: { $t: 'settings.data.backups.loadFailed' } } },
  ],
  states: [
    { id: 'error', state: 'error', props: { color: 'error', variant: 'subtle', icon: 'i-ph-x-circle', role: 'alert', description: { $t: 'settings.data.backups.loadFailed' } } },
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { color: 'warning', variant: 'subtle', icon: 'i-ph-warning', title: { $t: 'sync.warning.alertTitle' }, description: { $t: 'board.dropToComplete' } } },
    { id: 'actions', state: 'icon-only', label: 'with actions and close', props: { color: 'warning', variant: 'subtle', orientation: 'horizontal', icon: 'i-ph-warning', title: { $t: 'sync.warning.alertTitle' }, close: true, actions: [{ label: { $t: 'common.close' }, color: 'neutral', variant: 'outline', size: 'xs' }] } },
  ],
} satisfies CatalogEntry
