<!--
@component StatsEstimateRing
@kind component
@category display
@description Q3 chart: ring of the timeboxed tasks of the last 8 weeks that ran longer / as planned / shorter, with its legend
@usage Summary of the Q3 tile
@avoid Only the Q3 estimate chart; a generic ring is StatsRing.
@responsibility
- Ink ramp only: longer = darkest, as planned = 32 %, shorter = 10 %; no status colour
- The aria-label and the legend carry the same numbers
-->
<template>
  <div class="flex items-center gap-5" :class="stacked ? 'md:flex-col md:items-start' : ''">
    <StatsRing :segments="segments" :label="label" :size="size" :thickness="14">
      <span class="font-display text-2xl leading-(--lh-tight) text-highlighted tabular-nums">{{ estimate.n }}</span>
      <span class="text-xs text-toned">{{ t('statistics.estimate.center') }}</span>
    </StatsRing>
    <ul class="min-w-0 space-y-1.5 text-sm">
      <li v-for="item in legend" :key="item.key" class="flex items-center gap-2 text-default">
        <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: inkColor(item.step) }" aria-hidden="true" />
        <span>{{ item.label }}</span>
        <span class="shrink-0 whitespace-nowrap text-muted tabular-nums">{{ Math.round(item.value) }} %</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { inkColor } from '~/lib/inkRamp'
import type { Review } from '~/lib/statisticsReview'
import StatsRing from '~/components/statistics/StatsRing.vue'

defineOptions({ name: 'StatsEstimateRing' })

const props = withDefaults(defineProps<{ estimate: Review['estimate']; size?: number; stacked?: boolean }>(), { size: 110, stacked: false })
const { t } = useI18n()

const legend = computed(() => [
  { key: 'longer', step: 0, value: props.estimate.longer, label: t('statistics.estimate.longer') },
  { key: 'onTarget', step: 3, value: props.estimate.onTarget, label: t('statistics.estimate.onTarget') },
  { key: 'shorter', step: 5, value: props.estimate.shorter, label: t('statistics.estimate.shorter') },
])
const segments = computed(() => legend.value.map(l => ({ value: l.value, step: l.step })))
const label = computed(() => t('statistics.estimate.label', {
  longer: Math.round(props.estimate.longer),
  onTarget: Math.round(props.estimate.onTarget),
  shorter: Math.round(props.estimate.shorter),
}))
</script>
