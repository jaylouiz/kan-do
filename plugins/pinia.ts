import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { appStorage } from '~/lib/dataStorage'

export default defineNuxtPlugin({
  name: 'pinia',
  // plugins/00.data-storage.client.ts (enforce: 'pre') runs first and fills the synchronous mirror before
  // the first store hydrates (#222). No `dependsOn`: this plugin also builds for the server, where the
  // client-only data-storage plugin does not exist (Nuxt warns NUXT_B2012).
  setup(nuxtApp) {
    const pinia = createPinia()
    // appStorage resolves its backend per call: the data file on desktop, localStorage on web.
    pinia.use(createPersistedState({ storage: appStorage }))

    nuxtApp.vueApp.use(pinia)

    // Optionally expose pinia instance if needed outside of setup
    nuxtApp.provide('pinia', pinia)

    if (import.meta.dev) {
      console.debug('[plugins/pinia] Pinia initialized with persistedstate plugin')
    }
  },
})
