/**
 * Shared modal width scale.
 *
 * Nuxt UI v4's UModal has no `size` prop, so `AppDialog` (`components/ui/AppDialog.vue`) applies the named
 * width from its own `size` prop; `ResponsiveOverlay` call sites pass one through `desktopUi`. Do not add
 * ad-hoc max-width classes (see DESIGN.md, Dialogs).
 *
 * - sm: confirmations and one-field prompts (reset, sync warning, timebox)
 * - md: settings and simple forms (mode settings, local setup)
 * - lg: wide content (integration setup wizard, task detail, statistics)
 *
 * The classes are `sm:`-prefixed: below 640px every modal is full width
 * minus the 1rem gutter (`w-[calc(100vw-2rem)]` from the Nuxt UI base).
 */
export const MODAL_WIDTH = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
} as const;

export type ModalWidth = keyof typeof MODAL_WIDTH;

/**
 * Width of the task sheet (USlideover on desktop). One named step, no ad-hoc
 * max-width classes. Below 768px the sheet is a bottom UDrawer and ignores it.
 */
export const SHEET_WIDTH = 'md:max-w-xl';
