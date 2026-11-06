<!--
@component StatsWeekTable
@description The numbers behind the Q2 bars: one row per 7-day window, newest first (period, tasks, share in the timebox, time spent, tasks still open at day end)
@usage Detail of the open Q2 tile
@responsibility
- List every window, a `–` for a missing value
- Day end (#537): the mean number of tasks still in Offen/Jetzt/Wartet at the last count the app saw on each day of the window,
  from 3 days with a value on; fewer days read `–`, never 0. The count is the last one seen, not an exact closing time (term `day-end`)
- Reflow to two lines at 390px (period above, figures below)
-->
<template>
  <ul class="divide-y divide-default text-sm" data-testid="stats-week-list">
    <li v-for="(week, index) in rows" :key="week.start.getTime()" class="flex flex-col gap-1 py-2.5 md:flex-row md:items-baseline md:justify-between md:gap-6">
      <span class="text-default">{{ index === 0 ? t('statistics.trend.table.current') : range(week) }}</span>
      <span class="text-muted tabular-nums">
        {{ t('statistics.patterns.sample', { n: week.tasks }, week.tasks) }}
        · {{ t('statistics.trend.table.inTimebox') }} {{ week.inTimeboxShare === null ? '–' : `${Math.round(week.inTimeboxShare)} %` }}
        · {{ formatDuration(week.seconds, 'spaced') }}
        · <span class="whitespace-nowrap" data-testid="stats-week-day-end">{{ week.dayEndOpen === null ? t('statistics.trend.table.dayEndNone') : t('statistics.trend.table.dayEnd', { n: count(week.dayEndOpen) }) }}</span>
      </span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { addDays, type WeekPoint } from '~/lib/statisticsReview'

defineOptions({ name: 'StatsWeekTable' })

const props = defineProps<{ weeks: WeekPoint[] }>()
const { t } = useI18n()
const { locale, formatDuration } = useLocaleFormat()

/** Newest first. */
const rows = computed(() => [...props.weeks].reverse())

const count = (value: number): string => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)

const range = (week: WeekPoint): string => {
  const format = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'numeric' })
  return t('statistics.trend.table.range', { start: format.format(week.start), end: format.format(addDays(week.end, -1)) })
}
</script>
