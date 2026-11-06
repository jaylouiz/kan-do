<!--
@component StatsTrendBars
@description Q2 chart: eight bars of the in-timebox share per 7-day window, the last window in the strong ink, the others quiet; a window without a value has no bar
@usage Summary of the Q2 tile (small) and its open panel (larger, with value labels)
@responsibility
- Draw the bars from `weeks` (oldest first); heights are the share itself (0-100 %) of a track the value label does not eat into
- Carry the values as text alternative; the bars are decoration for assistive tech
- Value labels only while `labelled` (open tile); eight columns stay across at 390px
-->
<template>
  <div role="img" :aria-label="label">
    <div class="flex items-end gap-2" :class="labelled ? 'h-32' : 'h-16'" aria-hidden="true">
      <div v-for="(week, index) in weeks" :key="week.start.getTime()" class="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
        <span v-if="labelled" class="shrink-0 text-xs text-muted tabular-nums">{{ week.inTimeboxShare === null ? '–' : `${Math.round(week.inTimeboxShare)} %` }}</span>
        <!-- The track is the bar's own box: its % height is the share of this track, so the label above never squeezes a tall bar. -->
        <div class="flex min-h-0 w-full flex-1 items-end">
          <span
            v-if="week.inTimeboxShare !== null"
            class="w-full rounded-t-sm"
            :class="index === weeks.length - 1 ? '' : 'bg-accented'"
            :style="{ height: `${Math.max(week.inTimeboxShare, 3)}%`, ...(index === weeks.length - 1 ? { backgroundColor: inkColor(0) } : {}) }"
            data-testid="stats-trend-bar"
          />
          <span v-else class="h-px w-full bg-accented" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { inkColor } from '~/lib/inkRamp'
import type { WeekPoint } from '~/lib/statisticsReview'

defineOptions({ name: 'StatsTrendBars' })

const props = defineProps<{ weeks: WeekPoint[]; labelled?: boolean }>()
const { t } = useI18n()

const label = computed(() => t('statistics.trend.chartLabel', {
  values: props.weeks.map(w => (w.inTimeboxShare === null ? t('statistics.trend.noValue') : `${Math.round(w.inTimeboxShare)} %`)).join(', '),
}))
</script>
