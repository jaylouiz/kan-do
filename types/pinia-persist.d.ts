import 'pinia'
import type { PersistedStateOptions } from 'pinia-plugin-persistedstate'

declare module 'pinia' {
  export interface DefineStoreOptionsBase<_S, _Store> {
    persist?: boolean | PersistedStateOptions
  }
}
