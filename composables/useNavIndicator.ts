/**
 * @composable useNavIndicator
 * @description The one moving indicator of the app bar's pill (#583): the raised white chip behind the selected
 * segment. It is two springs (`lib/navSpring.ts`) that chase the live box of the segment marked
 * `aria-current="page"`, every frame, so it stays glued to its target while the layout moves under it (the third
 * segment growing, the brand folding).
 * @usage `const { moving, follow, jump } = useNavIndicator({ pill, indicator, motionMs })`; call `follow()` after
 * the DOM of a route change has updated, `jump()` for first paint.
 * @responsibility
 * - Measures the selected segment relative to the pill's padding box; no segment selected hides the chip
 * - `follow`: springs towards the target (a stretch in the direction of travel); `jump`: sits on the target at once
 *   (first paint, direct load, reduced motion). With `motionMs() === 0` (reduced motion) `follow` jumps too
 * - The rAF loop runs only while an edge is off target or something in the pill still animates
 *   (`getAnimations({ subtree: true })`: the segment, the brand fold, the padding), and stops when idle and on unmount
 * - A ResizeObserver on the pill re-places the chip when the layout changes without a move (resize, font load)
 * - Runs from `onMounted` and watchers only (the app is `ssr: false`); the jsdom unit tests lack WAAPI and degrade to a jump
 * - `moving`: true from the start of a move until the chip and the layout are idle (the E2E signal `data-moving`)
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { directionOf, isSettled, MAX_DT, rubberStep, snapTo, type Box, type Rubber } from '~/lib/navSpring'

interface Options {
  pill: Ref<HTMLElement | null>
  indicator: Ref<HTMLElement | null>
  /** Length of the layout move in ms; 0 = reduced motion (no springs, no animation) */
  motionMs: () => number
}

export function useNavIndicator({ pill, indicator, motionMs }: Options) {
  const moving = ref(false)
  const state: Rubber = { left: { x: 0, v: 0 }, right: { x: 0, v: 0 } }
  let dir: 1 | -1 = 1
  let rafId = 0
  let lastT = 0
  let placed = false
  let observer: ResizeObserver | null = null

  /** The selected segment's box relative to the pill's padding box, or null when nothing is selected */
  function targetBox(): Box | null {
    const pillEl = pill.value
    const selected = pillEl?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!pillEl || !selected) return null
    const base = pillEl.getBoundingClientRect().left + pillEl.clientLeft
    const rect = selected.getBoundingClientRect()
    return { l: rect.left - base, r: rect.right - base }
  }

  function paint() {
    const el = indicator.value
    if (!el) return
    const left = Math.min(state.left.x, state.right.x)
    el.style.left = `${left}px`
    el.style.width = `${Math.max(Math.abs(state.right.x - state.left.x), 2)}px`
  }

  function hide() {
    if (indicator.value) indicator.value.style.opacity = '0'
    placed = false
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    moving.value = false
  }

  function frame(now: number) {
    rafId = 0
    const el = indicator.value
    const target = targetBox()
    if (!el || !target) {
      hide()
      moving.value = false
      return
    }
    const dt = Math.min((now - lastT) / 1000, MAX_DT)
    lastT = now
    rubberStep(state, target, dir, dt)
    // The chip never leaves the pill, whatever the overshoot
    const pillWidth = pill.value?.clientWidth ?? 0
    state.left.x = Math.max(state.left.x, -2)
    state.right.x = Math.min(state.right.x, pillWidth + 2)
    paint()
    const layoutBusy = (pill.value?.getAnimations?.({ subtree: true }).length ?? 0) > 0
    if (isSettled(state, target) && !layoutBusy) {
      snapTo(state, target)
      paint()
      moving.value = false
      return
    }
    rafId = requestAnimationFrame(frame)
  }

  /** Sit on the selected segment at once; keeps following a layout that is still moving */
  function jump() {
    const el = indicator.value
    const target = targetBox()
    if (!el) return
    if (!target) {
      stop()
      hide()
      return
    }
    el.style.opacity = '1'
    snapTo(state, target)
    placed = true
    paint()
    // A layout move that is still running (a segment growing) must not leave the chip behind
    const layoutBusy = (pill.value?.getAnimations?.({ subtree: true }).length ?? 0) > 0
    if (layoutBusy && !rafId) {
      moving.value = true
      lastT = performance.now()
      rafId = requestAnimationFrame(frame)
    } else if (!layoutBusy) {
      stop()
    }
  }

  /** Chase the selected segment with the rubber springs (a jump on first paint or with reduced motion) */
  function follow() {
    if (!placed || motionMs() === 0) {
      jump()
      return
    }
    const el = indicator.value
    const target = targetBox()
    if (!el) return
    if (!target) {
      stop()
      hide()
      return
    }
    el.style.opacity = '1'
    dir = directionOf(state, target)
    moving.value = true
    lastT = performance.now()
    if (!rafId) rafId = requestAnimationFrame(frame)
  }

  /** The layout is about to move (a segment mounts or leaves): flag it until the loop has seen it through */
  function begin() {
    moving.value = true
  }

  function observe(el: HTMLElement | null) {
    observer?.disconnect()
    observer = null
    if (!el || typeof ResizeObserver === 'undefined') return
    // A resize while a move runs is followed by the loop itself
    observer = new ResizeObserver(() => { if (!rafId) jump() })
    observer.observe(el)
  }

  watch(pill, (el) => {
    placed = false
    observe(el)
  }, { flush: 'post' })

  onBeforeUnmount(() => {
    observer?.disconnect()
    stop()
  })

  return { moving, follow, jump, begin }
}
