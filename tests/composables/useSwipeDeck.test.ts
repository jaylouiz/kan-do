import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { DECK_MOVE_MS, DECK_OUT_MS, DECK_QUEUE_MAX, useSwipeDeck, type DeckKey } from '~/composables/useSwipeDeck'

/** Issue #451: gesture, order and queue logic of the recap's swipe deck. */

const FLY = DECK_MOVE_MS
const STEP = DECK_MOVE_MS

let scope: ReturnType<typeof effectScope> | null = null
function make(n = 4, extra: { key?: string } = {}) {
  const count = ref(n)
  const key = ref(extra.key ?? 'a')
  scope = effectScope()
  const deck = scope.run(() => useSwipeDeck({ count, key, flyDistance: () => 400 }))!
  return { deck, count, key }
}
const reduceMotion = (on: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: on && query.includes('reduce'), media: query })) as never
}
const press = (clientX = 0, extra: Record<string, unknown> = {}) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX, ...extra })
const key = (name: string, extra: Partial<DeckKey> = {}): DeckKey => ({ key: name, ...extra })

describe('useSwipeDeck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reduceMotion(false)
  })
  afterEach(() => {
    scope?.stop()
    scope = null
    vi.useRealTimers()
  })

  it('next rotates the front card to the back and the counter advances and wraps', () => {
    const { deck } = make(3)
    expect(deck.position.value).toBe(1)
    expect([0, 1, 2].map(deck.depthOf)).toEqual([0, 1, 2])
    deck.next()
    vi.advanceTimersByTime(FLY)
    expect(deck.position.value).toBe(2)
    expect([0, 1, 2].map(deck.depthOf)).toEqual([2, 0, 1])
    deck.next(); vi.advanceTimersByTime(FLY)
    deck.next(); vi.advanceTimersByTime(FLY)
    expect(deck.position.value).toBe(1)
    expect([0, 1, 2].map(deck.depthOf)).toEqual([0, 1, 2])
  })

  it('next: the front card slides sideways at full opacity, then goes behind and settles; the counter advances at the switch', () => {
    const { deck } = make()
    deck.next()
    vi.advanceTimersByTime(DECK_OUT_MS - 1)
    expect(deck.position.value).toBe(1)
    expect(deck.frontX.value).toBe(400)
    expect(deck.moving.value).toEqual({ index: 0, x: 400, stage: 'out', type: 'next' })
    vi.advanceTimersByTime(1)
    expect(deck.position.value).toBe(2)
    expect(deck.depthOf(0)).toBe(3)
    expect(deck.frontX.value).toBe(0)
    expect(deck.moving.value).toEqual({ index: 0, x: 0, stage: 'settle', type: 'next' })
    vi.advanceTimersByTime(FLY - DECK_OUT_MS)
    expect(deck.moving.value).toBeNull()
  })

  it('prev: the back card slides out sideways from behind, then comes to the front; wraps from 1 to n', () => {
    const { deck } = make(4)
    deck.prev()
    expect(deck.position.value).toBe(1)
    expect(deck.depthOf(3)).toBe(3)
    expect(deck.frontX.value).toBe(0)
    expect(deck.moving.value).toEqual({ index: 3, x: -400, stage: 'out', type: 'prev' })
    vi.advanceTimersByTime(DECK_OUT_MS)
    expect(deck.position.value).toBe(4)
    expect(deck.depthOf(3)).toBe(0)
    expect(deck.moving.value).toEqual({ index: 3, x: 0, stage: 'settle', type: 'prev' })
    vi.advanceTimersByTime(FLY - DECK_OUT_MS)
    expect(deck.moving.value).toBeNull()
  })

  it('the deck takes the next move while the previous card still settles, and the old settle never clears the new marker', () => {
    const { deck } = make(4)
    deck.next()
    vi.advanceTimersByTime(DECK_OUT_MS)
    deck.next()
    expect(deck.moving.value).toMatchObject({ index: 1, stage: 'out' })
    vi.advanceTimersByTime(DECK_MOVE_MS - DECK_OUT_MS)
    expect(deck.moving.value).toMatchObject({ index: 1, stage: 'settle' })
    vi.advanceTimersByTime(DECK_OUT_MS)
    expect(deck.moving.value).toBeNull()
    expect(deck.position.value).toBe(3)
  })

  it('next then prev returns to the start', () => {
    const { deck } = make()
    deck.next(); vi.advanceTimersByTime(FLY)
    deck.prev(); vi.advanceTimersByTime(STEP)
    expect(deck.position.value).toBe(1)
    expect([0, 1, 2, 3].map(deck.depthOf)).toEqual([0, 1, 2, 3])
  })

  it('cycling n times reaches every card exactly once per round', () => {
    const { deck } = make(12)
    const fronts: number[] = []
    for (let i = 0; i < 12; i++) {
      fronts.push([...Array(12).keys()].find(index => deck.depthOf(index) === 0)!)
      deck.next(); vi.advanceTimersByTime(FLY)
    }
    expect([...fronts].sort((a, b) => a - b)).toEqual([...Array(12).keys()])
    expect(deck.position.value).toBe(1)
  })

  it('queues quick input in order and drops none: five nexts advance by five', () => {
    const { deck } = make(8)
    for (let i = 0; i < 5; i++) deck.next()
    vi.advanceTimersByTime(FLY * 5)
    expect(deck.position.value).toBe(6)
  })

  it('queues mixed directions in order: next then prev ends where it started', () => {
    const { deck } = make()
    deck.next(); deck.prev()
    vi.advanceTimersByTime(FLY + STEP)
    expect(deck.position.value).toBe(1)
    deck.prev(); deck.next(); deck.next()
    vi.advanceTimersByTime(STEP + FLY * 2)
    expect(deck.position.value).toBe(2)
  })

  it('caps the queue at 8 (plus the move in flight)', () => {
    const { deck } = make(30)
    for (let i = 0; i < 20; i++) deck.next()
    vi.advanceTimersByTime(FLY * 30)
    expect(deck.position.value).toBe(1 + 1 + DECK_QUEUE_MAX)
  })

  it('a single card (or none) does nothing', () => {
    const { deck } = make(1)
    expect(deck.canMove.value).toBe(false)
    deck.next(); deck.prev()
    deck.onPointerDown(press(0)); deck.onPointerMove(press(200)); deck.onPointerUp(press(200))
    vi.advanceTimersByTime(1000)
    expect(deck.position.value).toBe(1)
    expect(deck.dx.value).toBe(0)
    expect(deck.frontX.value).toBe(0)
    expect(make(0).deck.position.value).toBe(0)
  })

  describe('pointer', () => {
    it('follows the pointer while dragging, and 80px or less snaps back unchanged', () => {
      const { deck } = make()
      deck.onPointerDown(press(100))
      expect(deck.dragging.value).toBe(true)
      deck.onPointerMove(press(160))
      expect(deck.dx.value).toBe(60)
      expect(deck.frontX.value).toBe(60)
      deck.onPointerUp(press(160))
      expect(deck.dragging.value).toBe(false)
      expect(deck.dx.value).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(deck.position.value).toBe(1)
    })

    it('exactly 80px snaps back, 81px advances', () => {
      const { deck } = make()
      deck.onPointerDown(press(0)); deck.onPointerMove(press(80)); deck.onPointerUp(press(80))
      vi.advanceTimersByTime(1000)
      expect(deck.position.value).toBe(1)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(81)); deck.onPointerUp(press(81))
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(2)
    })

    it('drag 60px (snap back), then 100px (advance), either direction; the card leaves on the side it was dragged to', () => {
      const { deck } = make()
      deck.onPointerDown(press(0)); deck.onPointerMove(press(-60)); deck.onPointerUp(press(-60))
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(1)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(-100)); deck.onPointerUp(press(-100))
      expect(deck.frontX.value).toBe(-400)
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(2)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(100)); deck.onPointerUp(press(100))
      expect(deck.frontX.value).toBe(400)
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(3)
    })

    it('a tap (6px or less) goes next; above 6px and under 81px is a drag and snaps back', () => {
      const { deck } = make()
      deck.onPointerDown(press(0)); deck.onPointerMove(press(6)); deck.onPointerUp(press(6))
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(2)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(7)); deck.onPointerUp(press(7))
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(2)
      deck.onPointerDown(press(0)); deck.onPointerUp(press(0))
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(3)
    })

    it('a cancelled pointer is no tap and no swipe, also after a long drag', () => {
      const { deck } = make()
      deck.onPointerDown(press(0, { pointerType: 'touch' }))
      deck.onPointerCancel()
      deck.onPointerUp(press(0, { pointerType: 'touch' }))
      expect(deck.dragging.value).toBe(false)
      deck.onPointerDown(press(0, { pointerType: 'touch' })); deck.onPointerMove(press(150, { pointerType: 'touch' }))
      deck.onPointerCancel()
      expect(deck.dx.value).toBe(0)
      deck.onPointerUp(press(150, { pointerType: 'touch' }))
      vi.advanceTimersByTime(1000)
      expect(deck.position.value).toBe(1)
    })

    it('only the primary button acts: no right or middle click, no second finger', () => {
      const { deck } = make()
      for (const button of [1, 2]) {
        deck.onPointerDown(press(0, { button })); deck.onPointerUp(press(0, { button }))
      }
      deck.onPointerDown(press(0, { pointerType: 'touch', isPrimary: false })); deck.onPointerUp(press(0, { pointerType: 'touch', isPrimary: false }))
      vi.advanceTimersByTime(1000)
      expect(deck.position.value).toBe(1)
      expect(deck.dragging.value).toBe(false)
    })

    it('ignores moves of another pointer while one is down', () => {
      const { deck } = make()
      deck.onPointerDown(press(0))
      deck.onPointerMove(press(200, { pointerId: 2 }))
      expect(deck.dx.value).toBe(0)
      deck.onPointerUp(press(0, { pointerId: 2 }))
      expect(deck.dragging.value).toBe(true)
    })

    it('a swipe dropped on a full queue puts the card back at its home position', () => {
      const { deck } = make(30)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(-120))
      expect(deck.dx.value).toBe(-120)
      // keys fill the flight plus the queue while the drag is still going
      for (let i = 0; i < 1 + DECK_QUEUE_MAX; i++) deck.next()
      deck.onPointerUp(press(-120))
      expect(deck.dx.value).toBe(0)
      vi.advanceTimersByTime(FLY * 30)
      // the dropped swipe changed nothing: only the 9 accepted moves ran
      expect(deck.position.value).toBe(1 + 1 + DECK_QUEUE_MAX)
      expect(deck.frontX.value).toBe(0)
      // and the deck still takes a normal swipe afterwards
      deck.onPointerDown(press(0)); deck.onPointerMove(press(-100)); deck.onPointerUp(press(-100))
      vi.advanceTimersByTime(FLY * 3)
      expect(deck.position.value).toBe(1 + 1 + DECK_QUEUE_MAX + 1)
    })

    it('a tap during a fly-off is queued, a drag during a fly-off is not', () => {
      const { deck } = make(6)
      deck.next()
      deck.onPointerDown(press(0)); deck.onPointerUp(press(0))
      expect(deck.dragging.value).toBe(false)
      deck.onPointerDown(press(0)); deck.onPointerMove(press(150))
      expect(deck.dx.value).toBe(0)
      deck.onPointerUp(press(150))
      vi.advanceTimersByTime(FLY * 3)
      expect(deck.position.value).toBe(3)
    })
  })

  describe('keyboard', () => {
    it('on a 1-card (or empty) deck the arrow keys are not consumed: the key reaches the page', () => {
      for (const n of [1, 0]) {
        const { deck } = make(n)
        const preventDefault = vi.fn()
        const target = {} as EventTarget
        expect(deck.onKeydown(key('ArrowRight', { target, currentTarget: target, preventDefault }))).toBe(false)
        expect(deck.onKeydown(key('ArrowLeft', { target, currentTarget: target, preventDefault }))).toBe(false)
        expect(preventDefault).not.toHaveBeenCalled()
      }
    })

    it('a deck that grows from 1 to 2 cards consumes the keys again (sequence)', async () => {
      const { deck, count } = make(1)
      const preventDefault = vi.fn()
      expect(deck.onKeydown(key('ArrowRight', { preventDefault }))).toBe(false)
      count.value = 2
      await nextTick()
      expect(deck.onKeydown(key('ArrowRight', { preventDefault }))).toBe(true)
      expect(preventDefault).toHaveBeenCalledTimes(1)
    })

    it('ArrowRight is next, ArrowLeft is prev, both prevent the page scroll', () => {
      const { deck } = make()
      const preventDefault = vi.fn()
      const target = {} as EventTarget
      expect(deck.onKeydown(key('ArrowRight', { target, currentTarget: target, preventDefault }))).toBe(true)
      vi.advanceTimersByTime(FLY)
      expect(deck.position.value).toBe(2)
      expect(deck.onKeydown(key('ArrowLeft', { target, currentTarget: target, preventDefault }))).toBe(true)
      vi.advanceTimersByTime(STEP)
      expect(deck.position.value).toBe(1)
      expect(preventDefault).toHaveBeenCalledTimes(2)
    })

    it('ignores modifiers, other keys, and keys from inside the deck (a chevron has focus)', () => {
      const { deck } = make()
      for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
        expect(deck.onKeydown(key('ArrowRight', { [mod]: true }))).toBe(false)
      }
      expect(deck.onKeydown(key('Enter'))).toBe(false)
      expect(deck.onKeydown(key(' '))).toBe(false)
      expect(deck.onKeydown(key('ArrowRight', { target: {} as EventTarget, currentTarget: {} as EventTarget }))).toBe(false)
      vi.advanceTimersByTime(1000)
      expect(deck.position.value).toBe(1)
    })
  })

  describe('reduced motion', () => {
    it('applies every move at once: no fly-off, no slide, queued input too', () => {
      reduceMotion(true)
      const { deck } = make()
      deck.next()
      expect(deck.position.value).toBe(2)
      expect(deck.frontX.value).toBe(0)
      deck.next(); deck.next()
      expect(deck.position.value).toBe(4)
      deck.prev()
      expect(deck.position.value).toBe(3)
      expect(deck.moving.value).toBeNull()
    })

    it('drag feedback stays, and a swipe swaps at once', () => {
      reduceMotion(true)
      const { deck } = make()
      deck.onPointerDown(press(0)); deck.onPointerMove(press(50))
      expect(deck.frontX.value).toBe(50)
      deck.onPointerMove(press(120)); deck.onPointerUp(press(120))
      expect(deck.position.value).toBe(2)
      expect(deck.dx.value).toBe(0)
    })

    it('is read when a move starts, not at import', () => {
      const { deck } = make()
      reduceMotion(true)
      deck.next()
      expect(deck.position.value).toBe(2)
    })
  })

  describe('announcement', () => {
    it('stays empty until the first settled change', () => {
      const { deck } = make()
      expect(deck.announceIndex.value).toBeNull()
      deck.next()
      vi.advanceTimersByTime(DECK_OUT_MS - 1)
      expect(deck.announceIndex.value).toBeNull()
      vi.advanceTimersByTime(1)
      expect(deck.announceIndex.value).toBe(1)
    })

    it('a queued burst announces once, for the settled card', () => {
      const { deck } = make(8)
      const seen: Array<number | null> = []
      scope!.run(() => watch(deck.announceIndex, v => seen.push(v), { flush: 'sync' }))
      for (let i = 0; i < 4; i++) deck.next()
      vi.advanceTimersByTime(FLY * 4)
      expect(seen).toEqual([4])
    })

    it('announces a wrap back to the first card, not a move that ends where it started', () => {
      const { deck } = make(2)
      deck.next(); vi.advanceTimersByTime(FLY)
      expect(deck.announceIndex.value).toBe(1)
      deck.next(); vi.advanceTimersByTime(FLY)
      expect(deck.announceIndex.value).toBe(0)
    })
  })

  describe('lifecycle', () => {
    it('clears timers on dispose and writes no state afterwards', () => {
      const { deck } = make()
      deck.next(); deck.next()
      scope!.stop()
      vi.advanceTimersByTime(2000)
      expect(deck.position.value).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('a changed card list resets the deck and drops the queue', async () => {
      const { deck, key: listKey } = make(5)
      deck.next(); deck.next(); deck.next()
      vi.advanceTimersByTime(DECK_OUT_MS)
      expect(deck.position.value).toBe(2)
      listKey.value = 'b'
      await nextTick()
      expect(deck.position.value).toBe(1)
      expect(deck.announceIndex.value).toBeNull()
      vi.advanceTimersByTime(2000)
      expect(deck.position.value).toBe(1)
    })
  })
})
