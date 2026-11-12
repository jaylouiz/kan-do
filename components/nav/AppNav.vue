<!--
@component AppNav
@kind block
@category navigation
@description The global app bar (#470, ADR 017): the `kan-do` wordmark (outside any pill, #642), one pill with the two places (Heute, Statistik) plus, on a page behind ⋯, that page as a third segment (#583), then a separate round ⋯ pill that opens the Mehr panel
@usage Mounted once in app.vue before <NuxtLayout>, so it survives page transitions; hidden on routes with `appNav: false`
@avoid Mounted once in app.vue; secondary pages go behind MorePanel, in-page switching is not a job for the app bar.
@responsibility
- Brand (#642): the wordmark link sits first in the group, left of the pill and outside it, on the paper veil; DOM and tab order unchanged (brand, Heute, Statistik, third, ⋯). Not shown on a phone (kd#24: it has no backing and printed over the cards scrolling under the bar; Heute links to /tasks)
- Desktop (≥768px): sticky bar at the top, the group centred. Phone: the same pills float at the bottom (assets/css/app-nav.css)
- Look and separation from the content behind it (#615): the two pills are flat white sheets with the nav pill shadow (`--shadow-nav-pill`, the named exception of "The Sheets Cast Shadows Rule"), and a paper veil sits behind them (`.app-nav::before`, no pointer events, so the `.titlebar` drag strip and the page stay usable). The page header is not sticky, so the bar is the only thing that stays
- Selected state is a pure function of the route (useAppNav): Heute on /tasks*, Statistik on /statistics, the third segment (Papierkorb, Einstellungen) on /trash and /settings*. ⋯ is never selected and carries no aria-current. An open panel is an overlay, not a navigation: the place keeps its chip, ⋯ shows only a soft "open" fill and aria-expanded
- Third segment (#583): grows in the pill when a page behind ⋯ is entered, shrinks away when Heute or Statistik is chosen, re-measures when Einstellungen <-> Papierkorb. MorePanel leaves out the row of the page the pill shows. One 420 ms timeline (`--nav-move`, `--nav-ease` in app-nav.css, 0 under reduced motion) drives the segment and the phone segment padding; a retarget mid-move continues from the current width. The grey pill is content-sized, so its width follows the segment frame by frame on that same timeline (#616); the segment's left margin runs -gap -> 0 with it, so the pill's 1px flex gap does not step in at the first frame or out at the last. The move starts on the second animation frame after the route change, not at the DOM patch (#643): the first frame lays out and paints the new page and, on a slow main thread (WKWebView, a big board), can outlast the whole 420 ms, which left a timeline started before it already over (segment and pill jumped to the end). Until then the segment holds its start state by inline style, and the phone `has-third` class (padding transitions) flips with the move so all three share one start. Direct load and the first paint show the segment without motion
- One indicator (a fill, no shadow) behind the selected segment: two springs chase the live box of the `aria-current` segment (useNavIndicator, lib/navSpring.ts). `data-moving` on the nav is set until chip and layout are idle (E2E waits on it)
- A failing source puts a status dot on ⋯ (error for broken, else warning) and the accessible name says so; the panel explains it
- Tag abschließen: closes the panel, returns focus to ⋯, then opens the dialog, so the dialog's return target is ⋯ and not a removed row
- Phone: fades out and ignores pointers while a card is dragged (no drop target is covered); the pills and the veil fade
- The topic focus funnel (#161, BoardFocusTrigger) sits right of ⋯ on the board route only, outside the group's flow (`.app-nav-focus`), so the pills do not re-centre when it appears
- Desktop ⋯ tooltip "Mehr · Befehle ⌘K" on every page (the palette is mounted once in app.vue, #224); no tooltip on touch
-->
<template>
  <nav
    v-if="showsBar"
    ref="navEl"
    class="app-nav"
    :class="{ 'is-dragging': dragState.isDragging, 'has-third': folded }"
    :aria-label="t('nav.label')"
    :data-moving="moving ? 'true' : undefined"
    data-app-nav
    data-testid="app-nav"
  >
    <div class="app-nav-group">
      <NuxtLink to="/tasks" custom>
        <template #default="{ href, navigate }">
          <a :href="href ?? undefined" class="app-nav-brand" :aria-label="t('nav.brand')" data-testid="app-nav-brand" @click="navigate"><span class="app-nav-brand-text">{{ t('nav.brand') }}</span></a>
        </template>
      </NuxtLink>
      <div ref="pillEl" class="app-nav-pill">
        <span ref="indicatorEl" class="app-nav-indicator" aria-hidden="true" />
        <NuxtLink to="/tasks" custom>
          <template #default="{ href, navigate }">
            <a
              :href="href ?? undefined"
              class="app-nav-place"
              :class="{ 'is-selected': currentPlace === 'board' }"
              :aria-current="currentPlace === 'board' ? 'page' : undefined"
              data-testid="app-nav-place-board"
              @click="navigate"
            >{{ t('nav.today') }}</a>
          </template>
        </NuxtLink>
        <NuxtLink to="/statistics" custom>
          <template #default="{ href, navigate }">
            <a
              :href="href ?? undefined"
              class="app-nav-place"
              :class="{ 'is-selected': currentPlace === 'statistics' }"
              :aria-current="currentPlace === 'statistics' ? 'page' : undefined"
              data-testid="app-nav-place-statistics"
              @click="navigate"
            >{{ t('nav.statistics') }}</a>
          </template>
        </NuxtLink>
        <div v-if="shownThird" ref="thirdEl" class="app-nav-third" :inert="leaving || undefined" data-testid="app-nav-third">
          <NuxtLink :to="shownThird.to" custom>
            <template #default="{ href, navigate }">
              <a
                :href="href ?? undefined"
                class="app-nav-place app-nav-third-link"
                :class="{ 'is-selected': thirdItem !== null }"
                :aria-current="thirdItem !== null ? 'page' : undefined"
                data-testid="app-nav-place-more"
                @click="navigate"
              ><span class="app-nav-third-label">{{ t(shownThird.labelKey) }}</span></a>
            </template>
          </NuxtLink>
        </div>
      </div>

      <UPopover
        v-model:open="open"
        :content="{ side: isPhone ? 'top' : 'bottom', align: isPhone ? 'end' : 'center', sideOffset: 8, collisionPadding: 8 }"
      >
        <UTooltip :open="tipOpen" :text="tooltipText" :kbds="tooltipKbds" :disabled="isPhone || open" @update:open="onTipOpen">
          <button
            ref="moreEl"
            type="button"
            class="app-nav-more"
            :class="{ 'is-open': open }"
            :aria-label="worstProblem ? t('nav.moreProblem') : t('nav.more')"
            data-testid="app-nav-more"
            @blur="tipHeldBack = false"
            @pointermove="tipHeldBack = false"
            @pointerleave="tipHeldBack = false"
          >
            <UChip :show="worstProblem !== null" size="lg" color="error" :ui="{ base: dotTone }" inset>
              <UIcon name="i-ph-dots-three-bold" class="app-nav-more-icon" aria-hidden="true" />
            </UChip>
          </button>
        </UTooltip>
        <template #content>
          <MorePanel @close="open = false" @day-close="closeAndOpenDayClose" @commands="closeAndOpenCommands" />
        </template>
      </UPopover>

      <!-- The topic focus funnel (#161): beside the group, so the pills stay centred whether it shows or not -->
      <div v-if="currentPlace === 'board'" class="app-nav-focus">
        <BoardFocusTrigger />
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { openCommandPalette } from '~/composables/useCommandPalette'
import MorePanel from '~/components/nav/MorePanel.vue'
import BoardFocusTrigger from '~/components/board/BoardFocusTrigger.vue'
import { useAppNav, useLiveRoute, type ThirdItem } from '~/composables/useAppNav'
import { useNavIndicator } from '~/composables/useNavIndicator'
import { cssTimeMs } from '~/lib/navSpring'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { useDayClose } from '~/composables/useDayClose'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { BREAKPOINT_QUERIES } from '~/lib/breakpoints';

defineOptions({ name: 'AppNav' })

const { t } = useI18n()
const route = useLiveRoute()
const { showsBar, currentPlace, thirdItem } = useAppNav()
const { dragState } = useBoardDragState()
const { open: openDayClose } = useDayClose()
const boardStore = useBoardStore()
const health = useIntegrationHealthStore()

const open = ref(false)
const moreEl = ref<HTMLButtonElement | null>(null)
/**
 * ⋯ tooltip (kd#40): closing the panel returns focus to ⋯, and a focus-open tooltip would then sit on the page the
 * chosen row just opened. After a close the tooltip stays held back until ⋯ loses focus or the pointer moves over or leaves it.
 */
const tipOpen = ref(false)
const tipHeldBack = ref(false)
function onTipOpen(next: boolean) {
  tipOpen.value = next && !tipHeldBack.value
}
watch(open, (isOpen) => {
  if (isOpen) { tipOpen.value = false } else { tipHeldBack.value = true; tipOpen.value = false }
})
/** Phone layout: no hover (no tooltip) and the panel opens upward from the bottom bar */
const isPhone = useMediaQuery(BREAKPOINT_QUERIES.phone)

// The ⋯ tooltip teaches the palette on every page: CommandPalette is mounted in app.vue next to the bar (#224)
const tooltipKbds = ['meta', 'k']
const tooltipText = computed(() => t('nav.moreWithCommands', { commands: t('nav.commands') }))

// A source that cannot sync stays visible on ⋯ (the dock's sync icon is gone); a healthy sync is silent
const worstProblem = computed(() => health.problemsOf(boardStore.connectedIntegrations)[0] ?? null)
// The 500 step of error and warning is below 3:1 (WCAG 1.4.11): the dot takes the 700 step
const dotTone = computed(() => (worstProblem.value?.status === 'broken' ? 'bg-error-700' : 'bg-warning-700'))

// A route change closes the panel (a row that stays on the same route closes it itself)
watch(() => route.value.fullPath, () => { open.value = false })

// ── Third segment and indicator (#583) ──
const navEl = ref<HTMLElement | null>(null)
const pillEl = ref<HTMLElement | null>(null)
const indicatorEl = ref<HTMLElement | null>(null)
const thirdEl = ref<HTMLElement | null>(null)

/** Fallback when the stylesheet is not there (unit tests); app-nav.css owns the value (0ms under reduced motion) */
const MOVE_MS_FALLBACK = 420
const MOVE_EASE_FALLBACK = 'cubic-bezier(.2,.7,.2,1)'
const cssVar = (name: string) => (navEl.value ? getComputedStyle(navEl.value).getPropertyValue(name).trim() : '')
/** Length of one layout move in ms; 0 = reduced motion */
function motionMs(): number {
  const ms = cssTimeMs(cssVar('--nav-move'))
  return Number.isNaN(ms) ? MOVE_MS_FALLBACK : ms
}

const indicator = useNavIndicator({ pill: pillEl, indicator: indicatorEl, motionMs })
const { moving } = indicator

/** The segment on screen: outlives `thirdItem` while it shrinks away, label and target follow `thirdItem` otherwise */
const shownThird = ref<ThirdItem | null>(thirdItem.value)
/** Phone segment padding (app-nav.css): flips at the START of a move, both ways */
const folded = ref(thirdItem.value !== null)
const leaving = computed(() => thirdItem.value === null && shownThird.value !== null)

let thirdAnim: Animation | null = null
/** Bumped per move: a wait for the first frame that was overtaken by a retarget must not start its move */
let moveToken = 0

interface ThirdState {
  width: number
  opacity: number
  /** Left margin in px: -gap while the segment is not there, 0 when it is */
  margin: number
}

/** The pill's flex gap in px: the 1px a mounted segment adds between itself and its neighbour */
function pillGap(): number {
  return pillEl.value ? Number.parseFloat(getComputedStyle(pillEl.value).columnGap) || 0 : 0
}

/** Width, opacity and margin of the third segment right now (mid-animation values included) */
function snapshotThird(): ThirdState | null {
  const el = thirdEl.value
  if (!el) return null
  const style = getComputedStyle(el)
  return { width: el.getBoundingClientRect().width, opacity: Number.parseFloat(style.opacity), margin: Number.parseFloat(style.marginLeft) || 0 }
}

/** Two animation frames: the first one lays out and paints the page the route change just mounted (it can take
 * hundreds of ms), the second one is the first light frame after it */
function afterHeavyFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Animate the third segment from `from` to its natural width ('natural') or to nothing ('gone'). A running move is
 * cancelled first, so a retarget continues from where the segment is. Null without motion (reduced motion, no WAAPI).
 * The pill is as wide as its content, so its width follows this one animation on the same timeline (#616). The
 * segment's left margin runs from -gap to 0 with it, so the pill's flex gap does not step in at the first frame and
 * out at the last: at width 0 the segment takes no room at all.
 */
function moveThird(to: 'natural' | 'gone', from: ThirdState): Animation | null {
  const el = thirdEl.value
  thirdAnim?.cancel()
  thirdAnim = null
  const ms = motionMs()
  if (!el || ms === 0 || typeof el.animate !== 'function') return null
  const naturalWidth = to === 'gone' ? 0 : el.getBoundingClientRect().width
  thirdAnim = el.animate(
    [
      { width: `${from.width}px`, opacity: from.opacity, marginLeft: `${from.margin}px` },
      { width: `${naturalWidth}px`, opacity: to === 'gone' ? 0 : 1, marginLeft: `${to === 'gone' ? -pillGap() : 0}px` },
    ],
    { duration: ms, easing: cssVar('--nav-ease') || MOVE_EASE_FALLBACK, fill: to === 'gone' ? 'forwards' : 'none' },
  )
  return thirdAnim
}

/** Holds the segment at `state` by inline style until its move starts (cleared by `releaseHold`) */
function holdThird(state: ThirdState) {
  const el = thirdEl.value
  if (!el) return
  el.style.width = `${state.width}px`
  el.style.opacity = String(state.opacity)
  el.style.marginLeft = `${state.margin}px`
}

function releaseHold() {
  const el = thirdEl.value
  if (!el) return
  for (const property of ['width', 'opacity', 'margin-left']) el.style.removeProperty(property)
}

watch(thirdItem, async (item, previous) => {
  // No bar on screen (or just mounting): nothing to animate, show the final state
  if (!showsBar.value || !navEl.value) {
    releaseHold()
    shownThird.value = item
    folded.value = item !== null
    return
  }
  const token = ++moveToken
  const before = snapshotThird()
  indicator.begin()
  const wasMounted = shownThird.value !== null
  const animated = motionMs() > 0 && typeof Element.prototype.animate === 'function'
  // A move still running is stopped where it is: a running animation beats the inline hold, so left alone it would
  // keep going through the wait below and the new move would then start from a width the segment already left
  if (animated && before && thirdAnim) {
    holdThird(before)
    thirdAnim.cancel()
    thirdAnim = null
  }
  // The phone padding is a CSS transition, which start on the frame that sees the class change:
  // with motion they flip together with the segment's move (below), so all three share one start
  if (!animated) folded.value = item !== null
  if (item) shownThird.value = item
  await nextTick()
  const from: ThirdState | null = item ? (wasMounted && before ? before : { width: 0, opacity: 0, margin: -pillGap() }) : before
  // #643: the move waits for the first frame after the route change. That frame lays out and paints the new page; on
  // a slow main thread (WKWebView, a big board) it takes longer than the 420 ms move, and a timeline that starts
  // before it is over by the time the frame is on screen: the segment and the pill jump to the end. Until then the
  // segment holds its start state.
  if (animated && from) {
    if (item) holdThird(from)
    // Einstellungen <-> Papierkorb only swaps the label: the chip stays on the held segment and nothing animates until
    // the move starts, so a loop started now would settle and drop `moving` (set by `begin`) for a frame
    if (!(item && previous)) indicator.follow()
    await afterHeavyFrame()
    if (token !== moveToken) return
  }
  releaseHold()
  folded.value = item !== null
  if (item) {
    moveThird('natural', from ?? { width: 0, opacity: 0, margin: -pillGap() })
  } else {
    const anim = from ? moveThird('gone', from) : null
    if (anim) anim.finished.then(() => { if (thirdItem.value === null) shownThird.value = null }).catch(() => { /* retargeted: the new move owns the segment */ })
    else shownThird.value = null
  }
  indicator.follow()
})

// Heute <-> Statistik moves the chip without any layout change
watch(currentPlace, async () => {
  await nextTick()
  indicator.follow()
})

watch(showsBar, async (shown) => {
  if (!shown) return
  await nextTick()
  indicator.jump()
})

onMounted(() => { void nextTick(() => indicator.jump()) })
onBeforeUnmount(() => { moveToken++; thirdAnim?.cancel() })

/** The dialog stores the focused element as its return target: close the panel and put focus on ⋯ first */
async function closeAndOpenDayClose() {
  open.value = false
  await nextTick()
  moreEl.value?.focus({ preventScroll: true })
  openDayClose()
}

/** Same hand-over for the command palette; it refuses to open while another dialog (the closing popover) is in the DOM */
async function closeAndOpenCommands() {
  open.value = false
  await nextTick()
  moreEl.value?.focus({ preventScroll: true })
  for (let i = 0; i < 30 && document.querySelector('[data-testid="more-panel"]'); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  openCommandPalette()
}
</script>
