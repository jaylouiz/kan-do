/**
 * Semantic icon map: the one place a project meaning names its icon (#67).
 *
 * Call sites bind `ICONS.<meaning>` instead of a literal icon name, so the icon style can be swapped
 * once. The Nuxt UI vocabulary (close, external, arrows, chevrons, check) lives in `app.config.ts`
 * `ui.icons`; `close` and `external` there are taken from this table so a meaning has one literal.
 * Notation is `i-ph-*` everywhere; `ph:*` appears only in `nuxt.config.ts` `icon.clientBundle.icons`.
 * Keep full string literals: the `clientBundle` scan reads this file to bundle each icon (ADR 012).
 * `tests/config/icon-map.test.ts` fails on a literal of a mapped glyph outside this file and the theme.
 *
 * Icon size is Tailwind's spacing scale, four steps: `size-3` (12px, inline status), `size-4` (16px, the default beside
 * text), `size-5` (20px, a control's own icon), `size-6` (24px, a prominent action); a redesign retunes `--spacing`
 * once (#70, `docs/design/ui-kit-audit.md` "Status after #70"). An icon at any other size is a hero or an illustration.
 *
 * Not mapped on purpose: `check` (done, apply and copied are different meanings) and the status icons
 * (already one table, `utils/taskStatusMappings.ts`); source icons live in `utils/sourceMeta.ts`.
 */
export const ICONS = {
  /** Step back (recap deck, new-card flow, board edge indicator). */
  back: 'i-ph-caret-left',
  /** Back to the previous step of a flow or to the parent route: the arrow of `BackButton` (#236). */
  stepBack: 'i-ph-arrow-left',
  /** Step forward / skip. */
  forward: 'i-ph-caret-right',
  /** "Go on" affordance of a row or CTA; a different job than stepping. */
  goOn: 'i-ph-arrow-right',
  /** Close a surface, clear a value. */
  close: 'i-ph-x',
  /** Delete, including "remove forever". */
  delete: 'i-ph-trash',
  /** Archive a task. */
  archive: 'i-ph-archive',
  /** Opens outside the app. */
  external: 'i-ph-arrow-square-out',
  /** Opens the task details inside the app. */
  openDetail: 'i-ph-corners-out',
  /** The annotator's arrow tool (a shape, not an affordance). */
  arrowTool: 'i-ph-arrow-up-right',
} as const satisfies Record<string, `i-ph-${string}`>

export type IconMeaning = keyof typeof ICONS
