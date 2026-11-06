/**
 * @module nativeMenu
 * @description The pure half of the macOS menu bar (#614): which custom menu items exist, which i18n key titles
 * every menu entry, and what each item does in the web app. The Rust half (`src-tauri/src/menu.rs`) builds the
 * menu from the labels and forwards a click as the event `menu://action`; `composables/useNativeMenu.ts` wires
 * both together. `tests/config/native-menu-contract.test.ts` keeps `MENU_ACTION_IDS` and `MENU_LABEL_KEYS` in
 * step with the Rust `MENU_ACTIONS` and `MenuLabels`.
 */

/** Event the Rust side emits for a clicked custom item; the payload is one of `MENU_ACTION_IDS`. */
export const MENU_ACTION_EVENT = 'menu://action'

/** Custom (non-predefined) items, the same ids as `MENU_ACTIONS` in `src-tauri/src/menu.rs`. */
export const MENU_ACTION_IDS = [
  'app.check-updates',
  'app.settings',
  'app.new-task',
  'app.day-close',
  'app.go-today',
  'app.go-statistics',
  'app.go-trash',
  'app.feedback',
  'app.whats-new',
] as const

export type MenuActionId = (typeof MENU_ACTION_IDS)[number]

/** One title per menu entry: the `menu.<key>` i18n key, camelCase like the Rust `MenuLabels` fields. */
export const MENU_LABEL_KEYS = [
  'app', 'about', 'checkUpdates', 'settings', 'services', 'hide', 'hideOthers', 'showAll', 'quit',
  'file', 'newTask', 'dayClose', 'closeWindow',
  'edit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'view', 'today', 'statistics', 'trash', 'fullscreen',
  'window', 'minimize', 'zoom',
  'help', 'feedback', 'whatsNew',
] as const

export type MenuLabels = Record<(typeof MENU_LABEL_KEYS)[number], string>

export function buildMenuLabels(t: (key: string) => string): MenuLabels {
  return Object.fromEntries(MENU_LABEL_KEYS.map(key => [key, t(`menu.${key}`)])) as MenuLabels
}

export function isMenuActionId(value: unknown): value is MenuActionId {
  return typeof value === 'string' && (MENU_ACTION_IDS as readonly string[]).includes(value)
}

/** What the handlers need from the app; injected so the mapping is testable without Nuxt. */
export interface MenuDeps {
  navigate: (path: string) => Promise<unknown> | unknown
  /** Runs after a navigation has rendered, so a dialog mounted by the target page exists. */
  afterRender: () => Promise<void>
  checkForUpdates: () => Promise<void> | void
  openDayClose: () => void
  openFeedback: () => void
  openWhatsNew: () => Promise<void> | void
  /** True while a modal dialog is open (the palette's rule: never a dialog on a dialog). */
  dialogOpen: () => boolean
}

/**
 * Handler per custom item. Items that open a dialog do nothing while another dialog is open. The day-close and
 * feedback dialogs are mounted by `pages/tasks.vue`, so those items go to the board first.
 */
export function menuActionHandlers(deps: MenuDeps): Record<MenuActionId, () => Promise<void>> {
  const go = (path: string) => async () => { await deps.navigate(path) }
  const dialog = (run: () => Promise<void> | void) => async () => {
    if (deps.dialogOpen()) return
    await run()
  }
  const onBoard = (open: () => void) => dialog(async () => {
    await deps.navigate('/tasks')
    await deps.afterRender()
    open()
  })
  return {
    'app.settings': go('/settings'),
    // A child route of the board: an open day-close, recap or palette dialog would stay mounted under the sheet.
    'app.new-task': dialog(async () => { await deps.navigate('/tasks/add') }),
    'app.go-today': go('/tasks'),
    'app.go-statistics': go('/statistics'),
    'app.go-trash': go('/trash'),
    'app.check-updates': dialog(() => deps.checkForUpdates()),
    'app.whats-new': dialog(() => deps.openWhatsNew()),
    'app.day-close': onBoard(deps.openDayClose),
    'app.feedback': onBoard(deps.openFeedback),
  }
}
