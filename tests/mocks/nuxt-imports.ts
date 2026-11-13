import { createApp, inject } from 'vue'
import { vi } from 'vitest'

export const toastAddMock = vi.fn()
export const toastRemoveMock = vi.fn()

// Mirrors @nuxt/ui's useToast(), which calls inject() and warns outside an injection context.
export const toastMaxInjectionKey = Symbol('nuxt-ui.toast-max')

/** What the last useToast() call resolved via inject(). */
export const injected: { toastMax: unknown } = { toastMax: undefined }

export function useToast() {
  injected.toastMax = inject(toastMaxInjectionKey, undefined)
  return {
    add: toastAddMock,
    remove: toastRemoveMock,
  }
}

const vueApp = createApp({})

export function useNuxtApp() {
  return { vueApp }
}

/** Public runtime config of the test app. The feedback relay is off unless a test sets its URL (#268). */
export const runtimeConfigMock: { public: Record<string, unknown> } = { public: { clientVersion: '9.9.9', feedbackRelayUrl: '' } }

export function useRuntimeConfig() {
  return runtimeConfigMock
}
