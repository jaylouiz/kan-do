<!--
@component StatsPatterns
@kind component
@category display
@description Q3 detail: the ranked estimate patterns as diverging bars with sample size and a next-timebox line
@usage Open Q3 tile
@avoid Only the Q3 detail on the Statistik page.
@responsibility
- Show the first four patterns, the rest behind "Alle n Muster anzeigen"
- Label a pattern by its kind (activity, topic, timebox size, time of day); activity and topic names are user data (`data-private`)
- Bars take the ink ramp only: longer than planned = darkest, shorter = 32 %
-->
<template>
  <div>
    <SectionHeader tag="h3" size="sub">{{ t('statistics.patterns.heading') }}</SectionHeader>
    <p v-if="patterns.length === 0" class="mt-3 text-body text-muted">{{ emptyText }}</p>
    <ul v-else class="mt-3 divide-y divide-default" data-testid="stats-patterns">
      <li v-for="pattern in shown" :key="pattern.id" class="py-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p class="min-w-0 text-default">
            <span class="text-sm text-muted">{{ t(`statistics.patterns.kind.${pattern.kind}`) }}</span>
            <span class="ml-2" :data-private="pattern.kind === 'activity' || pattern.kind === 'topic' ? '' : undefined">{{ labelOf(pattern) }}</span>
          </p>
          <p class="text-sm text-muted tabular-nums">{{ t('statistics.patterns.sample', { n: pattern.n }, pattern.n) }}</p>
        </div>
        <div class="relative mt-2 h-2 rounded-full bg-muted" aria-hidden="true">
          <span class="absolute inset-y-0 left-1/2 w-px bg-accented" />
          <span
            class="absolute inset-y-0 rounded-full"
            :style="barStyle(pattern)"
          />
        </div>
        <p class="mt-2 text-body text-default">{{ pattern.deviation > 0 ? t('statistics.patterns.longer', { pct: pct(pattern) }) : t('statistics.patterns.shorter', { pct: pct(pattern) }) }}</p>
        <p class="text-body text-muted">{{ pattern.deviation > 0 ? t('statistics.patterns.nextLonger', { pct: pct(pattern) }) : t('statistics.patterns.nextShorter', { pct: pct(pattern) }) }}</p>
      </li>
    </ul>
    <UButton
      v-if="patterns.length > shownCount"
      color="neutral"
      variant="link"
      class="mt-2 min-h-11 px-0"
      :label="showAll ? t('statistics.patterns.showFewer') : t('statistics.patterns.showAll', { n: patterns.length })"
      data-testid="stats-patterns-more"
      @click="showAll = !showAll"
    />
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { inkColor } from '~/lib/inkRamp'
import { REVIEW, type EstimatePattern } from '~/lib/statisticsReview'

defineOptions({ name: 'StatsPatterns' })

const props = defineProps<{ patterns: EstimatePattern[]; emptyText: string }>()
const { t } = useI18n()

const shownCount = REVIEW.patternsShown
const showAll = ref(false)
const shown = computed(() => (showAll.value ? props.patterns : props.patterns.slice(0, shownCount)))

const pct = (pattern: EstimatePattern): number => Math.round(Math.abs(pattern.deviation))
const labelOf = (pattern: EstimatePattern): string =>
  pattern.kind === 'size' ? t(`statistics.patterns.size.${pattern.key}`)
    : pattern.kind === 'time' ? t(`statistics.patterns.time.${pattern.key}`)
      : pattern.key

/** The bar grows from the centre: to the right = longer than planned, to the left = shorter. */
const barStyle = (pattern: EstimatePattern) => {
  const width = Math.min(Math.abs(pattern.deviation), 100) / 2
  return pattern.deviation > 0
    ? { left: '50%', width: `${width}%`, backgroundColor: inkColor(0) }
    : { right: '50%', width: `${width}%`, backgroundColor: inkColor(3) }
}
</script>
