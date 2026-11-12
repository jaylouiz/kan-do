<!--
@component StatsTiles
@kind block
@category display
@description Q2 to Q4 of the Statistik page: three question tiles in a grid (one column below `md`) that open in place, one at a time, plus the full-width work-rhythm tile "Wann arbeite ich?" (#600) under them, which shares the same open state
@usage Under the verdict in pages/statistics.vue
@avoid Only under the verdict on the Statistik page.
@responsibility
- Own the page state `open: 2 | 3 | 4 | 5 | null` (initial value from the `initialOpen` prop, i.e. `?open=`; never written back, never persisted)
- At `md+` render the open tile first (the list is reordered in the DOM, never with CSS `order`, so reading and focus order match the visual order); below `md` the order stays natural. Tile 5 is full width already and always stays last
- Q2 to Q4 stay hidden on an empty review; tile 5 is always shown (its first-run state explains that recording has started, #600)
- Tile 5 (work rhythm, #600): in its first-run state it has no toggle and no panel
- Restore focus to the toggle of the tile that was just toggled (a keyed DOM move can blur it) and scroll its heading into view only if it is off screen
- Pick each tile's one-line answer; Q3 without any timebox is a plain heading with no toggle
- Q4 detail (#537): one muted line for the time the completion records do not hold (tasks still open, tasks deleted before completion); no line when both are 0
- Emit `open-task` when an outlier is chosen
-->
<template>
  <div class="grid gap-4 md:grid-cols-3 md:gap-6">
    <StatsTile
      v-for="n in questionOrder"
      :key="n"
      :ref="(el) => setTileRef(n, el)"
      :n="n"
      :question="t(`statistics.question.q${n}`)"
      :line="lines[n]"
      :open="isOpen(n)"
      :toggleable="n !== 3 || review.hasTimeboxes"
      @toggle="toggle(n)"
    >
      <template v-if="n === 2">
        <StatsTrendBars :weeks="review.weeks" :labelled="isOpen(2)" />
      </template>
      <template v-else-if="n === 3">
        <StatsEstimateRing
          v-if="review.hasTimeboxes && review.estimate.n > 0"
          :estimate="review.estimate"
          :size="isOpen(3) ? 120 : 110"
          :stacked="!isOpen(3)"
        />
      </template>
      <template v-else>
        <StatsTimeSplit
          v-if="review.split.taskCount > 0"
          :split="review.split"
          :by="by"
          :size="isOpen(4) ? 170 : 110"
          :legend-count="isOpen(4) ? 0 : 3"
          :stacked="!isOpen(4)"
        />
      </template>

      <template #detail>
        <StatsWeekTable v-if="n === 2" :weeks="review.weeks" />
        <div v-else-if="n === 3" class="space-y-8">
          <StatsPatterns :patterns="review.patterns" :empty-text="lines[3]" />
          <StatsOutliers :outliers="review.outliers" @open="(id: string) => emit('open-task', id)" />
        </div>
        <div v-else-if="review.split.taskCount > 0 || unfinishedLine">
          <template v-if="review.split.taskCount > 0">
            <UTabs v-model="by" :items="byItems" :content="false" size="sm" :aria-label="t('statistics.split.by')" />
            <p class="mt-4 text-body text-default">{{ t('statistics.split.caption', { time: formatDuration(review.split.seconds, 'spaced') }) }}</p>
            <p v-if="review.split.unplannedShare !== null" class="mt-1 text-body text-default">
              {{ t('statistics.split.unplanned', { share: Math.round(review.split.unplannedShare) }) }}
            </p>
          </template>
          <p v-if="unfinishedLine" class="text-body text-muted" :class="review.split.taskCount > 0 ? 'mt-1' : ''" data-testid="stats-unfinished">{{ unfinishedLine }}</p>
          <StatsTimeSplit v-if="review.split.taskCount > 0" class="mt-3" :split="review.split" :by="by" mode="rows" />
        </div>
      </template>
    </StatsTile>

    <StatsTile
      :ref="(el) => setTileRef(5, el)"
      :n="5"
      :question="t('statistics.question.q5')"
      :line="rhythmLine"
      :open="isOpen(5)"
      :toggleable="rhythmReady"
      wide
      @toggle="toggle(5)"
    >
      <!-- The open panel's grid replaces the bars -->
      <StatsRhythmBars v-if="rhythmReady && !isOpen(5)" :hours="rhythm.hourSeconds" :peak="rhythm.peak" />
      <StatsRhythmBars v-else-if="!rhythmReady" ghost />
      <template v-if="!rhythmReady" #under-line>
        <p class="mt-2 text-sm text-muted tabular-nums" data-testid="stats-rhythm-days">{{ t('statistics.rhythm.days', { n: rhythm.days, min: RHYTHM.minDays }) }}</p>
      </template>

      <template #detail>
        <h3 class="m-0 text-base font-medium text-highlighted">{{ t('statistics.rhythm.heading') }}</h3>
        <StatsRhythmGrid class="mt-4" :rhythm="rhythm" :weekday-labels="weekdayShort" :longest-name="longestName" />
        <dl class="mt-6 divide-y divide-default border-y border-default text-sm" data-testid="stats-rhythm-rows">
          <div v-if="rhythm.start" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowStart') }}<span v-if="rhythm.start.scope === 'workdays'" class="text-muted"> ({{ t('statistics.rhythm.workdaysOnly') }})</span></dt>
            <dd class="m-0 text-highlighted tabular-nums" data-private>{{ clock(rhythm.start.minutes) }}</dd>
          </div>
          <div v-if="rhythm.end" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowEnd') }}</dt>
            <dd class="m-0 text-highlighted tabular-nums" data-private>{{ clock(rhythm.end.minutes) }}</dd>
          </div>
          <div v-if="longestName" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowLongest') }}</dt>
            <dd class="m-0 text-highlighted" data-private>{{ longestName }}</dd>
          </div>
        </dl>
      </template>
    </StatsTile>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useIsDesktop } from '~/composables/useIsDesktop'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { NO_TOPIC, REVIEW, type Review, type UnfinishedTime } from '~/lib/statisticsReview'
import { RHYTHM, type WorkRhythm } from '~/lib/workRhythm'
import StatsTile from '~/components/statistics/StatsTile.vue'
import StatsRhythmBars from '~/components/statistics/StatsRhythmBars.vue'
import StatsRhythmGrid from '~/components/statistics/StatsRhythmGrid.vue'
import StatsEstimateRing from '~/components/statistics/StatsEstimateRing.vue'
import StatsOutliers from '~/components/statistics/StatsOutliers.vue'
import StatsPatterns from '~/components/statistics/StatsPatterns.vue'
import StatsTimeSplit from '~/components/statistics/StatsTimeSplit.vue'
import StatsTrendBars from '~/components/statistics/StatsTrendBars.vue'
import StatsWeekTable from '~/components/statistics/StatsWeekTable.vue'

defineOptions({ name: 'StatsTiles' })

type TileNumber = 2 | 3 | 4 | 5
type QuestionNumber = 2 | 3 | 4

const props = defineProps<{
  review: Review
  /** Time on tasks still open and on tasks deleted before completion (#537); absent = nothing to add. */
  unfinished?: UnfinishedTime
  /** When in the day work happens (#600). */
  rhythm: WorkRhythm
  /** Tile opened on first render (the page reads the deep link `?open=`); never written back. */
  initialOpen?: number | null
}>()
const emit = defineEmits<{ 'open-task': [taskId: string] }>()

const { t, locale } = useI18n()
const { formatDuration } = useLocaleFormat()

const open = ref<TileNumber | null>(props.initialOpen === 2 || props.initialOpen === 3 || props.initialOpen === 4 || props.initialOpen === 5 ? props.initialOpen : null)
const by = ref<'topic' | 'activity'>('topic')

const rhythmReady = computed(() => props.rhythm.state === 'normal')
const toggleable = (n: TileNumber): boolean => n === 5 ? rhythmReady.value : n !== 3 || props.review.hasTimeboxes
const isOpen = (n: TileNumber): boolean => open.value === n && toggleable(n)

const isWide = useIsDesktop()
/** Open tile first at `md+`; otherwise the natural order. */
const order = computed<QuestionNumber[]>(() => {
  const natural: QuestionNumber[] = [2, 3, 4]
  const current = open.value
  if (current === null || current === 5 || !isWide.value || !toggleable(current)) return natural
  return [current, ...natural.filter(n => n !== current)]
})
/** Q2 to Q4 are hidden on an empty review (nothing to compare yet). */
const questionOrder = computed<QuestionNumber[]>(() => (props.review.state === 'empty' ? [] : order.value))

const tileRefs = new Map<TileNumber, { focus: () => void; $el: HTMLElement } | null>()
const setTileRef = (n: TileNumber, el: unknown) => {
  tileRefs.set(n, (el as { focus: () => void; $el: HTMLElement } | null) ?? null)
}

async function toggle(n: TileNumber) {
  open.value = open.value === n ? null : n
  await nextTick()
  const tile = tileRefs.get(n)
  tile?.focus()
  if (open.value === n) tile?.$el.scrollIntoView({ block: 'nearest' })
}

const byItems = computed(() => [
  { label: t('statistics.split.byTopic'), value: 'topic' },
  { label: t('statistics.split.byActivity'), value: 'activity' },
])

const unfinishedLine = computed<string | null>(() => {
  const open = props.unfinished?.openSeconds ?? 0
  const discarded = props.unfinished?.discardedSeconds ?? 0
  const args = { open: formatDuration(open, 'spaced'), deleted: formatDuration(discarded, 'spaced') }
  if (open > 0 && discarded > 0) return t('statistics.split.unfinishedBoth', args)
  if (open > 0) return t('statistics.split.unfinishedOpen', args)
  if (discarded > 0) return t('statistics.split.unfinishedDiscarded', args)
  return null
})

const lines = computed<Record<QuestionNumber, string>>(() => {
  const { trend, hasTimeboxes, patterns, estimate, split } = props.review

  const q2 = trend.direction === 'few'
    ? t('statistics.trend.few')
    : trend.direction === 'flat'
      ? t('statistics.trend.flat')
      : t(`statistics.trend.${trend.direction}`, { early: Math.round(trend.early ?? 0), recent: Math.round(trend.recent ?? 0) })

  const top = patterns[0]
  const q3 = !hasTimeboxes
    ? t('statistics.patterns.noTimebox')
    : top
      ? t(top.deviation > 0 ? 'statistics.patterns.lineLonger' : 'statistics.patterns.lineShorter', { label: patternLabel(top.kind, top.key) })
      : estimate.n < REVIEW.patternMinTasks ? t('statistics.patterns.tooFew') : t('statistics.patterns.none')

  // The largest slice, no-topic included (Decision 6): "Meist in" must not skip tasks without a topic that take most of the time.
  const topSlice = split.byTopic[0]
  const topTopic = topSlice && topSlice.key !== NO_TOPIC ? topSlice : undefined
  const q4 = split.taskCount === 0
    ? t('statistics.split.empty')
    : topTopic
      ? t('statistics.split.lineTopic', { label: topTopic.key, share: Math.round(topTopic.share) })
      : t('statistics.split.lineTime', { time: formatDuration(split.seconds, 'spaced') })

  return { 2: q2, 3: q3, 4: q4 }
})

/** Local clock time of a minute count after midnight (past 24 h wraps to the next morning). */
function clock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  return new Date(2000, 0, 1, Math.floor(wrapped / 60), wrapped % 60).toLocaleTimeString(locale.value, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
}

/** 2 Nov 2026 is a Monday. */
const weekdayDate = (weekday: number): Date => new Date(2026, 10, 2 + weekday)
const weekdayShort = computed(() => Array.from({ length: 7 }, (_, weekday) =>
  weekdayDate(weekday).toLocaleDateString(locale.value, { weekday: 'short' }).replace(/\.$/, '')))
const longestName = computed(() => props.rhythm.longestWeekday === null
  ? null
  : weekdayDate(props.rhythm.longestWeekday).toLocaleDateString(locale.value, { weekday: 'long' }))

const rhythmLine = computed<string>(() => {
  const { state, peak, start, outsideShare } = props.rhythm
  if (state === 'thin' || !peak) return t('statistics.rhythm.thin')
  const parts = [t('statistics.rhythm.line', { from: peak.from, to: peak.to, share: peak.share })]
  if (outsideShare >= RHYTHM.outsideNoteShare) parts.push(t('statistics.rhythm.lineOutside', { share: outsideShare, first: RHYTHM.firstHour, last: RHYTHM.firstHour + RHYTHM.hours }))
  if (start) parts.push(t(start.scope === 'workdays' ? 'statistics.rhythm.lineStartWorkdays' : 'statistics.rhythm.lineStart', { time: clock(start.minutes) }))
  return parts.join(' ')
})

function patternLabel(kind: string, key: string): string {
  if (kind === 'size') return t(`statistics.patterns.size.${key}`)
  if (kind === 'time') return t(`statistics.patterns.time.${key}`)
  return key
}
</script>
