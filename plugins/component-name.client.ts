/**
 * @module component-name
 * @description Marks the root element of every component with its `defineOptions` name in
 * `data-component` (#227), so the feedback element picker can report component names. The marker
 * exists because `el.__vueParentComponent` is absent in production builds. Desktop and dev only:
 * web production builds are untouched. Nested components sharing one root element append their
 * names, innermost first (`TaskCard BoardColumnItem`).
 */
import { COMPONENT_ATTR } from '~/lib/feedback/describeElement'
import { isTauri } from '~/utils/isTauri'

export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) return
  if (!isTauri() && !import.meta.dev) return

  // Idempotent, and also on `updated`: a root element swapped by v-if/v-else loses its marker otherwise.
  function mark(instance: { $options: { name?: string }, $el: unknown }) {
    const name = instance.$options.name
    const el = instance.$el
    if (!name || !(el instanceof Element)) return
    const names = el.getAttribute(COMPONENT_ATTR)?.split(' ') ?? []
    if (!names.includes(name)) el.setAttribute(COMPONENT_ATTR, [...names, name].join(' '))
  }

  nuxtApp.vueApp.mixin({
    mounted() { mark(this) },
    updated() { mark(this) },
  })
})
