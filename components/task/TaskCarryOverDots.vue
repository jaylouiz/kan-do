<!--
@component TaskCarryOverDots
@description Carried-over marker (#99): one small dot per board day, shown from day 2 (#121).
@usage <TaskCarryOverDots :day="displayDay" /> in the TaskCard footer; renders nothing on day 1 (and below).
`decorative` next to text that already names the count (task sheet).
@responsibility
- Shows up to CARRY_OVER_DOT_CAP dots; only past the cap a "+" and the muted numeral follow (#584; never in decorative mode)
- Names the meaning for hover and screen readers; not a tab stop (kd#27: 8+ extra stops on a board of carried-over cards) ("Tag 3 auf dem Board")
- Never interactive: no click handler and no focus, so it adds no drag-vs-click target
-->
<template>
  <span v-if="isVisible && decorative" class="carry-over-dots" aria-hidden="true" data-testid="carry-over-dots" :data-day="day">
    <span v-for="index in dotCount" :key="index" class="carry-over-dot" />
    <span v-if="hasOverflow" class="carry-over-more">+</span>
  </span>
  <UTooltip v-else-if="isVisible" :text="label" :content="{ side: 'top', sideOffset: 6 }">
    <span
      class="carry-over-dots"
      role="img"
      :aria-label="label"
      data-testid="carry-over-dots"
      :data-day="day"
    >
      <span v-for="index in dotCount" :key="index" class="carry-over-dot" aria-hidden="true" />
      <span v-if="hasOverflow" class="carry-over-more" aria-hidden="true">+</span>
      <!-- Past the cap the dots stop counting, so the numeral gives the exact count (#584: not below the cap) -->
      <span v-if="hasOverflow" class="carry-over-count" aria-hidden="true" data-testid="carry-over-count">{{ day }}</span>
    </span>
  </UTooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CARRY_OVER_DOT_CAP, isCarryOverVisible } from '~/utils/carryOver'

defineOptions({ name: 'TaskCarryOverDots' })

interface Props {
  /** Display day (1 = first board day, renders nothing; 2 = second day). */
  day: number
  /** Next to text that already states the count: hidden from assistive tech, no tooltip, no tab stop. */
  decorative?: boolean
}

const props = withDefaults(defineProps<Props>(), { decorative: false })

const { t } = useI18n()

const isVisible = computed(() => isCarryOverVisible(props.day))
const dotCount = computed(() => Math.min(props.day, CARRY_OVER_DOT_CAP))
const hasOverflow = computed(() => props.day > CARRY_OVER_DOT_CAP)
const label = computed(() => t('task.carryOver.label', { n: props.day }))
</script>

<style scoped>
/* Muted token colour: Graphite on the card sheet is well above the 3:1 non-text bar (WCAG 1.4.11).
   No colour escalation, no animation: the count is the only signal. */
.carry-over-dots {
  display: inline-flex;
  /* The item that gives way in a footer row that is too narrow (#323, #584): the end of the dots is clipped.
     The dots take no focus (kd#27), so nothing outside the box needs to be drawn. */
  min-width: 0;
  overflow: hidden;
  align-items: center;
  gap: var(--carry-over-dot-gap);
  min-height: 1rem;
  padding-inline: 0.125rem;
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
  cursor: inherit;
}

.carry-over-dot {
  flex-shrink: 0;
  width: var(--carry-over-dot-size);
  height: var(--carry-over-dot-size);
  border-radius: 50%;
  background-color: currentColor;
}

.carry-over-count {
  flex-shrink: 0;
  margin-left: 0.125rem;
  font-size: 0.6875rem; /* label step */
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.carry-over-more {
  flex-shrink: 0;
  font-size: 0.6875rem; /* label step */
  font-weight: 500;
  line-height: 1;
}

/* Mobile label step (#220): 0.6875rem -> 0.75rem with the card's footer chips */
@media (max-width: 767px) {
  .carry-over-count,
  .carry-over-more {
    font-size: 0.75rem;
  }
}
</style>
