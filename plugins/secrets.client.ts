/**
 * @module secrets
 * @description Desktop only: loads the Notion and Todoist tokens from the Keychain before mount, so
 * `isConfigured` is right on the first render (no flash of the welcome route), and migrates tokens that
 * older builds stored in localStorage. Web: no-op. See lib/secretsBootstrap.ts and ADR 007.
 */
import { bootstrapSecrets, type BootstrapResult } from '~/lib/secretsBootstrap'
import { withoutPersistence } from '~/lib/dataStorage'
import { omitFromStorage, SECRET_STATE_LOCATIONS } from '~/lib/secrets'
import { translate } from '~/lib/i18n'
import { useSecrets } from '~/composables/useSecrets'
import { useKeychainStatus } from '~/composables/useKeychainStatus'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useBoardStore } from '~/store/board'

export default defineNuxtPlugin({
  name: 'secrets',
  dependsOn: ['i18n-locale'],
  async setup(nuxtApp) {
    const secrets = useSecrets()
    if (!secrets.available) return

    // Pinia is active here: plugins/pinia.ts runs first (alphabetical order).
    const notionConfig = useNotionConfigStore()
    const board = useBoardStore()

    let result: Pick<BootstrapResult, 'failed' | 'unavailable'>
    try {
      result = await bootstrapSecrets({
        secrets,
        storage: window.localStorage,
        // The start-up apply is not an edit: keep it out of the data file so an offline launch is not
        // counted as edited (#255 N1). Runs before mount, so no user edit can fall inside the window.
        applyToken: (entry, token) => withoutPersistence(() => {
          if (entry === 'notion-token') {
            if (notionConfig.config) notionConfig.config = { ...notionConfig.config, token }
          } else {
            board.setTodoistApiToken(token)
          }
        }),
      })
    } catch {
      // Fail closed (#245 N4): the bootstrap guards each entry itself, so this is a last resort. Arm every
      // omission so no token reaches persisted state, and boot; the legacy copy stays for the next start.
      SECRET_STATE_LOCATIONS.forEach(omitFromStorage)
      result = { failed: true, unavailable: SECRET_STATE_LOCATIONS.map(l => l.entry) }
    }

    useKeychainStatus().setUnavailable(result.unavailable)

    if (result.failed) {
      // One calm notice per start; the toast needs the mounted app.
      nuxtApp.hook('app:mounted', () => {
        nuxtApp.vueApp.runWithContext(() => {
          useToast().add({
            title: translate('secrets.unavailableTitle'),
            description: translate('secrets.unavailableBody'),
            color: 'warning',
            icon: 'i-ph-key',
            duration: 8000,
          })
        })
      })
    }
  },
})
