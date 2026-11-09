<!--
@component NewDayRecap
@kind block
@category overlay
@description "Kurzer Rückblick" (#385, #451, #44): the recap on the first start of a new day, shown over the dimmed board. A still-open deck and a done deck like the board's Offen → Erledigt, and one submit panel with the switch "Erledigte archivieren" and the button "Weiter zum Board".
@usage Mounted once in pages/tasks.vue next to DayCloseDialog; opened by useNewDayRecap().check() on mount.
Hosted by ResponsiveOverlay (modal at >=768px with both decks side by side, bottom drawer below with a switcher that shows one deck at a time), the same shell as DayCloseDialog. The page itself never scrolls; only the body may, on very short windows.
@avoid Only the first start of a new day; closing the day is DayCloseDialog.
@responsibility
- Shell only: headline (title slot), summary (description slot), decks (body), submit panel (footer, pinned)
- Escape, scrim click, swipe down and the button all call `leave()`, which follows the switch (#44); the desktop close button is off
- Phone switcher ("n noch offen" / "n erledigt", `aria-pressed`): one RecapDeck mounted at a time, starts on "noch offen" (on "erledigt" when nothing is open, then without a switcher)
- The decks never change size (RecapDeck), so nothing moves while they are looked at
- The switch writes `day-recap-store.archiveDone` at once
- Dialog semantics, focus trap and the inert board: reka's dialog plus `pages/tasks.vue`; focus starts on the button, `finishLeave()` after the leave hands focus to the board
- Submit panel: switch left and button right in a container query (`@md`), stacked when narrow
-->
<template>
  <ResponsiveOverlay
    :open="isOpen && !!snapshot"
    :title="t('recap.title')"
    :close-button="false"
    :content-props="contentProps"
    :desktop-ui="DESKTOP_UI"
    :mobile-ui="MOBILE_UI"
    @update:open="handleOpenChange"
    @after-leave="finishLeave"
  >
    <template #title>
      <span class="font-display tracking-display text-2xl leading-(--lh-tight) text-balance text-highlighted sm:text-3xl">{{ t('recap.title') }}</span>
    </template>
    <template #description>
      <span class="text-base text-toned" data-testid="recap-summary">{{ summary }}</span>
    </template>
    <template #body="{ isDesktop }">
      <div v-if="snapshot">
        <!-- Phones: one deck at a time. Nothing open: only the done deck, no switcher -->
        <div v-if="!isDesktop && snapshot.undone.length > 0" class="mb-4 flex justify-center">
          <div class="inline-flex rounded-full bg-elevated p-1 ring ring-default" role="group" :aria-label="t('recap.switcher.label')">
            <button
              v-for="option in switcherOptions"
              :key="option.kind"
              type="button"
              class="min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              :class="shownKind === option.kind ? 'bg-default text-highlighted shadow-xs' : 'text-muted hover:text-default'"
              :aria-pressed="shownKind === option.kind"
              :data-testid="`recap-switch-${option.kind}`"
              @click="pickedKind = option.kind"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Board order: Offen left, Erledigt right -->
        <div class="flex w-full flex-col items-center gap-8 md:flex-row md:items-start md:justify-center md:gap-12">
          <RecapDeck
            v-if="snapshot.undone.length > 0 && (isDesktop || shownKind === 'undone')"
            kind="undone"
            :tasks="snapshot.undone"
            :hide-heading="!isDesktop"
          />
          <RecapDeck
            v-if="isDesktop || shownKind === 'done'"
            kind="done"
            :tasks="snapshot.done"
            :hide-heading="!isDesktop && snapshot.undone.length > 0"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <!-- Submit panel: switch left, button right; stacked when the panel is narrow -->
      <div class="@container w-full">
        <div class="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
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
            :trailing-icon="ICONS.goOn"
            class="w-full justify-center @md:w-auto"
            data-recap-primary
            data-testid="recap-continue"
            @click="leave"
          >
            {{ t('recap.continue') }}
          </UButton>
        </div>
      </div>
    </template>
  </ResponsiveOverlay>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RecapDeck from '~/components/recap/RecapDeck.vue'
import ResponsiveOverlay from '~/components/ui/ResponsiveOverlay.vue'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useDayRecapStore } from '~/store/dayRecap'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { MODAL_WIDTH } from '~/utils/modalSizes'
import { dayMonthName } from '~/utils/recapDay'
import { weekdayName } from '~/utils/doneDayLabel'

defineOptions({ name: 'NewDayRecap' })

const { t } = useI18n()
const { locale } = useLocaleFormat()
const { isOpen, snapshot, leave, finishLeave } = useNewDayRecap()
const recapStore = useDayRecapStore()

const DESKTOP_UI = {
  content: MODAL_WIDTH.lg,
  header: 'justify-center text-center',
  body: 'min-h-0 overflow-x-clip overflow-y-auto overscroll-contain',
}
const MOBILE_UI = {
  content: 'max-h-9/10',
  header: 'px-4 pb-2 text-center',
  body: 'min-h-0 overflow-x-clip overflow-y-auto overscroll-contain px-4 py-4',
  footer: 'border-t border-default p-4',
}

/** The switch writes straight to the store, so the choice survives a reload and the next recap. */
const archiveDone = computed({
  get: () => recapStore.archiveDone,
  set: (value: boolean) => recapStore.setArchiveDone(value),
})

/** Phone switcher: the user's pick; with nothing open the done deck is the only one. Reset on every open. */
const pickedKind = ref<'undone' | 'done'>('undone')
const shownKind = computed(() => (snapshot.value && snapshot.value.undone.length === 0 ? 'done' : pickedKind.value))
const switcherOptions = computed(() => [
  { kind: 'undone' as const, label: t('recap.deck.undone', { n: snapshot.value?.undone.length ?? 0 }) },
  { kind: 'done' as const, label: t('recap.deck.done', { n: snapshot.value?.done.length ?? 0 }) },
])

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

function focusPrimary() {
  document.querySelector<HTMLElement>('[data-recap-primary]')?.focus({ preventScroll: true })
}

/** ResponsiveOverlay forwards only real changes, so a `false` here is a dismissal (Escape, scrim, swipe): same as the button. */
const handleOpenChange = (value: boolean) => {
  if (!value) leave()
}

/** Focus starts on the button; `finishLeave()` returns it to the board, so the browser must not. */
const contentProps = {
  'data-testid': 'new-day-recap',
  onOpenAutoFocus: (event: Event) => {
    event.preventDefault()
    focusPrimary()
  },
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
}

watch(isOpen, async (open) => {
  if (!open) return
  pickedKind.value = 'undone'
  await nextTick()
  requestAnimationFrame(focusPrimary)
})
</script>
