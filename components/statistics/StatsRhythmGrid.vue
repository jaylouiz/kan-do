<!--
@component StatsRhythmGrid
@kind component
@category display
@description Open panel of the work-rhythm tile (#600): a grid of 7 weekday rows (Monday first) x 16 hour columns (6:00 to 22:00) with the average minutes tracked per weekday and hour over the last 8 weeks, in the ink ramp (darkest = most, `bg-muted` = nothing), hour labels every third column and a "weniger ... mehr" legend
@usage Detail of tile 5 in StatsTiles
@avoid Only the open work-rhythm panel; the closed summary is StatsRhythmBars.
@responsibility
- Colour a cell by its share of the busiest cell (five ramp steps); weekends and days off are empty cells like any other, never marked
- `role="img"` with an `aria-label` that names the peak window and the longest weekday; the sentence and rows beside it carry the same numbers as text
- Cells shrink to squares at 390px; weekday and hour labels stay
-->
<template>
  <div role="img" :aria-label="label" data-testid="stats-rhythm-grid">
    <div class="grid gap-x-0.5 gap-y-0.5" :style="{ gridTemplateColumns: `2rem repeat(${RHYTHM.hours}, minmax(0, 1fr))` }" aria-hidden="true">
      <span />
      <span
        v-for="index in RHYTHM.hours"
        :key="`h${index}`"
        class="text-center text-xs text-muted tabular-nums"
      ><template v-if="(index - 1) % 3 === 0">{{ RHYTHM.firstHour + index - 1 }}</template></span>
      <template v-for="(row, weekday) in grid" :key="weekday">
        <span class="flex items-center text-xs text-muted">{{ weekdayLabels[weekday] }}</span>
        <span
          v-for="(value, index) in row"
          :key="index"
          class="aspect-square rounded-xs md:aspect-auto md:h-6"
          :class="value > 0 ? '' : 'bg-muted'"
          :style="value > 0 ? { backgroundColor: inkColor(step(value)) } : {}"
          data-testid="stats-rhythm-cell"
        />
      </template>
    </div>
    <div class="mt-3 flex items-center justify-end gap-2 text-xs text-muted" aria-hidden="true">
      <span>{{ t('statistics.rhythm.less') }}</span>
      <span class="size-3 rounded-xs bg-muted" />
      <span v-for="s in [4, 3, 2, 1, 0]" :key="s" class="size-3 rounded-xs" :style="{ backgroundColor: inkColor(s) }" />
      <span>{{ t('statistics.rhythm.more') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { inkColor } from '~/lib/inkRamp'
import { RHYTHM, type WorkRhythm } from '~/lib/workRhythm'

defineOptions({ name: 'StatsRhythmGrid' })

const props = defineProps<{
  rhythm: WorkRhythm
  /** Short weekday names, Monday first. */
  weekdayLabels: string[]
  /** Long name of the longest weekday, for the label. */
  longestName: string | null
}>()
const { t } = useI18n()

const grid = computed(() => props.rhythm.grid)

/** Ramp step of a cell: 0 = darkest = at least 80 % of the busiest cell. */
function step(value: number): number {
  const share = props.rhythm.gridMax > 0 ? value / props.rhythm.gridMax : 0
  if (share > 0.8) return 0
  if (share > 0.6) return 1
  if (share > 0.4) return 2
  if (share > 0.2) return 3
  return 4
}

const label = computed(() => {
  const peak = props.rhythm.peak
  const parts = [t('statistics.rhythm.gridLabel')]
  if (peak) parts.push(t('statistics.rhythm.gridLabelPeak', { from: peak.from, to: peak.to, share: peak.share }))
  if (props.longestName) parts.push(t('statistics.rhythm.gridLabelLongest', { weekday: props.longestName }))
  return parts.join(' ')
})
</script>
