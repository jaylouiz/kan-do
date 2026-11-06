<!--
@component StatsRhythmBars
@description "Wann arbeite ich?" chart (#600): one bar per visible hour (6:00 to 22:00) with the time tracked in it over the last 8 weeks, the 3-hour peak window in the strong ink and the rest one ramp step lighter; or, without data, muted ghost bars
@usage Summary of the work-rhythm tile in StatsTiles, closed (about 20rem wide at `md+`, full width below)
@responsibility
- Draw the bars from `hours` (seconds per hour, first visible hour first); heights are relative to the busiest hour, an hour without time keeps a hairline
- `ghost` draws a fixed muted shape for the first-run state and is hidden from assistive tech
- Carry the numbers as text alternative (`role="img"` and an `aria-label` naming the peak window and its share)
-->
<template>
  <div v-if="ghost" class="flex h-16 items-end gap-1" aria-hidden="true" data-testid="stats-rhythm-ghost">
    <span v-for="(height, index) in GHOST_HEIGHTS" :key="index" class="w-full rounded-t-sm bg-accented" :style="{ height: `${height}%` }" />
  </div>
  <div v-else role="img" :aria-label="label" data-testid="stats-rhythm-bars">
    <div class="flex h-16 items-end gap-1" aria-hidden="true">
      <span
        v-for="(seconds, index) in hours"
        :key="index"
        class="w-full"
        :class="seconds > 0 ? 'rounded-t-sm' : 'h-px bg-accented'"
        :style="seconds > 0 ? { height: `${Math.max((seconds / max) * 100, 4)}%`, backgroundColor: inkColor(inPeak(index) ? 0 : 3) } : {}"
        :data-peak="inPeak(index) ? 'true' : undefined"
        data-testid="stats-rhythm-bar"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { inkColor } from '~/lib/inkRamp'
import { RHYTHM, type WorkRhythm } from '~/lib/workRhythm'

defineOptions({ name: 'StatsRhythmBars' })

const props = defineProps<{
  hours?: number[]
  peak?: WorkRhythm['peak']
  ghost?: boolean
}>()
const { t } = useI18n()

/** A calm, fixed morning-heavy shape: no number is implied. */
const GHOST_HEIGHTS = [10, 18, 34, 52, 60, 44, 24, 30, 44, 40, 26, 16, 10, 8, 6, 4]

const hours = computed(() => props.hours ?? [])
const max = computed(() => Math.max(...hours.value, 1))
const inPeak = (index: number): boolean => !!props.peak && RHYTHM.firstHour + index >= props.peak.from && RHYTHM.firstHour + index < props.peak.to

const label = computed(() => props.peak
  ? t('statistics.rhythm.barsLabel', { from: props.peak.from, to: props.peak.to, share: props.peak.share })
  : '')
</script>
