import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { faceTransform, STACK_ANIMATING_ATTR, STACK_LAYER_ATTR, useStackMotion, type Box } from '~/composables/useStackMotion'
import { useBoardDragState } from '~/composables/useBoardDragState'

/**
 * Expand/collapse motion (#197). jsdom has no layout and no Web Animations: rects are a lookup table,
 * `Element.animate` is a stub whose animations finish or cancel on command.
 */

interface FakeAnimation {
  target: Element
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
  finish: () => void
  finished: Promise<void>
}

const rects = new Map<Element, Box>()
const animations: FakeAnimation[] = []
const box = (left: number, top: number, width = 300, height = 100): Box => ({ left, top, width, height })

const setRect = (el: Element, rect: Box) => rects.set(el, rect)

function el(tag: string, attrs: Record<string, string> = {}, parent?: Element): HTMLElement {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  parent?.append(node)
  return node
}

function member(list: Element, id: string, group: string): HTMLElement {
  const wrapper = el('div', { class: 'task-wrapper', 'data-task-id': id, 'data-from-stack': group }, list)
  const card = el('div', { class: 'task', id: `card-${id}`, 'data-task-id': id }, wrapper)
  el('button', { id: `btn-${id}`, tabindex: '0' }, card)
  return wrapper
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** A column with a list; `motion` is the composable under test */
function mountColumn() {
  const columnEl = ref<HTMLElement | null>(null)
  const listEl = ref<HTMLElement | null>(null)
  let motion!: ReturnType<typeof useStackMotion>
  const wrapper = mount(
    defineComponent({
      setup() {
        motion = useStackMotion({ columnEl, listEl })
        return () => h('div', { class: 'column', ref: (node: unknown) => (columnEl.value = node as HTMLElement) }, [
          h('div', { class: 'task-list', ref: (node: unknown) => (listEl.value = node as HTMLElement) }),
        ])
      },
    }),
    { attachTo: document.body },
  )
  const column = wrapper.find('.column').element as HTMLElement
  const list = wrapper.find('.task-list').element as HTMLElement
  setRect(column, box(0, 0, 400, 1000))
  return { wrapper, column, list, motion }
}

/** Collapsed face of `size` cards: the stack element with its front card and caption */
function stackFace(list: Element, key: string, size: number, front: Box): HTMLElement {
  const stack = el('div', { class: 'task-stack', 'data-stack-key': key, 'data-stack-size': String(size), 'data-task-id': 'front' }, list)
  const cards = el('div', { class: 'task-stack__cards' }, stack)
  const frontCard = el('div', { class: 'stacked-task stacked-task--top' }, cards)
  const layer = el('div', { class: 'task-stack__pill-layer' }, stack)
  const pill = el('span', { class: 'task-stack-pill' }, layer)
  setRect(stack, front)
  setRect(frontCard, front)
  setRect(layer, box(front.left, front.top + 30, front.width, 40))
  setRect(pill, box(front.left + 60, front.top + 38, 160, 24))
  return stack
}

/** The card inside a member wrapper (box(40, top)): narrower and centred, as on desktop */
const cardOf = (top: number): Box => box(60, top, 260, 100)

const byTarget = (selector: string) => animations.filter(animation => animation.target.matches(selector))

let mounted: VueWrapper | null = null
let reduced = false

beforeEach(() => {
  rects.clear()
  animations.length = 0
  reduced = false
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce') }))
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = rects.get(this) ?? box(0, 0, 0, 0)
    return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect } as DOMRect
  }
  Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const finished = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    finished.catch(() => undefined)
    const animation: FakeAnimation = {
      target: this,
      keyframes,
      options,
      cancel: vi.fn(() => reject(new DOMException('cancelled', 'AbortError'))),
      finish: resolve,
      finished,
    }
    animations.push(animation)
    return animation as unknown as Animation
  }) as unknown as typeof Element.prototype.animate
  useBoardDragState().dragState.value.isDragging = false
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('faceTransform', () => {
  it('moves a slot onto the front card (layer 0) and onto the 4px layers, scaled by the inset width', () => {
    const slot = box(40, 200, 300, 100)
    const face = box(40, 100, 300, 100)
    expect(faceTransform(slot, face, 0, 4)).toBe('translate(0px, -100px) scale(1)')
    expect(faceTransform(slot, face, 1, 4)).toBe('translate(4px, -96px) scale(0.9733)'.replace('0.9733', String(Math.round((292 / 300) * 1000) / 1000)))
    expect(faceTransform(slot, face, 2, 4)).toBe(`translate(8px, -92px) scale(${Math.round((284 / 300) * 1000) / 1000})`)
  })

  it('lands the card on the face, not its wider wrapper: the card offset inside the wrapper is part of the delta', () => {
    // Desktop: 346px wrapper at x 40, a centred 288px card inside it at x 69
    const wrapper = box(40, 200, 346, 120)
    const card = box(69, 200, 288, 100)
    const face = box(69, 100, 288, 100)
    expect(faceTransform(wrapper, face, 0, 4, card)).toBe('translate(0px, -100px) scale(1)')
    // Layer 1: the card is 8px narrower, so the wrapper scales by 280/288 and the card still starts at face.left + 4
    const scale = 280 / 288
    expect(faceTransform(wrapper, face, 1, 4, card)).toBe(`translate(${Math.round((69 + 4 - 40 - scale * 29) * 1000) / 1000}px, -96px) scale(${Math.round(scale * 1000) / 1000})`)
  })
})

describe('useStackMotion: expand', () => {
  const setup = (size: number) => {
    const ctx = mountColumn()
    mounted = ctx.wrapper
    const face = box(40, 100)
    const below = el('div', { class: 'task-wrapper', 'data-task-id': 'z' }, ctx.list)
    setRect(below, box(40, 260))
    const stack = stackFace(ctx.list, 'g', size, face)
    ctx.list.insertBefore(stack, below)
    ctx.motion.capture('g', 'expand')
    // The change: the stack gives way to a header row and the members (height 100, 8px apart)
    stack.remove()
    const header = el('div', { class: 'task-stack-header', 'data-stack-header': 'g' })
    setRect(header, box(40, 100, 300, 24))
    const headerPill = el('span', { class: 'task-stack-pill' }, header)
    setRect(headerPill, box(100, 100, 160, 24))
    const closeButton = el('button', {}, header)
    ctx.list.insertBefore(header, below)
    const members = Array.from({ length: size }, (_, i) => {
      const wrapper = member(ctx.list, `m${i}`, 'g')
      ctx.list.insertBefore(wrapper, below)
      setRect(wrapper, box(40, 130 + i * 108))
      setRect(wrapper.querySelector('.task')!, cardOf(130 + i * 108))
      return wrapper
    })
    setRect(below, box(40, 130 + size * 108))
    return { ...ctx, header, headerPill, closeButton, members, below }
  }

  it('group of 3: member 1 slides from the front card, 2 and 3 start in the peek layers', async () => {
    const { motion, members } = setup(3)
    motion.play()
    const starts = members.map(m => byTarget(`[data-task-id="${m.dataset.taskId}"]`)[0]!.keyframes[0]!.transform)
    expect(starts[0]).toBe(faceTransform(box(40, 130), box(40, 100), 0, 4, cardOf(130)))
    expect(starts[1]).toBe(faceTransform(box(40, 238), box(40, 100), 1, 4, cardOf(238)))
    expect(starts[2]).toBe(faceTransform(box(40, 346), box(40, 100), 2, 4, cardOf(346)))
    expect(byTarget('.task-wrapper[data-from-stack]').every(a => a.keyframes[1]!.transform === 'none')).toBe(true)
  })

  it('group of 2 has one layer; group of 9 keeps the layer-2 start and fades in members 4+', () => {
    const two = setup(2)
    two.motion.play()
    expect(byTarget('[data-task-id="m1"]')[0]!.keyframes[0]!.transform).toBe(faceTransform(box(40, 238), box(40, 100), 1, 4, cardOf(238)))
    two.wrapper.unmount()
    document.body.innerHTML = ''
    animations.length = 0

    const nine = setup(9)
    nine.motion.play()
    const own = (i: number) => byTarget(`[data-task-id="m${i}"]`)[0]!
    expect(own(2).keyframes[0]!.transform).toBe(faceTransform(box(40, 346), box(40, 100), 2, 4, cardOf(346)))
    expect(own(2).keyframes[0]).not.toHaveProperty('opacity')
    expect(own(3).keyframes[0]!.transform).toBe(faceTransform(box(40, 454), box(40, 100), 2, 4, cardOf(454)))
    expect(own(3).keyframes[0]).toMatchObject({ opacity: 0 })
    expect(own(3).keyframes[1]).toMatchObject({ opacity: 1 })
  })

  it('members paint earlier over later ones and beneath the items below; the items below glide by the height difference', () => {
    const { motion, below } = setup(3)
    motion.play()
    const z = (id: string) => Number(byTarget(`[data-task-id="${id}"]`)[0]!.keyframes[0]!.zIndex)
    expect(z('m0')).toBeGreaterThan(z('m1'))
    expect(z('m1')).toBeGreaterThan(z('m2'))
    const glide = animations.find(animation => animation.target === below)!
    expect(Number(glide.keyframes[0]!.zIndex)).toBeGreaterThan(z('m0'))
    // old top 260 (collapsed), new top 130 + 3 * 108 = 454
    expect(glide.keyframes[0]!.transform).toBe('translate(0px, -194px)')
    expect(glide.keyframes[1]!.transform).toBe('none')
  })

  it('the header pill is the face pill moved: it rises from the face pill centre to its place, above the cards (#578)', () => {
    const { motion, headerPill, header } = setup(3)
    motion.play()
    const rise = animations.find(animation => animation.target === headerPill)!
    // face pill: centre (140 + 60 + 80 - 40 ... ) = left 100, top 138, 160 x 24; header pill: left 100, top 100
    expect(rise.keyframes[0]!.transform).toBe('translate(0px, 38px)')
    expect(rise.keyframes[1]!.transform).toBe('none')
    expect(rise.keyframes[0]!.zIndex).toBe('700')
    expect(rise.options.duration).toBe(220)
    // the row itself never fades: only the pill travels and the X comes in
    expect(animations.some(animation => animation.target === header)).toBe(false)
  })

  it('the close X scales and fades in after the first part of the beat (#578)', () => {
    const { motion, closeButton } = setup(3)
    motion.play()
    const pop = animations.find(animation => animation.target === closeButton)!
    expect(pop.keyframes.map(frame => frame.opacity)).toEqual([0, 0, 1])
    expect(pop.keyframes[1]!.offset).toBeCloseTo(0.45)
    expect(pop.keyframes[2]!.transform).toBe('none')
  })

  it('the face wash is a clone that eases out over most of the beat, without the pill (it travels) (#578)', () => {
    const { motion, column } = setup(3)
    motion.play()
    const layer = column.querySelector(`[${STACK_LAYER_ATTR}]`)!
    const wash = [...layer.children].find(node => node.classList.contains('task-stack__pill-layer')) as HTMLElement
    expect(wash).toBeTruthy()
    expect(wash.querySelector<HTMLElement>('.task-stack-pill')!.style.visibility).toBe('hidden')
    const out = animations.find(animation => animation.target === wash)!
    expect(out.keyframes.map(frame => frame.opacity)).toEqual([1, 0, 0])
    expect(out.keyframes[1]!.offset).toBeCloseTo(0.85)
  })

  it('the former front card content eases from the muted token to full with the deal (no step) (#578)', () => {
    const { motion, members } = setup(3)
    motion.play()
    const content = members[0]!.querySelector('.task')!.firstElementChild!
    const rise = animations.find(animation => animation.target === content)!
    expect(rise.keyframes.map(frame => frame.opacity)).toEqual([0.4, 1])
    expect(animations.some(animation => animation.target === members[1]!.querySelector('.task')!.firstElementChild)).toBe(false)
  })

  it('plays only finite, fill-less transform and opacity animations of the default beat', () => {
    const { motion } = setup(3)
    motion.play()
    expect(animations.length).toBeGreaterThan(0)
    for (const animation of animations) {
      expect(animation.options.fill).toBe('none')
      expect(animation.options.duration).toBe(220)
      expect(animation.options.iterations).toBeUndefined()
      for (const frame of animation.keyframes) {
        expect(Object.keys(frame).filter(key => !['transform', 'transformOrigin', 'opacity', 'zIndex', 'offset', 'easing'].includes(key))).toEqual([])
      }
    }
  })

  it('sets data-stack-animating while it runs and clears it when every animation finished', async () => {
    const { motion, list } = setup(3)
    motion.play()
    expect(list.getAttribute(STACK_ANIMATING_ATTR)).toBe('expand')
    animations.forEach(animation => animation.finish())
    await flush()
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })

  it('skips members outside the viewport (they take their final place at once)', () => {
    const { motion, members } = setup(3)
    setRect(members[2]!, box(40, 5000))
    motion.play()
    expect(byTarget('[data-task-id="m2"]')).toHaveLength(0)
    expect(byTarget('[data-task-id="m1"]')).toHaveLength(1)
  })
})

describe('useStackMotion: collapse', () => {
  const setup = (size: number, keys: string[] = ['g']) => {
    const ctx = mountColumn()
    mounted = ctx.wrapper
    const headers = keys.map((key, k) => {
      const header = el('div', { class: 'task-stack-header', 'data-stack-header': key }, ctx.list)
      setRect(header, box(40, 100 + k * 600, 300, 24))
      const pill = el('span', { class: 'task-stack-pill', id: `pill-${key}` }, header)
      setRect(pill, box(100, 100 + k * 600, 160, 24))
      el('button', { id: `close-${key}` }, header)
      Array.from({ length: size }, (_, i) => {
        const wrapper = member(ctx.list, `${key}${i}`, key)
        setRect(wrapper, box(40, 130 + k * 600 + i * 108))
        setRect(wrapper.querySelector('.task')!, box(40, 130 + k * 600 + i * 108))
      })
      return header
    })
    const below = el('div', { class: 'task-wrapper', 'data-task-id': 'z' }, ctx.list)
    setRect(below, box(40, 130 + size * 108))
    ctx.motion.capture(keys, 'collapse')
    // The change: header and members give way to the collapsed faces
    headers.forEach((header, k) => {
      const key = keys[k]!
      ctx.list.querySelectorAll(`[data-from-stack="${key}"]`).forEach(node => node.remove())
      const stack = stackFace(ctx.list, key, size, box(40, 100 + k * 600))
      ctx.list.insertBefore(stack, header)
      header.remove()
    })
    setRect(below, box(40, 260))
    return { ...ctx, below }
  }

  it('folds clones of the members into the face; clones are inert, id-free and live in a layer outside the list', () => {
    const { motion, column, list } = setup(3)
    motion.play()
    const layer = column.querySelector(`[${STACK_LAYER_ATTR}]`)!
    expect(layer.parentElement).toBe(column)
    expect(list.contains(layer)).toBe(false)
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    const clones = [...layer.children] as HTMLElement[]
    expect(clones).toHaveLength(6) // 3 members + the header row + the pill + the wash
    for (const clone of clones) {
      expect(clone.getAttribute('aria-hidden')).toBe('true')
      expect(clone.inert).toBe(true)
      expect(clone.style.pointerEvents).toBe('none')
      expect([clone, ...clone.querySelectorAll('*')].some(node => node.hasAttribute('id') || node.hasAttribute('tabindex'))).toBe(false)
    }
    expect(document.querySelectorAll('[data-task-id="g0"]')).toHaveLength(0)
    expect(layer.querySelector('[data-task-id], [data-stack-key], [data-from-stack], [data-stack-header]')).toBeNull()
    // member 1 ends on the front card, member 3 in the second layer
    const first = animations.find(animation => animation.target === clones[0])!
    expect(first.keyframes[1]!.transform).toBe(faceTransform(box(40, 130), box(40, 100), 0, 4))
    const third = animations.find(animation => animation.target === clones[2])!
    expect(third.keyframes[1]!.transform).toBe(faceTransform(box(40, 346), box(40, 100), 2, 4))
  })

  it('the front clone\'s content fades to the muted token over the fold, so the revealed face does not pop (#378)', () => {
    const { motion, column } = setup(3)
    motion.play()
    const clones = [...column.querySelector(`[${STACK_LAYER_ATTR}]`)!.children] as HTMLElement[]
    const fades = (clone: HTMLElement) => [...clone.children].map(child => animations.find(animation => animation.target === child))
    expect(fades(clones[0]!)).toHaveLength(1)
    expect(fades(clones[0]!)[0]!.keyframes.map(frame => frame.opacity)).toEqual([1, 0.4])
    expect(fades(clones[1]!)[0]).toBeUndefined()
  })

  it('fades the header clone (without its pill) out and removes layer and attribute on finish', async () => {
    const { motion, column, list } = setup(3)
    motion.play()
    const layer = column.querySelector(`[${STACK_LAYER_ATTR}]`)!
    const headerClone = [...layer.children].find(node => node.classList.contains('task-stack-header'))! as HTMLElement
    const out = animations.find(animation => animation.target === headerClone)!
    expect(out.keyframes.map(frame => frame.opacity)).toEqual([1, 0, 0])
    expect(headerClone.querySelector<HTMLElement>('.task-stack-pill')!.style.visibility).toBe('hidden')
    expect(list.getAttribute(STACK_ANIMATING_ATTR)).toBe('collapse')
    animations.forEach(animation => animation.finish())
    await flush()
    expect(column.querySelector(`[${STACK_LAYER_ATTR}]`)).toBeNull()
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })

  it('the header pill sinks onto the face pill as a clone; the real face stays hidden until the clones land (#578)', () => {
    const { motion, column, list } = setup(3)
    motion.play()
    const layer = column.querySelector(`[${STACK_LAYER_ATTR}]`)!
    const pillClone = [...layer.children].find(node => node.classList.contains('task-stack-pill')) as HTMLElement
    expect(pillClone).toBeTruthy()
    expect(pillClone.style.zIndex).toBe('700')
    const sink = animations.find(animation => animation.target === pillClone)!
    // header pill: left 100, top 100; face pill: left 100, top 138
    expect(sink.keyframes.map(frame => frame.transform)).toEqual(['none', 'translate(0px, 38px)'])
    const facePillLayer = list.querySelector('.task-stack__pill-layer')!
    expect(animations.find(animation => animation.target === facePillLayer)!.keyframes.map(frame => frame.opacity)).toEqual([0, 0])
    const cards = list.querySelector('.task-stack__cards')!
    const hold = animations.find(animation => animation.target === cards)!
    expect(hold.keyframes.map(frame => frame.opacity)).toEqual([0, 0, 1, 1])
    expect(hold.keyframes[1]!.offset).toBeCloseTo(0.7)
  })

  it('holds the real face only where a front clone covers it: a group past the clone cap keeps its face visible (#578)', () => {
    vi.stubGlobal('innerHeight', 5000)
    // 5 groups of 2 members: the cap of 8 clones runs out in the fifth group, which gets no clone at all
    const { motion, list } = setup(2, ['a', 'b', 'c', 'd', 'e'])
    motion.play()
    const holds = (key: string) => animations.filter(animation => animation.target.matches('.task-stack__cards') && animation.target.closest(`[data-stack-key="${key}"]`))
    expect(holds('a')).toHaveLength(1)
    expect(holds('d')).toHaveLength(1)
    expect(list.querySelector('[data-stack-key="e"]')).not.toBeNull()
    expect(holds('e')).toHaveLength(0)
  })

  it('the wash is a clone above the folding cards that eases in (starts after 15 % of the beat) (#578)', () => {
    const { motion, column } = setup(3)
    motion.play()
    const layer = column.querySelector(`[${STACK_LAYER_ATTR}]`)!
    const wash = [...layer.children].find(node => node.classList.contains('task-stack__pill-layer')) as HTMLElement
    expect(wash).toBeTruthy()
    expect(Number(wash.style.zIndex)).toBeGreaterThan(3)
    expect(wash.querySelector<HTMLElement>('.task-stack-pill')!.style.visibility).toBe('hidden')
    const ease = animations.find(animation => animation.target === wash)!
    expect(ease.keyframes.map(frame => frame.opacity)).toEqual([0, 0, 1])
    expect(ease.keyframes[1]!.offset).toBeCloseTo(0.15)
  })

  it('members beyond the layers fold into layer 2 while fading out; clones are capped at 8', () => {
    vi.stubGlobal('innerHeight', 5000)
    const { motion, column } = setup(10)
    motion.play()
    const clones = [...column.querySelector(`[${STACK_LAYER_ATTR}]`)!.children] as HTMLElement[]
    expect(clones).toHaveLength(11) // 8 members + the header row + the pill + the wash
    const fourth = animations.find(animation => animation.target === clones[3])!
    expect(fourth.keyframes[0]).toMatchObject({ opacity: 1 })
    expect(fourth.keyframes[1]).toMatchObject({ opacity: 0 })
  })

  it('several groups collapsing at once share one run and one layer; the items below glide up', () => {
    vi.stubGlobal('innerHeight', 5000)
    const { motion, column, below } = setup(2, ['g', 'h'])
    motion.play()
    expect(column.querySelectorAll(`[${STACK_LAYER_ATTR}]`)).toHaveLength(1)
    expect([...column.querySelector(`[${STACK_LAYER_ATTR}]`)!.children]).toHaveLength(10) // per group: 2 members + header + pill + wash
    expect(animations.some(animation => animation.target === below)).toBe(true)
  })
})

describe('useStackMotion: guards and cancelling', () => {
  const expandOnce = () => {
    const ctx = mountColumn()
    mounted = ctx.wrapper
    const stack = stackFace(ctx.list, 'g', 2, box(40, 100))
    ctx.motion.capture('g', 'expand')
    stack.remove()
    const wrapper = member(ctx.list, 'm0', 'g')
    setRect(wrapper, box(40, 130))
    member(ctx.list, 'm1', 'g')
    return ctx
  }

  it('does nothing under prefers-reduced-motion (read at capture and again at play): no animation, no clone, no attribute', () => {
    reduced = true
    const { motion, list, column } = expandOnce()
    motion.play()
    expect(animations).toHaveLength(0)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
    expect(column.querySelector(`[${STACK_LAYER_ATTR}]`)).toBeNull()
  })

  it('plays nothing, and leaves no layer, when the duration token is zero', () => {
    const { motion, list, column } = expandOnce()
    list.style.setProperty('--stack-transition-duration', '0ms')
    expect(() => motion.play()).not.toThrow()
    expect(animations).toHaveLength(0)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
    expect(column.querySelector(`[${STACK_LAYER_ATTR}]`)).toBeNull()
  })

  it('does nothing while a drag is active', () => {
    useBoardDragState().dragState.value.isDragging = true
    const { motion, list } = expandOnce()
    motion.play()
    expect(animations).toHaveLength(0)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })

  it('is a no-op without Element.animate (jsdom, old browsers)', () => {
    Element.prototype.animate = undefined as unknown as typeof Element.prototype.animate
    const { motion, list } = expandOnce()
    expect(() => motion.play()).not.toThrow()
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })

  it('plays nothing without a capture, and a capture is played once', () => {
    const { motion } = expandOnce()
    motion.play()
    const count = animations.length
    expect(count).toBeGreaterThan(0)
    motion.play()
    expect(animations).toHaveLength(count)
  })

  it('a drag start cancels every running animation, clears the attribute and removes the layer', async () => {
    const { motion, list, column } = expandOnce()
    motion.play()
    expect(list.getAttribute(STACK_ANIMATING_ATTR)).toBe('expand')
    useBoardDragState().dragState.value.isDragging = true
    await flush()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
    expect(column.querySelector(`[${STACK_LAYER_ATTR}]`)).toBeNull()
  })

  it('a pointerdown cancels the running animations', async () => {
    const { motion, list } = expandOnce()
    motion.play()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flush()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })

  it('a new gesture cancels the running one before it records, and the stale run never cleans up the new one', async () => {
    const { motion, list } = expandOnce()
    motion.play()
    const first = [...animations]
    motion.capture('g', 'collapse')
    expect(first.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
    list.setAttribute(STACK_ANIMATING_ATTR, 'collapse') // as a following run would
    await flush() // the settled promises of the cancelled run resolve
    expect(list.getAttribute(STACK_ANIMATING_ATTR)).toBe('collapse')
  })

  it('unmounting cancels and cleans up', () => {
    const { motion, list, wrapper } = expandOnce()
    motion.play()
    wrapper.unmount()
    mounted = null
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(list.hasAttribute(STACK_ANIMATING_ATTR)).toBe(false)
  })
})

describe('useStackMotion: pinned items', () => {
  it('does not glide a sticky item: its rect follows the pin, not the list', () => {
    const ctx = mountColumn()
    mounted = ctx.wrapper
    const stack = stackFace(ctx.list, 'g', 2, box(40, 100))
    const bar = el('div', { class: 'add-task-slot' }, ctx.list)
    bar.style.position = 'sticky'
    setRect(bar, box(40, 700))
    ctx.motion.capture('g', 'expand')
    stack.remove()
    ctx.list.insertBefore(member(ctx.list, 'm0', 'g'), bar)
    ctx.list.insertBefore(member(ctx.list, 'm1', 'g'), bar)
    setRect(bar, box(40, 560))
    ctx.motion.play()
    expect(animations.some(animation => animation.target === bar)).toBe(false)
  })
})
