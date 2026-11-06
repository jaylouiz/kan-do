/**
 * #394: the Jetzt focus overlay's state machine, driven with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import {
  KEY_IDLE_MS,
  MOUSE_IDLE_MS,
  RETURN_DELAY_MS,
  SWALLOW_MS,
  TOUCH_IDLE_MS,
  useFocusOverlay,
} from '~/composables/useFocusOverlay'

let wrapper: VueWrapper | null = null

function setup(initial = true) {
  const enabled = ref(initial)
  let api!: ReturnType<typeof useFocusOverlay>
  wrapper = mount(defineComponent({
    setup() {
      api = useFocusOverlay(enabled as Ref<boolean>)
      return () => h('div', [
        h('div', { id: 'column-progress' }, [h('button', { id: 'now-card' })]),
        h('button', { id: 'other-card' }),
        h('nav', { 'data-app-nav': '' }, [h('a', { id: 'bar-link' })]),
        h('div', { class: 'column-footer' }, [h('button', { id: 'cta' })]),
      ])
    },
  }), { attachTo: document.body })
  return { enabled, api }
}

function pointer(type: 'pointermove' | 'pointerdown', init: { x?: number; y?: number; kind?: string; target?: Element } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: init.x ?? 0, clientY: init.y ?? 0, pointerType: init.kind ?? 'mouse' })
  ;(init.target ?? document.body).dispatchEvent(event)
}
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }))
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

describe('useFocusOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is shown at once when enabled on load and hidden when disabled', async () => {
    const { enabled, api } = setup(true)
    expect(api.shown.value).toBe(true)
    enabled.value = false
    await nextTick()
    expect(api.shown.value).toBe(false)
  })

  it('stays hidden while disabled, whatever happens', async () => {
    const { api } = setup(false)
    pointer('pointermove', { x: 50 })
    await advance(MOUSE_IDLE_MS * 2)
    window.dispatchEvent(new Event('blur'))
    expect(api.shown.value).toBe(false)
  })

  it('warms up after a beat when a card arrives (disabled -> enabled)', async () => {
    const { enabled, api } = setup(false)
    enabled.value = true
    await nextTick()
    expect(api.shown.value).toBe(false)
    await advance(RETURN_DELAY_MS - 1)
    expect(api.shown.value).toBe(false)
    await advance(1)
    expect(api.shown.value).toBe(true)
  })

  it('a real mouse move hides it and idle brings it back (A -> B -> A -> B)', async () => {
    const { api } = setup()
    pointer('pointermove', { x: 10, y: 10 })
    expect(api.shown.value).toBe(false)
    await advance(MOUSE_IDLE_MS - 1)
    expect(api.shown.value).toBe(false)
    await advance(1)
    expect(api.shown.value).toBe(true)
    pointer('pointermove', { x: 40, y: 10 })
    expect(api.shown.value).toBe(false)
  })

  it('movement keeps pushing the return back; a jitter under 3px does not hide it', async () => {
    const { api } = setup()
    pointer('pointermove', { x: 10, y: 10 })
    await advance(MOUSE_IDLE_MS - 100)
    pointer('pointermove', { x: 30, y: 10 })
    await advance(MOUSE_IDLE_MS - 100)
    expect(api.shown.value).toBe(false)
    await advance(100)
    expect(api.shown.value).toBe(true)
    pointer('pointermove', { x: 31, y: 11 })
    expect(api.shown.value).toBe(true)
  })

  it('a key press hides it for 4 s; a lone modifier does not', async () => {
    const { api } = setup()
    key('Shift')
    key('Meta')
    expect(api.shown.value).toBe(true)
    key('a')
    expect(api.shown.value).toBe(false)
    await advance(KEY_IDLE_MS - 1)
    expect(api.shown.value).toBe(false)
    await advance(1)
    expect(api.shown.value).toBe(true)
  })

  it('window blur and a hidden tab show it at once; focus acts like a mouse move', async () => {
    const { api } = setup()
    pointer('pointermove', { x: 10, y: 10 })
    window.dispatchEvent(new Event('blur'))
    expect(api.shown.value).toBe(true)
    await advance(MOUSE_IDLE_MS * 2)
    expect(api.shown.value).toBe(true)

    window.dispatchEvent(new Event('focus'))
    expect(api.shown.value).toBe(false)
    await advance(MOUSE_IDLE_MS)
    expect(api.shown.value).toBe(true)

    pointer('pointermove', { x: 90, y: 90 })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.shown.value).toBe(true)
  })

  it('leaving the enabled state while a return is pending cancels it', async () => {
    const { enabled, api } = setup()
    pointer('pointermove', { x: 10, y: 10 })
    enabled.value = false
    await nextTick()
    await advance(MOUSE_IDLE_MS * 2)
    expect(api.shown.value).toBe(false)
  })

  describe('touch', () => {
    const other = () => document.getElementById('other-card')!
    const now = () => document.getElementById('now-card')!

    it('the first tap outside hides it and is swallowed; it returns after 8 s without a tap', async () => {
      const { api } = setup()
      pointer('pointerdown', { kind: 'touch', target: other() })
      expect(api.shown.value).toBe(false)
      expect(api.pointerKind.value).toBe('touch')
      expect(api.swallowTap.value).toBe(true)
      await advance(SWALLOW_MS)
      expect(api.swallowTap.value).toBe(false)

      // the next tap works normally (not swallowed) and restarts the timer
      await advance(TOUCH_IDLE_MS - SWALLOW_MS - 1000)
      pointer('pointerdown', { kind: 'touch', target: other() })
      expect(api.swallowTap.value).toBe(false)
      await advance(TOUCH_IDLE_MS - 1)
      expect(api.shown.value).toBe(false)
      await advance(1)
      expect(api.shown.value).toBe(true)
    })

    it('a tap on the Now card keeps the overlay and swallows nothing', async () => {
      const { api } = setup()
      pointer('pointerdown', { kind: 'touch', target: now() })
      expect(api.shown.value).toBe(true)
      expect(api.swallowTap.value).toBe(false)
    })

    it('phone: the first tap on the nav pill is a plain interaction: nothing hides, nothing is swallowed (#470)', async () => {
      window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q === '(max-width: 767px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
      const { api } = setup()
      pointer('pointerdown', { kind: 'touch', target: document.getElementById('bar-link')! })
      expect(api.shown.value).toBe(true)
      expect(api.swallowTap.value).toBe(false)
      // ...while the same first tap on the Erledigt CTA hides it (it sits below the overlay, #503)
      pointer('pointerdown', { kind: 'touch', target: document.getElementById('cta')! })
      expect(api.shown.value).toBe(false)
      expect(api.swallowTap.value).toBe(true)
    })

    it('desktop width with touch (tablet): a tap on the app bar is a plain interaction, the Erledigt CTA still hides and is swallowed (#694, reverses #503 for the bar)', async () => {
      const { api } = setup()
      pointer('pointerdown', { kind: 'touch', target: document.getElementById('bar-link')! })
      expect(api.shown.value).toBe(true)
      expect(api.swallowTap.value).toBe(false)
      pointer('pointerdown', { kind: 'touch', target: document.getElementById('cta')! })
      expect(api.shown.value).toBe(false)
      expect(api.swallowTap.value).toBe(true)
    })

    it('a tap on the Now card while hidden only restarts the 8 s timer', async () => {
      const { api } = setup()
      pointer('pointerdown', { kind: 'touch', target: other() })
      await advance(TOUCH_IDLE_MS - 1000)
      pointer('pointerdown', { kind: 'touch', target: now() })
      await advance(TOUCH_IDLE_MS - 1)
      expect(api.shown.value).toBe(false)
      await advance(1)
      expect(api.shown.value).toBe(true)
    })
  })
})
