<!--
@component IntroHintOverlay
@kind component
@category feedback
@description The intro notes' place (#725, base #800, #853): one note at a time in a sheet of note paper that floats at the bottom centre of the board page, above the phone's app bar. First the welcome (#853): a new user is told once what the board is, as a tour of three notes where cards already lie on "Heute" and as one note everywhere else, on "Heute" or "Alle". Then the step hints. A hint says what the next step of the day is at the moment that step is due ("Start": drag a card to Jetzt; "Weiter": the timer runs, drag the card on; "Auswahl": stack a long Offen; "Abschluss": close the day), and goes when the user does the step or closes it.
@usage <IntroHintOverlay /> once in pages/tasks.vue, after the board. Its styles are `assets/css/intro-hint.css`. Which hint shows, the pacing and what ends it live in `useIntroHints` and `lib/introHints.ts`; the record is `settings-store.introHints`. A new hint adds its id, its moment and its copy there, never a second overlay. The look is IntroNote.
@avoid Not a notice about the board's state (NewDayNote, NewDayTimeNote: they sit above the board and come first), not a toast (it has no timer and never vanishes while it is read), not a dialog or a tour step anchored at an element (the welcome tour is three notes in this one place, none points at an element), and not the planning note on "Alle" (BoardPlanNote: the hint "Planen", #803, which has its own place and shares this overlay's record and rules). Never two at once, never under an open task sheet, a step hint never on "Alle" (only the welcome shows there), never for a user who did not come through the welcome setup.
@responsibility
- One sheet of note paper (IntroNote, #853 D2 2A: it replaces the white sheet with the green tip icon of #725) with the overlay shadow (DESIGN.md "The Sheets Cast Shadows Rule"): icon, title, text, and the foot with the quiet link "Hinweise ausschalten" and the main button last ("Schließen"; "Karten stapeln" on "Auswahl", with "Schließen" as a link before it)
- The welcome (#853): which shape and text it has is `resolveIntroWelcome` (`lib/introHints.ts`) over the board, read through `useIntroHints().welcome`. One note: "Schließen", or "Aufgaben auswählen" (with the go-on arrow) when tasks wait only under "Alle", which ends the welcome and moves to "Alle". Tour: step dots at the start of the foot (decorative, with one visually hidden "Schritt n von 3"), "Überspringen" as a link and "Weiter" as the main button, "Loslegen" on the last note; the main button is one node across the steps, so keyboard focus stays on it. A tour that has started stays a tour until it is ended, even if the board changes under it. "Schließen", "Loslegen", "Überspringen", "Aufgaben auswählen" and "Hinweise ausschalten" each end the welcome for good; it keeps no quiet day. `{source}` in a text is the connected app's name
- `role="status"` on the host, which is mounted before the hint (while the user's hints are on): the text is announced politely when the hint arrives; it takes no focus and traps none
- Place: fixed at the bottom centre, 24 px above the window's edge on desktop, above the floating app bar on a phone (`--phone-bar-offset`, like the toaster); only the sheet takes pointer events, the strip beside it lets the board through. While it stands, `--intro-hint-height` on <html> holds its height and `--intro-hint-room` (intro-hint.css: height + its offset from the window's edge + a 16 px gap) is the room: a phone's column pages (ColumnDropZone, the last box of a page) and "Alle Aufgaben" end above the sheet; the desktop columns and their sticky buttons stay put and the sheet overlaps them (#881); the room goes as the fade-out starts, so sheet and board move together
- Layer `--z-hint`: above the board and the Jetzt focus overlay, below every sheet, dialog, menu and toast; a toast may cover it for its few seconds (accepted, #800)
- Text per width: the welcome's texts have a phone wording where the copy names a gesture or must be shorter; of the step hints "Start" differs: the desktop text names the drag to Jetzt, the phone text (`useIsPhone`) the hold and the drag to the right edge; the other hints have one text. "Auswahl" and "Abschluss" name "Mehr" and "Tag abschließen" through params (`nav.more`, `nav.dayClose`), so a renamed menu cannot leave the hint stale
- "Auswahl" carries one action, the soft button "Karten stapeln": it calls the Mehr panel's own action (`useBoardGrouping().setGroupingEnabled(true)`), so the two cannot differ; the hint ends through its step (stacking on), not through a second write, and focus goes to the board region as the button leaves
- Two controls end hints (#804, 2B): "Schließen" ends this hint, "Hinweise ausschalten" turns all hints off (`useIntroHintsSwitch().turnOff`: a toast confirms it and says where the intros can be read, Einstellungen, Board). Controls are 44 px high on a phone; they sit below the text at the end of the sheet at every width (beside it, three of them squeezed the text to a narrow column), wrapping on a phone. Focus goes to the board region when the focused link leaves, for either
- It fades in and out over `--duration-base` (opacity only, none under reduced motion)
- A day is stored for the hint once it is on screen and somebody can see it (`markShown`: page visible and window focused; the day is stored when the page comes back); "Schließen" ends it and keeps the rest of the day quiet, and keyboard focus goes to the board region when the focused link leaves, never to `<body>`
-->
<template>
  <!-- The status region is there before its text (a region inserted already filled is not announced everywhere); only for a
       user whose hints are on, so nobody else gets an empty region on the page -->
  <div v-if="active" class="intro-hint" role="status" data-testid="intro-hint-host">
    <Transition name="intro-hint" @before-leave="clearRoom">
      <div
        v-if="note"
        ref="sheet"
        class="intro-hint-sheet"
        data-testid="intro-hint"
        :data-hint="note.id"
        :data-step="tour ? step + 1 : undefined"
      >
        <IntroNote :icon="note.icon" :title="note.title" :text="note.text" class="shadow-(--shadow-overlay)">
          <template v-if="tour" #lead>
            <!-- Decorative dots; the position is said once, in words -->
            <span class="intro-note-steps" aria-hidden="true" data-testid="intro-hint-steps">
              <span v-for="n in tour.steps.length" :key="n" :data-on="n - 1 === step ? '' : undefined" />
            </span>
            <span class="sr-only">{{ t('board.welcome.tour.step', { n: step + 1, total: tour.steps.length }) }}</span>
          </template>
          <UButton color="neutral" variant="link" data-testid="intro-hint-off" @click="onTurnOff">
            {{ t('board.introHint.off') }}
          </UButton>
          <UButton v-if="note.id === 'auswahl'" color="neutral" variant="link" data-testid="intro-hint-close" @click="onClose">
            {{ t('board.introHint.close') }}
          </UButton>
          <!-- The pair wraps as one unit on a phone. One main button, the same node whatever it does: focus stays on it from
               "Weiter" to "Weiter" to "Loslegen" -->
          <span class="intro-note-pair">
            <UButton v-if="tour && !lastStep" color="neutral" variant="link" data-testid="intro-hint-skip" @click="onEndWelcome">
              {{ t('board.welcome.tour.skip') }}
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              :trailing-icon="main.icon"
              :data-testid="main.testId"
              @click="main.run"
            >
              {{ main.label }}
            </UButton>
          </span>
        </IntroNote>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo, useAppConfig } from 'nuxt/app'
import { useResizeObserver } from '@vueuse/core'
import IntroNote from '~/components/board/IntroNote.vue'
import { useHintOnScreen, useIntroHints } from '~/composables/useIntroHints'
import { useIsPhone } from '~/composables/useIsDesktop'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useIntroHintsSwitch } from '~/composables/useIntroHintsSwitch'
import { useBoardStore } from '~/store/board'
import { focusFirstAvailable } from '~/utils/focusRecovery'
import { boardPlaceLocation } from '~/lib/boardPlace'
import { integrationLabel } from '~/lib/taskSources'
import { INTRO_WELCOME_HINT, introHintTextKey, introHintTitleKey, type IntroWelcome } from '~/lib/introHints'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'IntroHintOverlay' })

const { t } = useI18n()
const appConfig = useAppConfig()
const { active, current, shownKey, markShown, close, welcome, welcomeLive, markWelcomeShown, endWelcome } = useIntroHints()
const isPhone = useIsPhone()
const { setGroupingEnabled } = useBoardGrouping()
const { turnOff } = useIntroHintsSwitch()
const boardStore = useBoardStore()
const sheet = ref<HTMLElement | null>(null)

// ── The welcome (#853) ────────────────────────────────────────────────────────
/** The tour's position; a tour that has started is kept (`startedTour`) even if the board stops asking for one. */
const step = ref(0)
const startedTour = ref<IntroWelcome | null>(null)
watch(welcome, (now) => {
  if (now?.shape === 'tour') startedTour.value = now
}, { immediate: true })
// `welcome` is null while a task sheet, a notice or the recap covers the board: the tour keeps its place then and only ends with the welcome itself
watch(welcomeLive, (live) => {
  if (live) return
  startedTour.value = null
  step.value = 0
}, { immediate: true })

/** The welcome as shown: the live one, or the tour that already began. */
const shownWelcome = computed<IntroWelcome | null>(() => {
  if (welcome.value === null) return null
  return welcome.value.shape === 'note' && startedTour.value ? startedTour.value : welcome.value
})
const tour = computed(() => (shownWelcome.value?.shape === 'tour' ? shownWelcome.value : null))
const lastStep = computed(() => tour.value !== null && step.value >= tour.value.steps.length - 1)

/** The connected app's name for the texts that name it. */
const sourceName = computed(() => {
  const source = boardStore.connectedIntegrations[0]
  return source ? integrationLabel(source) : ''
})

interface Note { id: string, icon: string, title: string, text: string }

const note = computed<Note | null>(() => {
  const shown = shownWelcome.value
  if (shown) {
    const copy = shown.steps[Math.min(step.value, shown.steps.length - 1)]!
    return {
      id: INTRO_WELCOME_HINT,
      icon: step.value === 0 ? ICONS.welcome : appConfig.ui.icons.tip,
      title: t(copy.titleKey),
      text: t(copy.textKey, { source: sourceName.value }),
    }
  }
  const id = current.value
  if (!id) return null
  // The key map is shared with the help in the settings; the menu names in "Auswahl" and "Abschluss" are read from the menus
  return {
    id,
    icon: appConfig.ui.icons.tip,
    title: t(introHintTitleKey(id)),
    text: t(introHintTextKey(id, isPhone.value), { more: t('nav.more'), dayClose: t('nav.dayClose') }),
  }
})

interface Main { label: string, testId: string, icon?: string, run: () => void }

/** The one main button of the note on screen. */
const main = computed<Main>(() => {
  const shown = shownWelcome.value
  if (shown?.shape === 'tour') {
    return lastStep.value
      ? { label: t('board.welcome.tour.start'), testId: 'intro-hint-next', run: onEndWelcome }
      : { label: t('board.welcome.tour.next'), testId: 'intro-hint-next', run: () => { step.value += 1 } }
  }
  if (shown?.toAll) return { label: t('board.welcome.underAll.action'), testId: 'intro-hint-all', icon: ICONS.goOn, run: onToAll }
  if (shown) return { label: t('board.introHint.close'), testId: 'intro-hint-close', run: onEndWelcome }
  if (current.value === 'auswahl') return { label: t('board.sync.stackCards'), testId: 'intro-hint-stack', run: onStack }
  return { label: t('board.introHint.close'), testId: 'intro-hint-close', run: onClose }
})

// On screen: the day counts for this note (once per day; the store ignores a repeat). Also when the day changes under a note that stays up.
// Only while somebody can see it: a hidden tab or a window left in the background keeps its midnight timer running, and a
// weekend with the app open must not use up the note's days. The day is stored when the page comes back.
const seen = useHintOnScreen()
watch([shownKey, seen], () => {
  if (!seen.value) return
  if (welcome.value) markWelcomeShown()
  else if (current.value) markShown(current.value)
}, { immediate: true })

/** The sheet's height for the scroll areas it floats over; `--intro-hint-room` (intro-hint.css) adds the sheet's offset and the gap. */
const HEIGHT = '--intro-hint-height'
useResizeObserver(sheet, ([entry]) => {
  if (entry) document.documentElement.style.setProperty(HEIGHT, `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})
function clearRoom() {
  document.documentElement.style.removeProperty(HEIGHT)
}
onBeforeUnmount(clearRoom)

/** A control that ends the note removes the button that holds focus: focus goes to the board region at once, never to <body> (the sheet stays in the DOM while it fades). */
function leaving(run: () => void) {
  const hadFocus = sheet.value?.contains(document.activeElement) ?? false
  run()
  if (hadFocus) focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}

/** "Schließen", "Loslegen", "Überspringen": the welcome ends for good, with what it already said. */
function onEndWelcome() {
  leaving(() => endWelcome(shownWelcome.value?.says))
}

/** "Aufgaben auswählen": the welcome ends and the board moves to "Alle", where the planning note takes over. */
function onToAll() {
  leaving(() => endWelcome(shownWelcome.value?.says))
  void navigateTo(boardPlaceLocation('all'))
}

/** "Karten stapeln": the same action as the Mehr panel's switch; the hint ends through its step, and the focused button leaves with it. */
function onStack() {
  leaving(() => setGroupingEnabled(true))
}

/** "Hinweise ausschalten": every note goes (the welcome for good, the host with it) and a toast says so. */
function onTurnOff() {
  leaving(() => {
    if (welcome.value) endWelcome([])
    turnOff()
  })
}

/** "Schließen" of a step hint: it ends, and the rest of the day stays quiet. */
function onClose() {
  leaving(close)
}
</script>
