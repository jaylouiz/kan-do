import { onBeforeUnmount, watch, type Ref } from 'vue'
import { useBoardDragState } from '~/composables/useBoardDragState'

/**
 * Expand / collapse motion of a stack (#197). Purely visual: the state change is instant and final
 * (declarative expansion, ADR 004 decision 5), nothing waits for an animation.
 *
 * - Expand: the members are already in the list at their slots. They deal out of the collapsed face
 *   (the former front card slides down by the header row, the others start in the peek layers, 4+ fade
 *   in), the face's pill rises to the header row (the header's own pill travels, so it is one object
 *   that moves, #578), the close X scales in, the face's wash (a clone) eases out, the former front
 *   card's content eases back to full opacity, every item below glides (FLIP).
 * - Collapse: the stack is already in place. Non-interactive clones of the members fold from their
 *   slots into the face and are removed on finish; the header's pill (a clone) sinks onto the face
 *   while the rest of the header row clone fades out; the real face (cards, layers) stays hidden until
 *   the clones land and its wash is a clone above them that eases in; items below glide.
 *
 * Usage: `capture(keys, kind)` BEFORE the state change (reads rects, makes the clones), `play()` after
 * `await nextTick()`. A gesture that is not a user gesture (prune, collapseAll, drag end, tab switch)
 * never calls it, so it never animates.
 *
 * Only transform and opacity, finite, `fill: none`. Clones live in a layer under the column (never in
 * the `.task-list`, never `position: fixed`: the mobile board is transformed). Everything is cancelled
 * (jumps to its final state) by a new gesture, a drag start, a `pointerdown` and unmount, so dnd-kit
 * never measures a transformed element.
 */

export type StackMotionKind = 'expand' | 'collapse'

/** Attribute on the column's `.task-list` while a stack animation runs: the E2E hook (#187) */
export const STACK_ANIMATING_ATTR = 'data-stack-animating'
/** Attribute on the clone layer */
export const STACK_LAYER_ATTR = 'data-stack-motion-layer'

/** The collapsed face shows the front card and at most two peek layers (TaskStack.vue) */
const MAX_PEEK_LAYERS = 2
const MAX_CLONES = 8
const DEFAULT_DURATION_MS = 220
const DEFAULT_FADE_MS = 160
const DEFAULT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
const DEFAULT_OFFSET_PX = 4
/** z-index of the travelling pill (above the cards and clones) and of the wash clone (above the folding cards) */
const PILL_Z = 700
const WASH_Z = 650
/** Beat offsets: the wash eases in after 15 % / out until 85 %, the close X pops in at 45 %, the real face is back at 70 % */
const WASH_DELAY = 0.15
const WASH_END = 0.85
const CLOSE_DELAY = 0.45
const FACE_HOLD = 0.7
const DEFAULT_FRONT_CONTENT_OPACITY = 0.4

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Start/end of a card on the collapsed face: `layer` 0 is the front card, then one 4px step per layer.
 * `slot` is the box the transform is applied to (origin top left); `card` is the card inside it (the
 * slot itself when omitted). The card lands on the face, not the slot: on desktop the wrapper is wider
 * than the fixed-width card and the card sits at an offset inside it.
 */
export function faceTransform(slot: Box, face: Box, layer: number, offset: number, card: Box = slot): string {
  const scale = card.width > 0 ? Math.max(face.width - 2 * layer * offset, 0) / card.width : 1
  const x = face.left + layer * offset - slot.left - scale * (card.left - slot.left)
  const y = face.top + layer * offset - slot.top - scale * (card.top - slot.top)
  return `translate(${round(x)}px, ${round(y)}px) scale(${round(scale)})`
}

const round = (value: number): number => Math.round(value * 1000) / 1000

const toBox = (rect: Box): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
const boxOf = (el: Element): Box => toBox(el.getBoundingClientRect())

function intersectsViewport(box: Box): boolean {
  return box.top + box.height > 0 && box.top < window.innerHeight && box.left + box.width > 0 && box.left < window.innerWidth
}

/** An unitless-ms custom property ("220ms", "0.22s") or the fallback */
function readMs(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = style.getPropertyValue(name).trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return fallback
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : fallback
}

function readPx(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(style.getPropertyValue(name))
  return Number.isFinite(value) ? value : fallback
}

/** Removes everything that identifies the clone as a task or stack: ids, task and stack data attributes */
function stripIdentity(root: Element): void {
  const identity = /^data-(task-id|stack|from-stack)/
  for (const el of [root, ...root.querySelectorAll('*')]) {
    el.removeAttribute('id')
    el.removeAttribute('tabindex')
    for (const name of el.getAttributeNames()) {
      if (identity.test(name)) el.removeAttribute(name)
    }
  }
}

function makeClone(source: Element): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  stripIdentity(clone)
  clone.setAttribute('aria-hidden', 'true')
  clone.inert = true
  return clone
}

/** Positions a clone in the column's clone layer at the rect it had in the list */
function place(column: HTMLElement, origin: Box, clone: HTMLElement, box: Box): void {
  clone.style.position = 'absolute'
  clone.style.margin = '0'
  clone.style.transition = 'none'
  clone.style.pointerEvents = 'none'
  clone.style.left = `${round(box.left - origin.left - column.clientLeft + column.scrollLeft)}px`
  clone.style.top = `${round(box.top - origin.top - column.clientTop + column.scrollTop)}px`
  clone.style.width = `${round(box.width)}px`
  clone.style.height = `${round(box.height)}px`
}

interface CollapseSlot {
  /** The member's rect in its slot */
  slot: Box
  /** Null when the slot is outside the viewport or past the clone cap */
  clone: HTMLElement | null
}

interface GroupSnapshot {
  key: string
  /** Expand: the front card of the collapsed face. Collapse: unused */
  face: Box | null
  /** Expand: the face's pill box, where the header's pill starts. Collapse: the header's pill, as a clone that sinks to the face */
  pill: { box: Box, clone: HTMLElement | null } | null
  /** Expand: a clone of the face's pill layer without the pill (the wash that eases out) */
  wash: { box: Box, clone: HTMLElement } | null
  /** Collapse: the members, top to bottom, with the header row */
  slots: CollapseSlot[]
  header: { box: Box, clone: HTMLElement } | null
}

interface Snapshot {
  kind: StackMotionKind
  /** Every item of the list before the change, by element (Vue keeps the nodes of items that stay) */
  boxes: Map<Element, Box>
  groups: GroupSnapshot[]
}

interface StackMotionOptions {
  /** The `.column` element: the clone layer is its child */
  columnEl: Ref<HTMLElement | null>
  /** The column's `.task-list` */
  listEl: Ref<HTMLElement | null>
}

export function useStackMotion(options: StackMotionOptions) {
  const { columnEl, listEl } = options
  const { dragState } = useBoardDragState()

  let pending: Snapshot | null = null
  let running: Animation[] = []
  let layer: HTMLElement | null = null
  let animatedList: HTMLElement | null = null
  /** Bumped by every cancel, so the settle of a cancelled run never cleans up its successor */
  let generation = 0

  function isSupported(): boolean {
    return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
  }

  /** Read at play time: JS animations are not covered by a CSS media query */
  function prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function canAnimate(): boolean {
    return isSupported() && !prefersReducedMotion() && !dragState.value.isDragging
  }

  function cleanup() {
    running = []
    layer?.remove()
    layer = null
    animatedList?.removeAttribute(STACK_ANIMATING_ATTR)
    animatedList = null
    document.removeEventListener('pointerdown', cancel, true)
  }

  /** Cancels every running animation (elements jump to their final state) and removes the clones */
  function cancel() {
    generation++
    pending = null
    for (const animation of running) {
      try { animation.cancel() } catch { /* already gone */ }
    }
    cleanup()
  }

  // Sync, like useColumnStackCollapse: a keyboard grab must cancel before dnd-kit measures the wrappers
  watch(() => dragState.value.isDragging, (dragging) => {
    if (dragging) cancel()
  }, { flush: 'sync' })
  onBeforeUnmount(cancel)

  /**
   * Records the rects (and, for a collapse, the clones) of the list before `kind` happens to
   * `groupKeys`. Cancels a running animation first, so the rects are those of a settled layout.
   */
  function capture(groupKeys: string | readonly string[], kind: StackMotionKind) {
    cancel()
    const list = listEl.value
    if (!list || !canAnimate()) return
    const keys = typeof groupKeys === 'string' ? [groupKeys] : groupKeys
    const items = [...list.children] as HTMLElement[]
    const snapshot: Snapshot = { kind, boxes: new Map(items.map(el => [el, boxOf(el)])), groups: [] }
    let clones = 0
    for (const key of keys) {
      if (kind === 'expand') {
        const stack = items.find(el => el.dataset.stackKey === key)
        if (!stack) continue
        const front = stack.querySelector('.stacked-task--top') ?? stack
        const pillEl = stack.querySelector('.task-stack-pill')
        const layerEl = stack.querySelector('.task-stack__pill-layer')
        let wash: GroupSnapshot['wash'] = null
        if (layerEl) {
          // The pill itself travels (as the header's own element), so the wash clone carries it hidden
          const washClone = makeClone(layerEl)
          washClone.querySelector<HTMLElement>('.task-stack-pill')?.style.setProperty('visibility', 'hidden')
          wash = { box: boxOf(layerEl), clone: washClone }
        }
        snapshot.groups.push({ key, face: boxOf(front), pill: pillEl ? { box: boxOf(pillEl), clone: null } : null, wash, slots: [], header: null })
        continue
      }
      const header = items.find(el => el.dataset.stackHeader === key)
      const members = items.filter(el => el.dataset.fromStack === key)
      if (!header || members.length < 2) continue
      const slots = members.map((member): CollapseSlot => {
        const card = member.querySelector('.task')
        const slot = boxOf(card ?? member)
        const wanted = card !== null && clones < MAX_CLONES && intersectsViewport(slot)
        if (wanted) clones++
        return { slot, clone: wanted ? makeClone(card) : null }
      })
      const headerBox = boxOf(header)
      const headerPill = header.querySelector('.task-stack-pill')
      const headerClone = makeClone(header)
      // The pill travels as its own clone; the header clone keeps its place without it and fades
      headerClone.querySelector<HTMLElement>('.task-stack-pill')?.style.setProperty('visibility', 'hidden')
      snapshot.groups.push({
        key,
        face: null,
        pill: headerPill ? { box: boxOf(headerPill), clone: makeClone(headerPill) } : null,
        wash: null,
        slots,
        header: intersectsViewport(headerBox) ? { box: headerBox, clone: headerClone } : null,
      })
    }
    if (snapshot.groups.length > 0) pending = snapshot
  }

  /** Runs the motion recorded by `capture`, after the state change has rendered */
  function play() {
    const snapshot = pending
    pending = null
    const list = listEl.value
    const column = columnEl.value
    if (!snapshot || !list || !column || !canAnimate()) return

    const style = getComputedStyle(list)
    const duration = readMs(style, '--stack-transition-duration', DEFAULT_DURATION_MS)
    // The keyframe offsets divide by it; a zeroed token means no motion
    if (duration <= 0) return
    const fade = readMs(style, '--task-transform-duration', DEFAULT_FADE_MS)
    const easing = style.getPropertyValue('--stack-transition-easing').trim() || DEFAULT_EASING
    const offset = readPx(style, '--stack-collapsed-offset', DEFAULT_OFFSET_PX)
    const frontContentOpacity = readPx(style, '--stack-front-content-opacity', DEFAULT_FRONT_CONTENT_OPACITY)
    const items = [...list.children] as HTMLElement[]
    const origin = boxOf(column)
    // Every read of a rect comes first, the animations start at the end: a started animation moves what getBoundingClientRect reports
    const starts: Array<() => Animation> = []

    const travel = (el: Element, keyframes: Keyframe[]) => {
      starts.push(() => el.animate(keyframes, { duration, easing, fill: 'none' }))
    }
    /** Hidden until `from`, then up to full by `to` (offsets of the beat): the real element is covered by clones meanwhile */
    const hold = (el: Element, from: number, to: number) => {
      starts.push(() => el.animate(
        [{ opacity: 0 }, { opacity: 0, offset: from }, { opacity: 1, offset: to }, { opacity: 1 }],
        { duration, easing: 'linear', fill: 'none' },
      ))
    }
    /** The face's wash eases in/out over most of the beat: no step at either end */
    const washIn = (el: Element) => {
      starts.push(() => el.animate(
        [{ opacity: 0 }, { opacity: 0, offset: WASH_DELAY, easing }, { opacity: 1 }],
        { duration, easing: 'linear', fill: 'none' },
      ))
    }
    const washOut = (el: Element) => {
      starts.push(() => el.animate(
        [{ opacity: 1, easing }, { opacity: 0, offset: WASH_END }, { opacity: 0 }],
        { duration, easing: 'linear', fill: 'none' },
      ))
    }
    const fadeOut = (el: Element) => {
      starts.push(() => el.animate(
        [{ opacity: 1 }, { opacity: 0, offset: Math.min(fade / duration, 1) }, { opacity: 0 }],
        { duration, easing: 'linear', fill: 'none' },
      ))
    }

    // Items that stayed glide from their old to their new place (FLIP). Z-order follows the list
    // order, as the cards' own z-index does; a transformed wrapper would otherwise drop beneath it.
    items.forEach((el, index) => {
      const before = snapshot.boxes.get(el)
      if (!before) return
      // A pinned item (the sticky add bar on mobile) sits where its pin puts it, not where the list does
      if (['sticky', 'fixed'].includes(getComputedStyle(el).position)) return
      const after = boxOf(el)
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      if (!intersectsViewport(before) && !intersectsViewport(after)) return
      const zIndex = String(100 + index)
      travel(el, [{ transform: `translate(${round(dx)}px, ${round(dy)}px)`, zIndex }, { transform: 'none', zIndex }])
    })

    const clones: HTMLElement[] = []
    const addClone = (clone: HTMLElement, box: Box, zIndex: number) => {
      place(column, origin, clone, box)
      clone.style.zIndex = String(zIndex)
      clones.push(clone)
    }
    for (const group of snapshot.groups) {
      if (snapshot.kind === 'expand') {
        const members = items.filter(el => el.dataset.fromStack === group.key)
        const header = items.find(el => el.dataset.stackHeader === group.key)
        const headerPill = header?.querySelector<HTMLElement>('.task-stack-pill')
        const headerClose = header?.querySelector('button')
        if (headerPill && group.pill) {
          // The pill is the same object before and after: it rises from the face to the header, above the cards
          const to = boxOf(headerPill)
          const dx = group.pill.box.left + group.pill.box.width / 2 - (to.left + to.width / 2)
          const dy = group.pill.box.top + group.pill.box.height / 2 - (to.top + to.height / 2)
          travel(headerPill, [
            { transform: `translate(${round(dx)}px, ${round(dy)}px)`, zIndex: String(PILL_Z) },
            { transform: 'none', zIndex: String(PILL_Z) },
          ])
        }
        if (headerClose) {
          starts.push(() => headerClose.animate(
            [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(0.6)', offset: CLOSE_DELAY }, { opacity: 1, transform: 'none' }],
            { duration, easing, fill: 'none' },
          ))
        }
        if (group.wash) {
          // The face's wash lets go of the card: a clone at the face eases out while the cards deal
          addClone(group.wash.clone, group.wash.box, WASH_Z)
          washOut(group.wash.clone)
        }
        const face = group.face
        if (!face || members.length === 0) continue
        const layers = Math.min(members.length - 1, MAX_PEEK_LAYERS)
        const first = items.indexOf(members[0]!)
        members.forEach((member, i) => {
          const slot = boxOf(member)
          if (!intersectsViewport(slot)) return
          // The card, not its wrapper, deals out of the face (collapse measures the card too)
          const card = member.querySelector('.task')
          const cardBox = card ? boxOf(card) : slot
          // Earlier members paint over later ones, so they emerge from beneath the front card
          const zIndex = String(100 + first + members.length - 1 - i)
          const from: Keyframe = {
            transform: faceTransform(slot, face, Math.min(i, layers), offset, cardBox),
            transformOrigin: 'top left',
            zIndex,
            ...(i > layers ? { opacity: 0 } : {}),
          }
          const to: Keyframe = { transform: 'none', transformOrigin: 'top left', zIndex, ...(i > layers ? { opacity: 1 } : {}) }
          travel(member, [from, to])
          // The face rested muted (#371): the former front card's content comes up with the deal instead of stepping to full
          if (i === 0 && card) {
            for (const content of card.children) {
              starts.push(() => content.animate([{ opacity: frontContentOpacity }, { opacity: 1 }], { duration, easing, fill: 'none' }))
            }
          }
        })
        continue
      }

      const stack = items.find(el => el.dataset.stackKey === group.key)
      const front = stack?.querySelector('.stacked-task--top') ?? stack
      if (!stack || !front) continue
      const face = boxOf(front)
      const layers = Math.min(group.slots.length - 1, MAX_PEEK_LAYERS)
      group.slots.forEach(({ slot, clone }, i) => {
        if (!clone) return
        // The front clone ends on the real front card, the others beneath it
        addClone(clone, slot, group.slots.length - i + 1)
        const beyond = i > layers
        travel(clone, [
          { transform: 'none', transformOrigin: 'top left', ...(beyond ? { opacity: 1 } : {}) },
          { transform: faceTransform(slot, face, Math.min(i, layers), offset), transformOrigin: 'top left', ...(beyond ? { opacity: 0 } : {}) },
        ])
        // The face's front content rests muted (#371) and is revealed when the clone goes (#378): the clone's content steps back with the fold, so nothing pops at the end
        if (i === 0) {
          for (const content of clone.children) {
            starts.push(() => content.animate([{ opacity: 1 }, { opacity: frontContentOpacity }], { duration, easing, fill: 'none' }))
          }
        }
      })
      if (group.header) {
        addClone(group.header.clone, group.header.box, 0)
        fadeOut(group.header.clone)
      }
      const pillLayer = stack.querySelector('.task-stack__pill-layer')
      const cardsEl = stack.querySelector('.task-stack__cards')
      const facePill = stack.querySelector<HTMLElement>('.task-stack-pill')
      if (group.pill?.clone && facePill) {
        // The pill is the same object before and after: it sinks from the header onto the face; the real one stays hidden until it lands
        const to = boxOf(facePill)
        const dx = to.left + to.width / 2 - (group.pill.box.left + group.pill.box.width / 2)
        const dy = to.top + to.height / 2 - (group.pill.box.top + group.pill.box.height / 2)
        addClone(group.pill.clone, group.pill.box, PILL_Z)
        travel(group.pill.clone, [{ transform: 'none' }, { transform: `translate(${round(dx)}px, ${round(dy)}px)` }])
        // The whole layer (wash and pill) is covered by the wash clone and the travelling pill until they land
        if (pillLayer) starts.push(() => pillLayer.animate([{ opacity: 0 }, { opacity: 0 }], { duration, fill: 'none' }))
        // The folding clones are opaque and sit above the real face, so its wash would only show once they go (a pop):
        // the wash is a clone above them that eases in, equal to the real one at the end
        if (pillLayer) {
          const washClone = makeClone(pillLayer)
          washClone.querySelector<HTMLElement>('.task-stack-pill')?.style.setProperty('visibility', 'hidden')
          addClone(washClone, boxOf(pillLayer), WASH_Z)
          washIn(washClone)
        }
      }
      // The real face rests at its final place from the first frame; the front clone is the face while it folds, so it stays hidden until it lands.
      // Without a front clone (clone cap spent, members below the fold) nothing covers the face, so it stays visible
      if (cardsEl && group.slots[0]?.clone) hold(cardsEl, FACE_HOLD, 1)
    }

    // Clones live in one layer under the column, never in the list
    if (clones.length > 0) {
      layer = document.createElement('div')
      layer.setAttribute(STACK_LAYER_ATTR, '')
      layer.setAttribute('aria-hidden', 'true')
      layer.inert = true
      layer.append(...clones)
      column.append(layer)
    }

    const animations = starts.map(start => start())
    if (animations.length === 0) {
      layer?.remove()
      layer = null
      return
    }
    running = animations
    animatedList = list
    list.setAttribute(STACK_ANIMATING_ATTR, snapshot.kind)
    document.addEventListener('pointerdown', cancel, true)
    const current = generation
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (current === generation) cleanup()
    })
  }

  return { capture, play, cancel }
}
