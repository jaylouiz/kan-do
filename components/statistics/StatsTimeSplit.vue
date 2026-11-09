<!--
@component StatsTimeSplit
@kind component
@category display
@description Q4 chart: donut of where the time of the last 4 weeks went (completed tasks only), by topic or activity, in the ink ramp, with a legend
@usage Summary of the Q4 tile (top 3 legend rows while closed) and the rows of its open panel
@avoid Only the Q4 time donut; a generic ring is StatsRing.
@responsibility
- Fold slices beyond four into "Sonstiges" (the lightest step); topic hues stay on the TopicMark before a topic name, never on the chart
- Name the numbers in the aria-label of the ring
- `rows` mode renders the full legend (time and share per slice) for the open panel
-->
<template>
  <div v-if="mode === 'chart'" class="flex items-center gap-5" :class="stacked ? 'md:flex-col md:items-start' : ''">
    <StatsRing :segments="segments" :label="ringLabel" :size="size" :thickness="14">
      <span class="font-display leading-(--lh-tight) text-highlighted tabular-nums" :class="size >= 150 ? 'text-2xl' : 'text-base'">{{ formatDuration(seconds, 'clockShort') }}</span>
    </StatsRing>
    <ul v-if="legendRows.length" class="min-w-0 space-y-1.5 text-sm">
      <li v-for="(row, index) in legendRows" :key="row.key" class="flex items-center gap-2 text-default">
        <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: inkColor(stepOf(row, index)) }" aria-hidden="true" />
        <TopicMark v-if="by === 'topic' && isNamed(row.key)" :topic="row.key" />
        <span class="truncate" :data-private="isNamed(row.key) ? '' : undefined">{{ labelOf(row.key) }}</span>
        <span class="shrink-0 whitespace-nowrap text-muted tabular-nums">{{ Math.round(row.share) }} %</span>
      </li>
    </ul>
  </div>
  <ul v-else class="divide-y divide-default" data-testid="stats-split-rows">
    <li v-for="(row, index) in folded" :key="row.key" class="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <span class="flex min-w-0 items-center gap-2 text-default">
        <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: inkColor(stepOf(row, index)) }" aria-hidden="true" />
        <TopicMark v-if="by === 'topic' && isNamed(row.key)" :topic="row.key" />
        <span class="truncate" :data-private="isNamed(row.key) ? '' : undefined">{{ labelOf(row.key) }}</span>
      </span>
      <span class="shrink-0 text-muted tabular-nums">{{ t('statistics.split.row', { time: formatDuration(row.seconds, 'spaced'), share: Math.round(row.share) }) }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { INK_STEPS, inkColor } from '~/lib/inkRamp'
import { foldSlices, NO_ACTIVITY, NO_TOPIC, OTHER_SLICE, type Review, type Slice } from '~/lib/statisticsReview'
import StatsRing from '~/components/statistics/StatsRing.vue'
import TopicMark from '~/components/topic/TopicMark.vue'

defineOptions({ name: 'StatsTimeSplit' })

const props = withDefaults(defineProps<{
  split: Review['split']
  by: 'topic' | 'activity'
  /** `chart`: ring plus a short legend; `rows`: the full legend as rows. */
  mode?: 'chart' | 'rows'
  size?: number
  /** Legend rows shown in chart mode (the closed tile shows 3). */
  legendCount?: number
  stacked?: boolean
}>(), { mode: 'chart', size: 110, legendCount: 3, stacked: false })

const { t } = useI18n()
const { formatDuration } = useLocaleFormat()

const slices = computed<Slice[]>(() => (props.by === 'topic' ? props.split.byTopic : props.split.byActivity))
const folded = computed(() => foldSlices(slices.value))
const legendRows = computed(() => folded.value.slice(0, props.legendCount))
const seconds = computed(() => props.split.seconds)

/** The rest slice always takes the lightest step; the others go darkest first. */
const stepOf = (row: Slice, index: number): number => (row.key === OTHER_SLICE ? INK_STEPS.length - 1 : index)
const segments = computed(() => folded.value.map((row, index) => ({ value: row.share, step: stepOf(row, index) })))

const isNamed = (key: string): boolean => key !== NO_TOPIC && key !== NO_ACTIVITY && key !== OTHER_SLICE
const labelOf = (key: string): string => {
  if (key === OTHER_SLICE) return t('statistics.split.other')
  if (key === NO_TOPIC && props.by === 'topic') return t('statistics.noTopic')
  if (key === NO_ACTIVITY && props.by === 'activity') return t('statistics.noActivity')
  return key
}
const ringLabel = computed(() => t(props.by === 'topic' ? 'statistics.split.labelTopic' : 'statistics.split.labelActivity', {
  values: folded.value.map(row => `${labelOf(row.key)} ${Math.round(row.share)} %`).join(', '),
}))
</script>
