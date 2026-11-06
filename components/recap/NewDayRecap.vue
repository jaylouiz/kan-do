<!--
@component NewDayRecap
@description "Kurzer Rückblick" (#385, #451): full-page recap on the first start of a new day, shown over the board instead of
landing on it. A still-open deck (left) and a done deck (right) like the board's Offen → Erledigt, and one submit panel with the
switch "Erledigte archivieren" and the button "Weiter zum Board".
@usage Mounted once in pages/tasks.vue next to DayCloseDialog; opened by useNewDayRecap().check() on mount.
@responsibility
- Shell: Teleport overlay on `bg-page` with `data-window-drag-layer` (its bar row drags the desktop window, lib/windowDrag.ts, #614), content centred on both axes (Welcome pattern), fade in/out (instant with reduced motion)
- The summary sentence from the snapshot (n of m, or all) with the day phrase (gestern, vorgestern, am Montag, am 14. Oktober)
- The decks never change size (RecapDeck), so nothing on the page moves; the overlay and its content clip horizontally (`overflow-x-clip`), a sliding card never widens the page
- The switch writes `day-recap-store.archiveDone` at once; the button and Escape both call `leave()`, which follows the switch
- Dialog semantics: role dialog, aria-modal, labelled by the headline; focus starts on the button and is trapped; the board behind is inert
- Submit panel: one surface (`bg-elevated` + ring), switch left and button right in a container query (`@md`), stacked when narrow; pinned to the bottom edge on phones
-->
<template>
  <Teleport to="body">
    <Transition name="recap" @after-leave="finishLeave">
      <div
        v-if="isOpen && snapshot"
        ref="rootRef"
        class="px-safe fixed inset-0 z-2050 overflow-x-hidden overflow-y-auto bg-page"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        data-testid="new-day-recap"
        data-window-drag-layer
      >
        <!-- overflow-x-clip: a sliding card is cut at the page edge and never adds scroll width (hidden alone still reports it) -->
        <div class="flex min-h-full items-center justify-center overflow-x-clip px-4 pt-14 pb-4 sm:px-6 sm:pb-24">
          <div class="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <h1
              :id="titleId"
              class="font-display tracking-display text-3xl leading-(--lh-tight) text-balance text-highlighted sm:text-4xl"
            >
              {{ t('recap.title') }}
            </h1>
            <p class="mt-3 text-lg text-toned" data-testid="recap-summary">{{ summary }}</p>

            <!-- Board order: Offen left, Erledigt right; stacked in the same order on phones -->
            <div class="mt-10 flex w-full flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-center sm:gap-16">
              <RecapDeck v-if="snapshot.undone.length > 0" kind="undone" :tasks="snapshot.undone" />
              <RecapDeck kind="done" :tasks="snapshot.done" />
            </div>

            <!-- Submit panel: switch left, button right; stacked when the panel is narrow. Phones: pinned to the bottom edge -->
            <div class="@container mt-10 w-full max-w-160 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:mt-6 max-sm:bg-page max-sm:pt-2 max-sm:pb-4">
              <div class="flex flex-col gap-4 rounded-2xl bg-elevated p-4 ring ring-default @md:flex-row @md:items-center @md:justify-between">
                <USwitch
                  v-model="archiveDone"
                  color="neutral"
                  size="lg"
                  :label="t('recap.archiveToggle')"
                  data-testid="recap-archive-toggle"
                />
                <UButton
                  size="lg"
                  color="primary"
                  trailing-icon="i-ph-arrow-right"
                  class="w-full justify-center @md:w-auto"
                  data-recap-primary
                  data-testid="recap-continue"
                  @click="leave"
                >
                  {{ t('recap.continue') }}
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RecapDeck from '~/components/recap/RecapDeck.vue'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useDayRecapStore } from '~/store/dayRecap'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { dayMonthName } from '~/utils/recapDay'
import { weekdayName } from '~/utils/doneDayLabel'

defineOptions({ name: 'NewDayRecap' })

const { t } = useI18n()
const { locale } = useLocaleFormat()
const { isOpen, snapshot, leave, finishLeave } = useNewDayRecap()
const recapStore = useDayRecapStore()

const titleId = `recap-title-${useId()}`
const rootRef = ref<HTMLElement | null>(null)

/** The switch writes straight to the store, so the choice survives a reload and the next recap. */
const archiveDone = computed({
  get: () => recapStore.archiveDone,
  set: (value: boolean) => recapStore.setArchiveDone(value),
})

const summary = computed(() => {
  const current = snapshot.value
  if (!current) return ''
  const { kind, date } = current.when
  const when = kind === 'weekday'
    ? t('recap.when.weekday', { weekday: weekdayName(date, locale.value) })
    : kind === 'date'
      ? t('recap.when.date', { date: dayMonthName(date, locale.value) })
      : t(`recap.when.${kind}`)
  const done = current.done.length
  const total = done + current.undone.length
  return done === total ? t('recap.summary.all', { when }) : t('recap.summary.partial', { when, n: done, m: total })
})

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focus starts on the button; the board behind is inert, so the trap only has to wrap Tab inside the page. */
watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  document.querySelector<HTMLElement>('[data-recap-primary]')?.focus({ preventScroll: true })
})

function onKeydown(event: KeyboardEvent) {
  if (!isOpen.value || event.defaultPrevented) return
  if (event.key === 'Escape') {
    event.preventDefault()
    leave()
    return
  }
  if (event.key !== 'Tab' || !rootRef.value) return
  const focusable = [...rootRef.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]'))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (!rootRef.value.contains(active)) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.recap-enter-active,
.recap-leave-active {
  transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
.recap-enter-from,
.recap-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .recap-enter-active,
  .recap-leave-active {
    transition: none;
  }
}
</style>
