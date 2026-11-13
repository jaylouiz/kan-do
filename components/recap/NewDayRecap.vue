<!--
@component NewDayRecap
@kind block
@category overlay
@description "Kurzer Rückblick" (#385, #451, #44, #245): the recap on the first start of a new day, shown as a stage on the welcome photo, behind the app bar, instead of a dialog over the board. A still-open deck and a done deck like the board's Offen → Erledigt, and one submit panel with the switch "Erledigte archivieren" and the button "Weiter zum Board".
@usage Mounted once in pages/tasks.vue next to DayCloseDialog; opened by useNewDayRecap().check() on mount.
One centred paper sheet (max 44rem, like the welcome sheet) with both decks side by side from 768px, one deck with a switcher below. The page itself never scrolls; only the stage's scroll area may, on very short windows.
@avoid Only the first start of a new day; closing the day is DayCloseDialog.
@responsibility
- Shell only: headline (the title, the theme's 18 px dialog title, kd#179), summary, decks (body), submit panel
- Not modal (#245), teleported to `#recap-stage-host` (app.vue) so the inert board does not take it along and the bar stays above it: a `role="region"` named by the headline, no scrim, no focus trap. The app bar stays usable and sits above the stage (`--z-bar`); the board is `inert` behind it (`pages/tasks.vue`). Going to settings and coming back finds the same recap, because the state lives in `useNewDayRecap`
- Focus starts on the button; Escape inside the stage, and the button, call `leave()` which follows the switch (#44); `finishLeave()` after the curtain hands focus to the board
- Curtain (assets/css/recap-stage.css): `leave()` runs at once (archive, marker, the board is live), the stage stays mounted while the sheet fades (200 ms) and only the photo slides up (700 ms, ease in-out) with a feathered edge; reduced motion: instant. A second click or Escape during the curtain does nothing
- The photo is the welcome page's (`public/welcome`), decoration only (`alt=""`); until it loads, or if it fails, the layer is the paper colour
- Phone switcher ("n noch offen" / "n erledigt", a `UTabs` pill: `role="tab"`, `aria-selected`): one RecapDeck mounted at a time, starts on "noch offen" (on "erledigt" when nothing is open, then without a switcher)
- The decks never change size (RecapDeck), so nothing moves while they are looked at
- The switch writes `day-recap-store.archiveDone` at once
- Submit panel: switch left and button right in a container query (`@md`), stacked when narrow
-->
<template>
  <!-- Outside the inert board (<main> in pages/tasks.vue), in app.vue's host: the same stacking context as the app bar, so the bar paints above the photo (#262) -->
  <Teleport to="#recap-stage-host" defer>
    <div
      v-if="shown"
      class="recap-stage"
      role="region"
      :aria-labelledby="titleId"
      :data-closing="closing || undefined"
      :inert="closing || undefined"
      data-testid="new-day-recap"
      data-window-drag-layer
      @keydown.esc="leaveOnce"
    >
      <!-- Atmosphere only; the layer is the paper colour until the photo has loaded (or if it never does) -->
      <div class="recap-stage__photo bg-page" aria-hidden="true">
        <img
          src="/welcome/desk-1672.webp"
          srcset="/welcome/desk-800.webp 800w, /welcome/desk-1672.webp 1672w"
          sizes="100vw"
          alt=""
          decoding="async"
          data-testid="recap-photo"
          class="size-full object-cover transition-opacity duration-(--duration-slow) motion-reduce:transition-none"
          :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
          @load="photoLoaded = true"
        >
      </div>
      <div class="recap-stage__scroll">
        <div class="recap-stage__sheet">
          <div class="mb-5 text-center">
            <h2 :id="titleId" class="text-lg font-semibold text-highlighted" data-slot="title">{{ t('recap.title') }}</h2>
            <p class="mt-1 text-body text-toned" data-testid="recap-summary">{{ summary }}</p>
          </div>
          <div v-if="snapshot">
            <!-- Phones: one deck at a time. Nothing open: only the done deck, no switcher -->
            <div v-if="!isDesktop && snapshot.undone.length > 0" ref="switcherWrap" class="mb-4 flex justify-center">
              <UTabs
                :model-value="shownKind"
                :items="switcherOptions"
                :content="false"
                variant="pill"
                data-testid="recap-switcher"
                @update:model-value="pickedKind = $event === 'done' ? 'done' : 'undone'"
              />
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
          <!-- Submit panel: switch left, button right; stacked when the panel is narrow -->
          <div class="mt-6 border-t border-default pt-4">
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
                  @click="leaveOnce"
                >
                  {{ t('recap.continue') }}
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import RecapDeck from '~/components/recap/RecapDeck.vue'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useDayRecapStore } from '~/store/dayRecap'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { useIsDesktop } from '~/composables/useIsDesktop'
import { dayMonthName } from '~/utils/recapDay'
import { weekdayName } from '~/utils/doneDayLabel'

defineOptions({ name: 'NewDayRecap' })

const { t } = useI18n()
const { locale } = useLocaleFormat()
const { isOpen, snapshot, leave, finishLeave } = useNewDayRecap()
const recapStore = useDayRecapStore()

/** The switch writes straight to the store, so the choice survives a reload and the next recap. */
const archiveDone = computed({
  get: () => recapStore.archiveDone,
  set: (value: boolean) => recapStore.setArchiveDone(value),
})

/** Phone switcher: the user's pick; with nothing open the done deck is the only one. Reset on every open. */
const pickedKind = ref<'undone' | 'done'>('undone')
// UTabs puts attrs on its root div, not on the role="tablist" element, so the name is set on the list itself.
const switcherWrap = ref<HTMLElement | null>(null)
watchEffect(() => {
  const label = t('recap.switcher.label')
  switcherWrap.value?.querySelector('[role="tablist"]')?.setAttribute('aria-label', label)
}, { flush: 'post' })

const shownKind = computed(() => (snapshot.value && snapshot.value.undone.length === 0 ? 'done' : pickedKind.value))
// The 44 px phone hit area rides on each item's own `ui` (a part placement, not a call-site :ui override).
const switcherTrigger = { trigger: 'touch-target px-4' }
const switcherOptions = computed(() => [
  { value: 'undone' as const, label: t('recap.deck.undone', { n: snapshot.value?.undone.length ?? 0 }), ui: switcherTrigger },
  { value: 'done' as const, label: t('recap.deck.done', { n: snapshot.value?.done.length ?? 0 }), ui: switcherTrigger },
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

const titleId = useId()
const isDesktop = useIsDesktop()
const photoLoaded = ref(false)
/** The curtain is running: `leave()` already closed the recap, the stage stays until the photo is off. */
const closing = ref(false)
const shown = computed(() => (isOpen.value || closing.value) && !!snapshot.value)
let curtainTimer: ReturnType<typeof setTimeout> | undefined

/** Only the photo's own slide ends the curtain: its image's opacity fade bubbles up here too. */
function onPhotoEnd(event: Event) {
  if (event.target === event.currentTarget && (event as TransitionEvent).propertyName === 'transform') endCurtain()
}

function endCurtain() {
  if (!closing.value) return
  clearTimeout(curtainTimer)
  closing.value = false
  finishCurtain()
}

/** Focus goes back to the board only if it was on the stage (or nowhere); a sheet or control the user opened meanwhile keeps it. */
function finishCurtain() {
  const active = document.activeElement
  const stage = document.querySelector('[data-testid="new-day-recap"]')
  const keep = active && active !== document.body && !stage?.contains(active)
  finishLeave({ restoreFocus: !keep })
}

/** The button and Escape: close the recap at once (archive, marker, live board), then let the curtain play. Not repeatable. */
function leaveOnce() {
  if (closing.value || !isOpen.value) return
  const stage = document.querySelector<HTMLElement>('[data-testid="new-day-recap"]')
  leave()
  if (isOpen.value) return // nothing to leave (no snapshot)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!stage || reduced) {
    finishCurtain()
    return
  }
  closing.value = true
  // Wait for the photo's own transition; the timer (its duration read from the CSS) is the net if it never ends.
  const wait = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--recap-curtain-duration')) || 0
  curtainTimer = setTimeout(endCurtain, wait + 100)
  stage.querySelector('.recap-stage__photo')?.addEventListener('transitionend', onPhotoEnd)
}

onBeforeUnmount(() => {
  clearTimeout(curtainTimer)
  if (closing.value) finishCurtain()
})

// `immediate`: coming back from settings remounts the stage with `isOpen` already true
watch(isOpen, async (open) => {
  if (!open || typeof window === 'undefined') return
  pickedKind.value = 'undone'
  await nextTick()
  requestAnimationFrame(focusPrimary)
}, { immediate: true })
</script>
