<!--
@component ElementPickerBar
@kind component
@category overlay
@description Chrome of the feedback element picker (#227): a hover outline with a name chip around the
candidate element and a small hint bar at the bottom centre. Exists only while picking; it is not a toolbar.
@usage Mounted once in pages/tasks.vue next to FeedbackDialog. The picking itself lives in useElementPicker.
@avoid Chrome of the feedback element picker only; not a general highlight or tooltip.
@responsibility
- Outline and chip follow the candidate (`pointer-events: none`, so they never take a pick)
- The hint bar carries the keys and a cancel button; a live region announces "<Komponente>, <Selektor>"
- All picker UI is marked `data-feedback-picker`, so its own events pass the picker's capture listeners
-->
<template>
  <div v-if="active" :data-feedback-picker="''" role="region" :aria-label="t('feedback.picker.region')">
    <div
      v-if="box"
      class="pointer-events-none fixed z-50 rounded-sm ring-2 ring-primary"
      :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }"
      data-testid="element-picker-outline"
    >
      <span
        class="absolute left-0 max-w-64 truncate rounded-sm bg-primary px-1.5 py-0.5 text-xs font-medium text-inverted"
        :class="box.top < 28 ? 'top-0' : '-top-6'"
        data-testid="element-picker-chip"
      >{{ name }}</span>
    </div>

    <p class="sr-only" role="status" aria-live="polite" data-testid="element-picker-live">{{ label }}</p>

    <div
      class="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-elevated py-2 pr-2 pl-4 text-sm text-default shadow-(--shadow-overlay) ring ring-default"
      data-testid="element-picker-bar"
    >
      <span>{{ t('feedback.picker.hint') }}</span>
      <UButton color="neutral" variant="ghost" size="sm" data-testid="element-picker-cancel" @click="cancel">
        {{ t('feedback.picker.cancel') }}
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementPicker } from '~/composables/useElementPicker'
import { COMPONENT_ATTR, componentChain } from '~/lib/feedback/describeElement'

defineOptions({ name: 'ElementPickerBar' })

const { t } = useI18n()
const { active, candidate, label, cancel } = useElementPicker()

const box = ref<{ top: number, left: number, width: number, height: number } | null>(null)
// Chip = what is outlined: the component the candidate belongs to, plus the tag when it is a part inside it
// ("TaskCard · p"), so the chip and the outline never disagree.
const name = computed(() => {
  const el = candidate.value
  if (!el) return ''
  const component = componentChain(el)[0]
  const ownRoot = !!component && (el.getAttribute(COMPONENT_ATTR) ?? '').split(' ').includes(component)
  const tag = el.tagName.toLowerCase()
  return component ? (ownRoot ? component : `${component} · ${tag}`) : tag
})

// The candidate can scroll or resize under a still pointer: follow it every frame while picking.
let frame = 0
function track() {
  const rect = candidate.value?.getBoundingClientRect()
  box.value = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
  frame = requestAnimationFrame(track)
}
watch(active, (on) => {
  document.documentElement.classList.toggle('kando-picking', on)
  cancelAnimationFrame(frame)
  if (on) track()
  else box.value = null
}, { immediate: true })
onBeforeUnmount(() => {
  cancel()
  cancelAnimationFrame(frame)
  document.documentElement.classList.remove('kando-picking')
})
</script>
