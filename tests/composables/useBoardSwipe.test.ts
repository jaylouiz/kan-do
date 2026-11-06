import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import {
  applySwipeResistance,
  resolveSwipeAxis,
  resolveSwipeTarget,
  useBoardSwipe,
} from '~/composables/useBoardSwipe'

describe('resolveSwipeAxis', () => {
  it('stays undecided below the slop', () => {
    expect(resolveSwipeAxis(6, 1)).toBeNull()
    expect(resolveSwipeAxis(0, 0)).toBeNull()
  })

  it('locks horizontal when x dominates by the ratio', () => {
    expect(resolveSwipeAxis(15, 4)).toBe('x')
    expect(resolveSwipeAxis(-20, 5)).toBe('x')
  })

  it('locks vertical when y dominates by the ratio', () => {
    expect(resolveSwipeAxis(4, 15)).toBe('y')
    expect(resolveSwipeAxis(-5, -20)).toBe('y')
  })

  it('stays undecided on a near-diagonal movement', () => {
    expect(resolveSwipeAxis(14, 12)).toBeNull()
    expect(resolveSwipeAxis(12, 12)).toBeNull()
  })
})

describe('applySwipeResistance', () => {
  it('follows the finger 1:1 when a neighbour page exists', () => {
    expect(applySwipeResistance(-120, 0, 2)).toBe(-120)
    expect(applySwipeResistance(120, 1, 2)).toBe(120)
    expect(applySwipeResistance(-80, 1, 2)).toBe(-80)
  })

  it('damps a drag past the first page', () => {
    const offset = applySwipeResistance(100, 0, 2)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(100 / 2)
  })

  it('damps a drag past the last page', () => {
    const offset = applySwipeResistance(-100, 2, 2)
    expect(offset).toBeLessThan(0)
    expect(offset).toBeGreaterThan(-100 / 2)
  })
})

describe('resolveSwipeTarget', () => {
  const base = { viewportWidth: 400, tab: 1, lastTab: 2 }

  it('commits to the next page past 25% of the viewport', () => {
    expect(resolveSwipeTarget({ ...base, dx: -101, velocity: 0 })).toBe(2)
    expect(resolveSwipeTarget({ ...base, dx: 101, velocity: 0 })).toBe(0)
  })

  it('snaps back below 25% with a slow release', () => {
    expect(resolveSwipeTarget({ ...base, dx: -99, velocity: -0.1 })).toBe(1)
    expect(resolveSwipeTarget({ ...base, dx: 99, velocity: 0.1 })).toBe(1)
  })

  it('commits a short fast flick by velocity', () => {
    expect(resolveSwipeTarget({ ...base, dx: -30, velocity: -0.6 })).toBe(2)
    expect(resolveSwipeTarget({ ...base, dx: 30, velocity: 0.6 })).toBe(0)
  })

  it('ignores a flick that disagrees with the drag direction', () => {
    expect(resolveSwipeTarget({ ...base, dx: -30, velocity: 0.6 })).toBe(1)
  })

  it('never leaves the page range', () => {
    expect(resolveSwipeTarget({ ...base, tab: 0, dx: 300, velocity: 1 })).toBe(0)
    expect(resolveSwipeTarget({ ...base, tab: 2, dx: -300, velocity: -1 })).toBe(2)
  })
})

describe('useBoardSwipe', () => {
  let scope: ReturnType<typeof effectScope>
  let enabled: Ref<boolean>
  let tab: Ref<number>
  let onCommit: Mock<(tab: number) => void>
  let swipe: ReturnType<typeof useBoardSwipe>

  const point = (type: string, x: number, y: number, t: number, init: { pointerId?: number, pointerType?: string, isPrimary?: boolean } = {}) => {
    const event = new Event(type, { bubbles: true })
    Object.defineProperties(event, {
      clientX: { value: x },
      clientY: { value: y },
      timeStamp: { value: t },
      pointerId: { value: init.pointerId ?? 1 },
      pointerType: { value: init.pointerType ?? 'touch' },
      isPrimary: { value: init.isPrimary ?? true },
    })
    return event as PointerEvent
  }
  const down = (x: number, y: number, t = 0, init = {}, target?: Element) => {
    const event = point('pointerdown', x, y, t, init)
    if (target) Object.defineProperty(event, 'target', { value: target })
    swipe.onPointerDown(event)
  }
  const move = (x: number, y: number, t: number, init = {}) => document.dispatchEvent(point('pointermove', x, y, t, init))
  const up = (x: number, y: number, t: number) => document.dispatchEvent(point('pointerup', x, y, t))
  const cancel = () => document.dispatchEvent(point('pointercancel', 0, 0, 0))

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    enabled = ref(true)
    tab = ref(1)
    onCommit = vi.fn<(tab: number) => void>()
    scope = effectScope()
    scope.run(() => {
      swipe = useBoardSwipe({
        activeTab: tab,
        lastTab: 2,
        isEnabled: () => enabled.value,
        onCommit,
      })
    })
  })

  afterEach(() => {
    scope.stop()
  })

  it.each(['input', 'textarea', 'select', 'button', 'a'])('ignores a touch starting on <%s>', (tag) => {
    down(300, 300, 0, {}, document.createElement(tag))
    move(240, 302, 16)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('ignores a touch inside the add-task bar or a contenteditable', () => {
    const slot = document.createElement('div')
    slot.className = 'add-task-slot'
    const inner = document.createElement('span')
    slot.appendChild(inner)
    down(300, 300, 0, {}, inner)
    move(240, 302, 16)
    expect(swipe.isSwiping.value).toBe(false)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    down(300, 300, 0, {}, editable)
    move(240, 302, 32)
    expect(swipe.isSwiping.value).toBe(false)
  })

  it('recovers from a stale tracking state on the next primary touch', () => {
    down(300, 300, 0, { pointerId: 1 })
    // pointer 1 vanished without up/cancel; a new primary touch must start a fresh swipe
    down(300, 300, 100, { pointerId: 2 })
    move(285, 302, 116, { pointerId: 2 })
    move(240, 310, 132, { pointerId: 2 })
    expect(swipe.isSwiping.value).toBe(true)
    expect(swipe.offsetPx.value).toBe(-60)
  })

  it('still aborts when a non-primary second finger lands', () => {
    down(300, 300, 0, { pointerId: 1 })
    move(285, 302, 16)
    move(240, 310, 32)
    down(100, 300, 40, { pointerId: 2, isPrimary: false })
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  describe('with an overlay open', () => {
    let dialog: HTMLElement
    beforeEach(() => {
      dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
    })
    afterEach(() => dialog.remove())

    it('does not start a swipe', () => {
      document.body.appendChild(dialog)
      down(300, 300)
      move(240, 302, 16)
      expect(swipe.isSwiping.value).toBe(false)
    })

    it('aborts a live swipe when an overlay opens', () => {
      down(300, 300)
      move(285, 302, 16)
      move(240, 310, 32)
      expect(swipe.isSwiping.value).toBe(true)
      document.body.appendChild(dialog)
      move(200, 310, 48)
      expect(swipe.isSwiping.value).toBe(false)
      expect(swipe.offsetPx.value).toBe(0)
    })
  })

  it('does nothing until the slop is passed', () => {
    down(200, 300)
    move(205, 302, 16)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('locks vertical and never moves the board', () => {
    down(200, 300)
    move(203, 330, 16)
    move(260, 400, 32)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
    up(260, 400, 48)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('stays vertically locked even if the finger later drifts sideways', () => {
    down(200, 300)
    move(203, 330, 16)
    move(80, 340, 32)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('locks horizontal and follows the finger', () => {
    down(300, 300)
    move(285, 302, 16)
    move(240, 310, 32)
    expect(swipe.isSwiping.value).toBe(true)
    expect(swipe.offsetPx.value).toBe(-60)
  })

  it('stays horizontally locked when the finger later drifts vertically', () => {
    down(300, 300)
    move(280, 302, 16)
    move(250, 400, 32)
    expect(swipe.isSwiping.value).toBe(true)
    expect(swipe.offsetPx.value).toBe(-50)
  })

  it('commits on distance and resets the live offset', () => {
    down(300, 300)
    move(280, 300, 100)
    move(150, 300, 600)
    up(150, 300, 1100)
    expect(onCommit).toHaveBeenCalledWith(2)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('commits a short fast flick by velocity', () => {
    down(300, 300)
    move(280, 300, 20)
    move(260, 300, 40)
    move(240, 300, 60)
    up(240, 300, 70)
    expect(onCommit).toHaveBeenCalledWith(2)
  })

  it('snaps back on a short slow release', () => {
    down(300, 300)
    move(280, 300, 200)
    move(250, 300, 800)
    up(250, 300, 1400)
    expect(onCommit).not.toHaveBeenCalled()
    expect(swipe.offsetPx.value).toBe(0)
    expect(swipe.isSwiping.value).toBe(false)
  })

  it('snaps back on pointercancel without changing the tab', () => {
    down(300, 300)
    move(200, 300, 16)
    expect(swipe.offsetPx.value).not.toBe(0)
    cancel()
    expect(onCommit).not.toHaveBeenCalled()
    expect(swipe.offsetPx.value).toBe(0)
    expect(swipe.isSwiping.value).toBe(false)
  })

  it('damps the drag past the first page', () => {
    tab.value = 0
    down(100, 300)
    move(130, 300, 16)
    move(260, 300, 32)
    expect(swipe.offsetPx.value).toBeGreaterThan(0)
    expect(swipe.offsetPx.value).toBeLessThan(130)
    up(260, 300, 2000)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('ignores mouse pointers', () => {
    down(300, 300, 0, { pointerType: 'mouse' })
    move(100, 300, 16)
    expect(swipe.isSwiping.value).toBe(false)
  })

  it('ignores a second finger and cancels the swipe', () => {
    down(300, 300)
    move(240, 300, 16)
    expect(swipe.isSwiping.value).toBe(true)
    down(100, 300, 20, { pointerId: 2, isPrimary: false })
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('does not start while disabled (dnd-kit drag active or desktop)', () => {
    enabled.value = false
    down(300, 300)
    move(200, 300, 16)
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
  })

  it('stands down mid-swipe when a drag becomes active and does not switch the tab on release', async () => {
    down(300, 300)
    move(240, 300, 16)
    expect(swipe.isSwiping.value).toBe(true)
    enabled.value = false
    await nextTick()
    expect(swipe.isSwiping.value).toBe(false)
    expect(swipe.offsetPx.value).toBe(0)
    move(60, 300, 32)
    up(60, 300, 48)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('removes document listeners on scope dispose', () => {
    down(300, 300)
    scope.stop()
    move(100, 300, 16)
    expect(swipe.offsetPx.value).toBe(0)
  })
})
