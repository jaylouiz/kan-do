/**
 * @module data-storage
 * @description Desktop only: loads `kan-do-data.json` into the synchronous mirror before Pinia is
 * created, so no store hydrates empty because the load was still pending (#222, ADR 008). Web: no-op.
 * The `00.` prefix and `enforce: 'pre'` put it ahead of plugins/pinia.ts.
 */
import { initDataStorage } from '~/lib/dataStorage'

export default defineNuxtPlugin({
  name: 'data-storage',
  enforce: 'pre',
  async setup() {
    await initDataStorage()
  },
})
