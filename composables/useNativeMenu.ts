/**
 * @composable useNativeMenu
 * @description The macOS menu bar of the desktop app (#614). Sends the translated labels to the Rust command
 * `menu_install` (once the locale is resolved, again when it changes) and runs the app action behind a clicked
 * custom item, which Rust forwards as the event `menu://action`. The pure mapping lives in `lib/nativeMenu.ts`.
 * @responsibility
 * - Web: a no-op (no Tauri, no menu)
 * - Listens before it installs, so no click can be missed
 * - Reuses the actions of the command palette (`useAppUpdater`, `useDayClose`, `useFeedback`, `useWhatsNew`)
 */
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import { isTauri } from '~/utils/isTauri'
import { buildMenuLabels, isMenuActionId, menuActionHandlers, MENU_ACTION_EVENT } from '~/lib/nativeMenu'
import { useAppUpdater } from '~/composables/useAppUpdater'
import { useDayClose } from '~/composables/useDayClose'
import { useFeedback } from '~/composables/useFeedback'
import { useWhatsNew } from '~/composables/useWhatsNew'

export function useNativeMenu(): void {
  if (!isTauri()) return

  const { t, locale } = useI18n()
  const appUpdater = useAppUpdater()
  const dayClose = useDayClose()
  const feedback = useFeedback()
  const whatsNew = useWhatsNew()

  const handlers = menuActionHandlers({
    navigate: path => navigateTo(path),
    afterRender: () => nextTick(),
    checkForUpdates: () => appUpdater.checkManually(),
    openDayClose: dayClose.open,
    openFeedback: feedback.open,
    openWhatsNew: () => whatsNew.openReopen(),
    dialogOpen: () => !!document.querySelector('[role="dialog"]'),
  })

  async function install(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('menu_install', { labels: buildMenuLabels(key => t(key)) })
    } catch (error) {
      // The default menu stays; nothing the user can act on.
      if (import.meta.dev) console.warn('[menu] install failed:', error)
    }
  }

  let unlisten: (() => void) | null = null
  let unmounted = false

  onMounted(async () => {
    const { listen } = await import('@tauri-apps/api/event')
    const off = await listen<string>(MENU_ACTION_EVENT, (event) => {
      if (isMenuActionId(event.payload)) void handlers[event.payload]()
    })
    if (unmounted) off()
    else unlisten = off
    await install()
  })

  watch(locale, () => { void install() })

  onBeforeUnmount(() => {
    unmounted = true
    unlisten?.()
  })
}
