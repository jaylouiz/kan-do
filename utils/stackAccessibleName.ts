/** vue-i18n's `t` (component) and `translate` (lib/i18n) both fit this shape for a plural message */
type PluralTranslate = (key: string, named: Record<string, unknown>, plural: number) => string

/**
 * The accessible name of a collapsed stack (#154): "<front title>, <group>, <n> tasks", so voice control
 * can say the visible title (WCAG 2.5.3). A front card without a title falls back to "<group>, <n> tasks"
 * instead of a name that starts with a comma. One place for the stack control and the drag announcements.
 */
export function stackAccessibleName(
  translate: PluralTranslate,
  stack: { frontTitle: string | undefined, group: string, count: number },
): string {
  const title = stack.frontTitle?.trim() ?? ''
  const key = title ? 'board.stack.label' : 'board.stack.labelUntitled'
  return translate(key, { title, group: stack.group, n: stack.count }, stack.count)
}
