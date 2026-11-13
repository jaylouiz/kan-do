<!--
@component DayCloseBody
@kind block
@category display
@description Scrolling content of the closing sheet (#98, #237): the day in one look (date, headline, total time, time-box bar), what got done today, and what stays on the board for tomorrow.
@usage Hosted by DayCloseDialog (modal and drawer share it). Reads the local cache only; a sync that lands while it is open updates the lists in place.
@avoid Not standalone: hosted by DayCloseDialog (modal and drawer share it); the start-of-day look back is NewDayRecap.
@responsibility
- DayCloseSummary on top, then today's done tasks as DayCloseTaskRow (no archived, nothing from earlier days)
- "Für morgen": one sentence with the number of tasks that stay, and a native `<details>` ("Offene Aufgaben anzeigen") with one DayCloseOpenRow and checkbox per Offen, Jetzt or Wartet task, all selected by default; nothing open: one quiet line, no section
- The choice lives in useDayClose (deselected ids, cleared on open); only "Fertig" acts on it (trash for a deselected task, Jetzt back to Offen otherwise)
- The sheet scrolls as one, there is no inner scroll area; opening the list scrolls its header to the top; no motivation sentence
-->
<template>
  <div class="flex flex-col gap-7">
    <DayCloseSummary :done="done" :open-count="inFlight.length" :total-seconds="totalSeconds" />

    <ul
      v-if="done.length > 0"
      class="divide-y divide-default"
      :aria-label="t('dayClose.doneListLabel', { n: done.length }, done.length)"
    >
      <DayCloseTaskRow v-for="task in done" :key="task.id" :task="task" />
    </ul>

    <section v-if="inFlight.length > 0" :aria-labelledby="tomorrowHeadingId" data-testid="day-close-tomorrow-section">
      <SectionHeader :id="tomorrowHeadingId" tag="h3" size="sub">{{ t('dayClose.tomorrowHeading') }}</SectionHeader>
      <p class="mt-1 text-body text-toned" data-testid="day-close-tomorrow">{{ t('dayClose.tomorrow', { n: keptCount }, keptCount) }}</p>
      <details class="group mt-2" data-testid="day-close-open-details" @toggle="revealList">
        <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm text-toned focus-ring">
          <UIcon :name="ICONS.forward" class="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
          {{ t('dayClose.showOpen') }}
        </summary>
        <ul class="mt-1 divide-y divide-default" :aria-label="t('dayClose.openListLabel')">
          <DayCloseOpenRow
            v-for="task in inFlight"
            :key="task.id"
            :task="task"
            :kept="isKept(task.id)"
            @update:kept="setKept(task.id, $event)"
          />
        </ul>
      </details>
    </section>
    <p v-else-if="done.length > 0" class="text-body text-toned" data-testid="day-close-nothing-open">{{ t('dayClose.nothingInFlight') }}</p>
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ICONS } from '~/lib/icons'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDayClose, useDayCloseData } from '~/composables/useDayClose'
import DayCloseOpenRow from '~/components/board/DayCloseOpenRow.vue'
import DayCloseSummary from '~/components/board/DayCloseSummary.vue'
import DayCloseTaskRow from '~/components/board/DayCloseTaskRow.vue'

defineOptions({ name: 'DayCloseBody' })

const { t } = useI18n()
const { done, totalSeconds, inFlight } = useDayCloseData()
const { isKept, setKept } = useDayClose()

const tomorrowHeadingId = useId()

/** Opening the list brings its header to the top of the scrolling sheet: on a phone the rows would otherwise sit below the fold. */
function revealList(event: Event) {
  const details = event.target as HTMLDetailsElement
  if (details.open) details.scrollIntoView({ block: 'start' })
}

/** Open tasks that carry on to tomorrow: every one that is not deselected. */
const keptCount = computed(() => inFlight.value.filter(task => isKept(task.id)).length)
</script>
