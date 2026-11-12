<!--
@component BoardFocusBar
@kind compound
@category layout
@description The two things the topic focus shows on the board (#161): the chip row to pick a topic (each with its card count) and, while a focus is on, the pill "Fokus: <topic> · n ausgeblendet" with its ✕. Never both at once, and nothing at rest.
@usage `<BoardFocusBar />` once in Board.vue, before the columns; it reads `useBoardFocus` and is opened by BoardFocusTrigger.
@avoid Not a filter toolbar: one property (topic), one row, shown only on demand. The pill is a status, not a control bar; its ✕ is the only control.
@responsibility
- Desktop: a centred row at the top of the board that takes its height only while a chip row or the pill shows, so it never covers a column heading or a card; phone: floats centred above the app bar (like the bar itself, over the page's bottom padding)
- The chip row scrolls sideways when the topics do not fit; a chip is a ChoiceChip, the topic shortened in the middle (MiddleEllipsis); Esc closes it (focus stays on the funnel, BoardFocusTrigger)
- The pill is a polite status region, so the hidden number is read out when it changes; ✕ is named "Fokus beenden"
- Task text (the topic name) is private: `data-private`
-->
<template>
  <div
    v-if="showsRow || showsPill"
    id="board-focus-bar"
    class="board-focus-bar"
    data-testid="focus-bar"
  >
    <div
      v-if="showsRow"
      class="board-focus-bar__row"
      role="group"
      :aria-label="t('board.focus.chips')"
      data-testid="focus-chips"
      @keydown.esc="closeChips"
    >
      <ChoiceChip
        v-for="choice in topicChoices"
        :key="choice.topic"
        :aria-label="t('board.focus.chip', { topic: choice.topic, n: choice.count }, choice.count)"
        data-testid="focus-chip"
        @click="setFocus(choice.topic)"
      >
        <MiddleEllipsis :text="choice.topic" data-private />
        <span class="board-focus-bar__count" aria-hidden="true">{{ choice.count }}</span>
      </ChoiceChip>
    </div>
    <div v-else-if="focusTopic !== null" class="board-focus-bar__pill" data-testid="focus-pill">
      <p class="board-focus-bar__text" role="status" aria-live="polite" data-testid="focus-pill-text">
        {{ t('board.focus.pillLead') }} <span class="board-focus-bar__topic" data-private>{{ focusTopic }}</span> · {{ t('board.focus.hidden', { n: hiddenCount }) }}
      </p>
      <UButton
        icon="i-ph-x-bold"
        color="neutral"
        variant="ghost"
        class="board-focus-bar__end"
        :ui="{ leadingIcon: 'size-3.5' }"
        :aria-label="t('board.focus.end')"
        data-testid="focus-end"
        @click="clearFocus"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ChoiceChip from '~/components/ui/ChoiceChip.vue'
import MiddleEllipsis from '~/components/ui/MiddleEllipsis.vue'
import { useBoardFocus } from '~/composables/useBoardFocus'

defineOptions({ name: 'BoardFocusBar' })

const { t } = useI18n()
const { focusTopic, topicChoices, hiddenCount, chipsOpen, setFocus, clearFocus, closeChips } = useBoardFocus()

const showsRow = computed(() => chipsOpen.value && focusTopic.value === null && topicChoices.value.length > 0)
const showsPill = computed(() => focusTopic.value !== null)
</script>

<style scoped>
.board-focus-bar {
  display: flex;
  justify-content: center;
  padding: 0.5rem 1rem 0.25rem;
  min-width: 0;
}

.board-focus-bar__row {
  display: flex;
  gap: 0.375rem;
  max-width: 100%;
  /* Many topics: the row scrolls sideways */
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0.125rem;
}

.board-focus-bar__row::-webkit-scrollbar {
  display: none;
}

.board-focus-bar__count {
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
}

/* The pill: the answer chip's primary wash, so it reads as the state of the control that made it */
.board-focus-bar__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  height: var(--field-h);
  padding: 0 0.25rem 0 0.875rem;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
  color: var(--ui-primary);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}

.board-focus-bar__text {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-focus-bar__topic {
  font-weight: 600;
}

.board-focus-bar__end {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  color: var(--ui-primary);
  transition: background-color var(--duration-fast) ease;
}

.board-focus-bar__end:hover {
  background: color-mix(in oklab, var(--ui-primary) 18%, transparent);
}

/* Phone: over the page's bottom padding, centred above the floating app bar */
@media (--phone) {
  .board-focus-bar {
    position: fixed;
    inset: auto 0 calc(var(--phone-bar-offset) + 0.25rem) 0;
    z-index: var(--z-bar);
    padding: 0 0.75rem;
    pointer-events: none;
  }

  .board-focus-bar__row,
  .board-focus-bar__pill {
    pointer-events: auto;
  }

  .board-focus-bar__row {
    background: var(--ui-bg);
    border-radius: 9999px;
    box-shadow: var(--shadow-nav-pill);
    padding: 0.25rem;
  }

  .board-focus-bar__pill {
    background: color-mix(in oklab, var(--ui-primary) 10%, var(--ui-bg));
    box-shadow: var(--shadow-nav-pill);
  }

  .board-focus-bar__end {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .board-focus-bar__end {
    transition: none;
  }
}
</style>
