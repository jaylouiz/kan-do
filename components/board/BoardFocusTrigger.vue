<!--
@component BoardFocusTrigger
@kind primitive
@category navigation
@description The quiet "Fokus" funnel beside the ⋯ pill of the app bar (#161): a round, muted icon that is the only resting trace of the topic focus. Tapping it opens the topic chips (BoardFocusBar); while a focus is on it is primary, and tapping it ends the focus.
@usage Rendered by AppNav next to the ⋯ pill, on the board route only: `<BoardFocusTrigger />`. It owns no state: `useBoardFocus` does, and BoardFocusBar shows the chips and the pill.
@avoid Not a general filter button and not for another property: the focus is topic-only. Not a place for the pill or the chips, which float with the board.
@responsibility
- Absent while no card has a topic and no focus is on (nothing to focus on); never takes room from the pills (placed beside the group, so the bar does not re-centre when it appears)
- ARIA: `aria-expanded` (with `aria-controls` the chip row) while it opens the chips, `aria-pressed="true"` instead while a focus is on and it ends it; the name says which ("Fokus", "Fokus beenden: <topic>")
- Esc closes the chip row and keeps focus on the funnel
-->
<template>
  <UButton
    v-if="hasFocusJob"
    ref="button"
    icon="i-ph-funnel-simple"
    color="neutral"
    variant="ghost"
    class="board-focus-trigger"
    :class="{ 'is-on': active, 'is-open': chipsOpen && !active }"
    :aria-label="active ? t('board.focus.endNamed', { topic: focusTopic }) : t('board.focus.trigger')"
    :aria-expanded="active ? undefined : chipsOpen"
    :aria-controls="active ? undefined : 'board-focus-bar'"
    :aria-pressed="active ? true : undefined"
    data-testid="focus-trigger"
    @click="onClick"
    @keydown.esc="closeChips"
  />
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBoardFocus } from '~/composables/useBoardFocus'

defineOptions({ name: 'BoardFocusTrigger' })

const { t } = useI18n()
const { focusTopic, hasFocusJob, chipsOpen, triggerEl, clearFocus, closeChips } = useBoardFocus()
const active = computed(() => focusTopic.value !== null)

/** The button element for BoardFocusBar's Esc (focus goes back here); UButton's root element is the button */
const button = ref<{ $el?: HTMLElement } | null>(null)
watchEffect(() => { triggerEl.value = button.value?.$el ?? null })

function onClick() {
  if (active.value) clearFocus()
  else chipsOpen.value = !chipsOpen.value
}
</script>

<style scoped>
.board-focus-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--app-nav-pill-height);
  height: var(--app-nav-pill-height);
  border-radius: 9999px;
  /* Resting: a muted glyph, no surface (the nav pills are the only sheets on the bar) */
  color: var(--ui-text-muted);
  transition: color var(--duration-fast) ease, background-color var(--duration-fast) ease;
}

.board-focus-trigger:hover,
.board-focus-trigger.is-open {
  color: var(--ui-text-highlighted);
  background: var(--fill-on-canvas);
}

/* A focus is on: the primary, so the bar says the board is filtered */
.board-focus-trigger.is-on {
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.board-focus-trigger.is-on:hover {
  background: var(--ui-primary);
}

@media (prefers-reduced-motion: reduce) {
  .board-focus-trigger {
    transition: none;
  }
}
</style>
