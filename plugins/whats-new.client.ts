/**
 * @module whats-new
 * @description Desktop only: after start-up, shows a toast "Aktualisiert auf Version X" when the version
 * changed since the last-seen one (#226, #390), once per start, never during onboarding. Its button opens
 * the Highlights of every version in between.
 * Web: no-op. See composables/useWhatsNew.ts.
 */
import { isTauri } from '~/utils/isTauri'
import { useWhatsNew } from '~/composables/useWhatsNew'

export default defineNuxtPlugin({
  name: 'whats-new',
  dependsOn: ['secrets'],
  setup(nuxtApp) {
    if (!isTauri()) return
    nuxtApp.hook('app:mounted', () => {
      void nuxtApp.vueApp.runWithContext(() => {
        const router = useRouter()
        return useWhatsNew().checkAfterUpdate(() => router.currentRoute.value.path.startsWith('/welcome'))
      })
    })
  },
})
