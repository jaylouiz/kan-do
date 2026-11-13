<!--
@component DayCloseSummary
@kind component
@category display
@description Top of the closing sheet (#237): the date, the headline ("n von n geplanten Aufgaben erledigt", or "Alle Aufgaben erledigt" with a green trophy when nothing is left open), the total time and a thin time-box bar with its caption.
@usage <DayCloseSummary :done="done" :open-count="open.length" :total-seconds="seconds" /> at the top of DayCloseBody. Planned = done today + still open (Offen, Jetzt, Wartet).
@avoid Not a chart for the Statistik page (StatsTile, StatsVerdict) and not a list of tasks; the rows are ListRow in DayCloseBody.
@responsibility
- Headline from the counts; nothing done and nothing open: the quiet "nothing done" line only, no numbers, no bar
- Bar: one segment per done task that has a time box and tracked time, length = the larger of spent and box, filled part = time inside the box, dark tail = overrun, the rest of the track = time under the box; above 10 boxed tasks one aggregated segment (`timeBoxBar`)
- The bar is decorative (`aria-hidden`): its caption "k von n Timeboxen eingehalten" is the text, the rows carry the per-task facts; no bar without a boxed task
- Total time only when time was tracked; the date is read when the sheet mounts (stable across midnight)
-->
<template>
  <div>
    <p class="text-sm text-muted" data-testid="day-close-date">{{ date }}</p>
    <p v-if="isEmpty" class="mt-1 text-body text-toned" data-testid="day-close-headline">{{ t('dayClose.nothingDone') }}</p>
    <template v-else>
      <div class="mt-1 flex items-center gap-2.5">
        <UIcon v-if="allDone" name="i-ph-trophy-fill" class="size-6 shrink-0 text-primary" aria-hidden="true" data-testid="day-close-trophy" />
        <SectionHeader tag="h3" size="headline" data-testid="day-close-headline">{{ headline }}</SectionHeader>
      </div>
      <SectionHeader v-if="totalSeconds > 0" tag="p" size="display" class="mt-2 tabular-nums" data-testid="day-close-total">
        <span class="sr-only">{{ t('dayClose.totalLabel') }}: </span>{{ formatDuration(totalSeconds, 'spaced') }}
      </SectionHeader>
      <div v-if="bar.total > 0" class="mt-4" data-testid="day-close-bar">
        <div class="flex h-2.5 gap-1" aria-hidden="true">
          <div
            v-for="segment in bar.segments"
            :key="segment.key"
            class="flex h-full overflow-hidden rounded-full bg-primary/15"
            :style="{ flexGrow: segment.weight }"
            data-testid="day-close-bar-segment"
          >
            <span class="h-full bg-primary" :style="{ width: `${segment.filled * 100}%` }" />
            <span v-if="segment.overrun > 0" class="h-full bg-inverted" :style="{ width: `${segment.overrun * 100}%` }" data-testid="day-close-bar-overrun" />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted" data-testid="day-close-bar-caption">{{ t('dayClose.boxCaption', { kept: bar.kept, total: bar.total }, bar.total) }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { timeBoxBar } from '~/utils/dayClose'
import type { Task } from '~/types/task'

defineOptions({ name: 'DayCloseSummary' })

interface Props {
  /** Tasks completed today. */
  done: readonly Task[]
  /** Offen, Jetzt and Wartet tasks: the rest of the plan. */
  openCount: number
  totalSeconds: number
}

const props = defineProps<Props>()

const { t } = useI18n()
const { locale, formatDuration } = useLocaleFormat()

// Captured when the sheet mounts (it mounts on open): stable while it is open, even across midnight.
const date = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }).format(openedAt))
const openedAt = new Date()

const planned = computed(() => props.done.length + props.openCount)
const isEmpty = computed(() => planned.value === 0)
const allDone = computed(() => props.done.length > 0 && props.openCount === 0)
const headline = computed(() =>
  allDone.value
    ? t('dayClose.allDone')
    : t('dayClose.headline', { done: props.done.length, planned: planned.value }, planned.value),
)
const bar = computed(() => timeBoxBar(props.done))
</script>
