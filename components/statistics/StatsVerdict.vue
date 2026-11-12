<!--
@component StatsVerdict
@kind block
@category display
@description Q1 of the Statistik page, always open: one sentence on the last 7 days against the user's own 4 weeks before, one supporting line and a ring of the in-timebox share with a tick at the usual value
@usage Top of pages/statistics.vue
@avoid Only the always-open Q1 of the Statistik page; the other questions are StatsTile.
@responsibility
- Pick the sentence from `review.state` / `review.verdict` (empty, thin, quiet, three verdict branches); never red, never praise
- Empty state (kd#106, the Statistik form of the page empty state): where the ring will appear, its bare neutral track stands as a decorative placeholder (`aria-hidden`, no segment, no number), like the grey bars of the rhythm tile; hidden below `md`, where it would drop under the text and read as a spinner (the rhythm tile's bars right below are the graphic there); headline and line are the sentence and the subline
- Show the filled ring only in the `verdict` state (#687: with too little history a full ring read as an achievement against the headline); its `aria-label` and the line carry the same numbers
- Drop clauses that have no data (no timeboxed task now, no usual value) instead of showing zeros
-->
<template>
  <PageSheet tag="section" aria-labelledby="stats-q1" data-testid="stats-verdict">
    <p class="text-body text-toned">{{ t('statistics.question.q1') }}</p>
    <p v-if="review.state !== 'empty'" class="mt-1 text-body text-toned">{{ t('statistics.verdict.caption') }}</p>
    <div class="mt-4 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div>
        <SectionHeader id="stats-q1" tag="h2" size="hero" data-testid="stats-verdict-headline">
          {{ headline }}
        </SectionHeader>
        <p class="mt-4 max-w-md text-pretty text-default" data-testid="stats-verdict-line">{{ line }}</p>
      </div>
      <StatsRing
        v-if="showRing"
        :segments="ringSegments"
        :tick="inTimeboxUsual"
        :size="160"
        :thickness="14"
        :label="ringLabel"
      >
        <span class="text-display font-semibold text-highlighted tabular-nums">{{ inTimeboxNow === null ? '–' : `${pct(inTimeboxNow)} %` }}</span>
        <span class="text-xs text-toned">{{ t('statistics.verdict.ring.center') }}</span>
      </StatsRing>
      <StatsRing v-else-if="review.state === 'empty'" placeholder :size="160" :thickness="14" class="max-md:hidden" data-testid="stats-verdict-placeholder" />
    </div>
  </PageSheet>
</template>

<script setup lang="ts">
import PageSheet from '~/components/ui/PageSheet.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { REVIEW, type Review } from '~/lib/statisticsReview'
import StatsRing from '~/components/statistics/StatsRing.vue'

defineOptions({ name: 'StatsVerdict' })

const props = defineProps<{ review: Review }>()
const { t } = useI18n()
const { formatNumber } = useLocaleFormat()

const pct = (value: number): number => Math.round(value)

const inTimeboxNow = computed(() => props.review.current.inTimeboxShare)
/** The tick exists only when there is a value now and a usual value to compare it with. */
const inTimeboxUsual = computed(() => (inTimeboxNow.value !== null && props.review.state === 'verdict' ? props.review.baseline.inTimeboxShare : null))
/** The ring needs a comparison: empty, quiet and thin (too little history) show none. */
const showRing = computed(() => props.review.state === 'verdict')
const ringSegments = computed(() => [{ value: inTimeboxNow.value ?? 0, step: 0 }])

const headline = computed(() => {
  const { state, verdict } = props.review
  return t(`statistics.verdict.headline.${state === 'verdict' && verdict ? verdict : state}`)
})

const line = computed(() => {
  const { state, current, baseline } = props.review
  if (state === 'empty') return t('statistics.verdict.line.empty')
  if (state === 'quiet') return t('statistics.verdict.line.quiet', { n: formatNumber(baseline.weeklyNorm ?? 0, { maximumFractionDigits: 1 }) })
  if (state === 'thin') return t('statistics.verdict.line.thin', { n: baseline.count, baselineDays: REVIEW.baselineDays, windowDays: REVIEW.windowDays, days: REVIEW.minBaselineDays, tasks: REVIEW.minBaselineTasks }, baseline.count)
  const n = current.count
  if (inTimeboxNow.value === null) return t('statistics.verdict.line.noTimebox', { n }, n)
  const share = pct(inTimeboxNow.value)
  return inTimeboxUsual.value === null
    ? t('statistics.verdict.line.noUsual', { n, share }, n)
    : t('statistics.verdict.line.full', { n, share, usual: pct(inTimeboxUsual.value) }, n)
})

const ringLabel = computed(() => {
  if (inTimeboxNow.value === null) return t('statistics.verdict.ring.labelNone')
  const share = pct(inTimeboxNow.value)
  return inTimeboxUsual.value === null
    ? t('statistics.verdict.ring.labelNoUsual', { share })
    : t('statistics.verdict.ring.label', { share, usual: pct(inTimeboxUsual.value) })
})
</script>
