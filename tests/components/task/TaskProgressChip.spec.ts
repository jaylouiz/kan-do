import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TaskProgressChip from '~/components/task/TaskProgressChip.vue'
import { rememberInJetzt, resetTimeboxChipMemory } from '~/lib/timeboxChipMemory'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { setTestLocale } from '../../helpers/i18n'

interface ChipProps {
  taskId: string
  timeBoxSeconds: number | null
  timeSpentSeconds: number
  isNow: boolean
}

/** Every mounted chip watches the shared drag state: unmount them between tests so none reacts to another test's drag */
const mounted: Array<ReturnType<typeof mount>> = []
const render = (props: Partial<ChipProps> = {}) => {
  const wrapper = mount(TaskProgressChip, {
    props: { taskId: 't1', timeBoxSeconds: 2700, timeSpentSeconds: 720, isNow: false, ...props },
    global: { stubs: { UIcon: true, Transition: false } },
  })
  mounted.push(wrapper)
  return wrapper
}

const bar = (w: ReturnType<typeof render>) => w.find('[data-testid="task-progress-chip"]')

const { dragState } = useBoardDragState()

beforeEach(() => {
  resetTimeboxChipMemory()
  dragState.value.draggedTaskId = null
})
afterEach(() => mounted.splice(0).forEach(w => w.unmount()))

describe('TaskProgressChip (#388)', () => {
  describe('labels', () => {
    it('shows the timebox in the collapsed chip and the spent time inside the bar', () => {
      const w = render()
      expect(bar(w).find('.chip__box').text()).toBe('45 min')
      expect(bar(w).find('.chip__spent-inner').text()).toBe('12 min')
    })

    it('reads <1 min in the first minute', () => {
      expect(bar(render({ timeSpentSeconds: 0 })).find('.chip__spent-inner').text()).toBe('<1 min')
      expect(bar(render({ timeSpentSeconds: 59 })).find('.chip__spent-inner').text()).toBe('<1 min')
      expect(bar(render({ timeSpentSeconds: 60 })).find('.chip__spent-inner').text()).toBe('1 min')
    })

    it('uses the clock format for an hour and more', () => {
      expect(bar(render({ timeBoxSeconds: 5400 })).find('.chip__box').text()).toBe('1:30 h')
    })

    it('keeps the visible texts inside the progressbar and the sizer out of the accessibility tree', () => {
      const w = render()
      expect(bar(w).text()).toContain('45 min')
      expect(w.find('.chip__sizer').attributes('aria-hidden')).toBe('true')
      expect(bar(w).find('.chip__icon').attributes('aria-hidden')).toBe('true')
    })
  })

  describe('percent and tone', () => {
    const percentOf = (spent: number, box = 1000) => bar(render({ timeBoxSeconds: box, timeSpentSeconds: spent })).attributes('aria-valuenow')

    it('rounds the percent and clamps it to 0-100', () => {
      expect(percentOf(0)).toBe('0')
      expect(percentOf(333)).toBe('33')
      expect(percentOf(1000)).toBe('100')
      expect(percentOf(2500)).toBe('100')
    })

    it('sets the fill share as a custom property, clamped', () => {
      expect(render({ timeBoxSeconds: 1000, timeSpentSeconds: 250 }).find('.chip-slot').attributes('style')).toContain('--chip-p: 25%')
      expect(render({ timeBoxSeconds: 1000, timeSpentSeconds: 5000 }).find('.chip-slot').attributes('style')).toContain('--chip-p: 100%')
    })

    it.each([
      [800, 'chip--primary'],
      [801, 'chip--warning'],
      [1000, 'chip--warning'],
      [4000, 'chip--warning'],
    ])('in Jetzt, %i of 1000 s is %s', (spent, cls) => {
      const w = render({ timeBoxSeconds: 1000, timeSpentSeconds: spent, isNow: true })
      expect(bar(w).classes()).toContain(cls)
    })

    it('carries no tone outside Jetzt, also not on overrun', () => {
      const w = render({ timeBoxSeconds: 1000, timeSpentSeconds: 4000, isNow: false })
      expect(bar(w).classes()).toContain('chip--idle')
      expect(bar(w).classes()).not.toContain('chip--warning')
    })
  })

  describe('with a timebox', () => {
    it('is collapsed outside Jetzt and expanded in Jetzt (page load: no animation)', () => {
      expect(bar(render()).classes()).not.toContain('chip--now')
      expect(bar(render({ taskId: 'now', isNow: true })).classes()).toContain('chip--now')
    })

    it('is always there, even with nothing spent', () => {
      expect(render({ timeSpentSeconds: 0 }).find('.chip-slot').exists()).toBe(true)
    })
  })

  describe('without a timebox', () => {
    it('has no label outside Jetzt while nothing was spent', () => {
      expect(render({ timeBoxSeconds: null, timeSpentSeconds: 0 }).find('.chip-slot').exists()).toBe(false)
    })

    it('shows a quiet spent-time chip outside Jetzt once time was spent, no bar', () => {
      const w = render({ timeBoxSeconds: null, timeSpentSeconds: 720 })
      expect(bar(w).text()).toBe('12 min')
      expect(bar(w).classes()).toContain('chip--boxless')
      expect(bar(w).classes()).not.toContain('chip--now')
      expect(bar(w).find('.chip__spent').exists()).toBe(false)
    })

    it('shows the spent time in Jetzt, <1 min at the start, counting forward', async () => {
      const w = render({ timeBoxSeconds: null, timeSpentSeconds: 0, isNow: true })
      expect(bar(w).text()).toBe('<1 min')
      expect(bar(w).classes()).toContain('chip--now')
      await w.setProps({ timeSpentSeconds: 125 })
      expect(bar(w).text()).toBe('2 min')
    })

    it('has no percent (indeterminate progressbar), the name is the spent time', () => {
      const w = render({ timeBoxSeconds: null, timeSpentSeconds: 720, isNow: true })
      expect(bar(w).attributes('aria-valuenow')).toBeUndefined()
      expect(bar(w).attributes('aria-label')).toBe('Bisher gearbeitet: 12 min')
    })

    it('treats a timebox of 0 as none', () => {
      expect(render({ timeBoxSeconds: 0, timeSpentSeconds: 0 }).find('.chip-slot').exists()).toBe(false)
    })
  })

  describe('accessibility', () => {
    it('is a progressbar from 0 to 100 named after spent and timebox', () => {
      const w = render()
      expect(bar(w).attributes('role')).toBe('progressbar')
      expect(bar(w).attributes('aria-valuemin')).toBe('0')
      expect(bar(w).attributes('aria-valuemax')).toBe('100')
      expect(bar(w).attributes('aria-valuenow')).toBe('27')
      expect(bar(w).attributes('aria-label')).toBe('Timebox: 12 min von 45 min')
    })

    it('speaks English', () => {
      setTestLocale('en')
      expect(bar(render()).attributes('aria-label')).toBe('Timebox: 12 min of 45 min')
      expect(bar(render({ timeBoxSeconds: null })).attributes('aria-label')).toBe('Time spent: 12 min')
    })

    it('has no live region and no value text that churns every second', () => {
      const w = render({ isNow: true })
      expect(w.find('[aria-live]').exists()).toBe(false)
      expect(bar(w).attributes('aria-valuetext')).toBeUndefined()
    })
  })

  describe('state changes', () => {
    it('expands when the card enters Jetzt and collapses when it leaves, keeping the fill', async () => {
      const w = render({ timeSpentSeconds: 1350 })
      await w.setProps({ isNow: true })
      await vi.waitFor(() => expect(bar(w).classes()).toContain('chip--now'))
      await w.setProps({ isNow: false })
      expect(bar(w).classes()).not.toContain('chip--now')
      expect(w.find('.chip-slot').attributes('style')).toContain('--chip-p: 50%')
    })

    it('follows the running timer: the fill and the tone move with timeSpentSeconds', async () => {
      const w = render({ timeBoxSeconds: 1000, timeSpentSeconds: 790, isNow: true })
      expect(bar(w).classes()).toContain('chip--primary')
      await w.setProps({ timeSpentSeconds: 810 })
      expect(bar(w).classes()).toContain('chip--warning')
      expect(w.find('.chip-slot').attributes('style')).toContain('--chip-p: 81%')
    })
  })

  describe('across a remount (a cross-column move mounts a fresh card)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('lands in Jetzt collapsed and grows on the next frames', async () => {
      rememberInJetzt('t1', false)
      const w = render({ isNow: true })
      expect(bar(w).classes()).not.toContain('chip--now')
      await vi.runAllTimersAsync()
      await nextTick()
      expect(bar(w).classes()).toContain('chip--now')
    })

    it('the drag preview starts as the bar and shrinks at once', async () => {
      rememberInJetzt('t1', true)
      const w = render({ isNow: false })
      expect(bar(w).classes()).toContain('chip--now')
      await vi.runAllTimersAsync()
      await nextTick()
      expect(bar(w).classes()).not.toContain('chip--now')
    })

    it('after the drop the card in its column starts collapsed (no second animation)', () => {
      render({ isNow: false }) // the preview records "not in Jetzt"
      const landed = render({ isNow: false })
      expect(bar(landed).classes()).not.toContain('chip--now')
    })

    it('remembers per task: another task is not affected', () => {
      rememberInJetzt('t1', true)
      expect(bar(render({ taskId: 'other', isNow: false })).classes()).not.toContain('chip--now')
    })
  })

  describe('while its own card is dragged and dropped back into Jetzt (#411: the card stays mounted)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    /** A pick-up: the board names the dragged task, then the preview chip mounts and writes "not in Jetzt" */
    const lift = async () => {
      dragState.value.draggedTaskId = 't1'
      await nextTick()
      const preview = render({ isNow: false })
      await vi.runAllTimersAsync()
      await nextTick()
      return preview
    }
    const drop = async () => {
      dragState.value.draggedTaskId = null
      await nextTick()
      await vi.runAllTimersAsync()
      await nextTick()
    }

    it('shrinks with the lift and grows again with the drop, every round', async () => {
      const w = render({ isNow: true })
      await vi.runAllTimersAsync()
      await nextTick()
      for (let round = 0; round < 3; round++) {
        dragState.value.draggedTaskId = 't1'
        const preview = render({ isNow: false })
        // the preview starts as the bar, whatever the lift did to the card behind it
        expect(bar(preview).classes()).toContain('chip--now')
        await vi.runAllTimersAsync()
        await nextTick()
        expect(bar(preview).classes()).not.toContain('chip--now')
        expect(bar(w).classes()).not.toContain('chip--now')
        await drop()
        expect(bar(w).classes()).toContain('chip--now')
      }
    })

    it('the grow waits for the frames after the drop, so the bar has a collapsed style to ease from (#540)', async () => {
      const w = render({ isNow: true })
      await vi.runAllTimersAsync()
      await lift()
      expect(bar(w).classes()).not.toContain('chip--now')
      dragState.value.draggedTaskId = null
      await nextTick()
      expect(bar(w).classes()).not.toContain('chip--now') // same task as the DOM move: still collapsed
      await vi.runAllTimersAsync() // the frames pass
      await nextTick()
      expect(bar(w).classes()).toContain('chip--now')
    })

    it('a pick-up after a Jetzt -> Jetzt drop starts the preview as the bar again', async () => {
      render({ isNow: true })
      await vi.runAllTimersAsync()
      await lift()
      await drop()
      expect(bar(render({ isNow: false })).classes()).toContain('chip--now')
    })

    it('a drop into another column leaves the memory at "not in Jetzt": the landed card starts collapsed', async () => {
      const w = render({ isNow: true })
      await vi.runAllTimersAsync()
      await lift()
      // the store moves the card and the board clears its drag state in one tick: the old chip is gone first
      w.unmount()
      await drop()
      expect(bar(render({ isNow: false })).classes()).not.toContain('chip--now')
    })

    it('a boxless chip with nothing spent leaves with the lift and pops in again on the drop', async () => {
      const w = render({ isNow: true, timeBoxSeconds: null, timeSpentSeconds: 0 })
      await vi.runAllTimersAsync()
      expect(bar(w).exists()).toBe(true)
      dragState.value.draggedTaskId = 't1'
      await nextTick()
      expect(bar(w).exists()).toBe(false)
      await drop()
      expect(bar(w).exists()).toBe(true)
      expect(bar(w).classes()).toContain('chip--now')
    })
  })

  it('a boxless chip with nothing spent mounts on the drop and is the bar at once: it only pops, no morph (#540)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    try {
      const w = render({ isNow: true, timeBoxSeconds: null, timeSpentSeconds: 0 })
      await vi.runAllTimersAsync()
      dragState.value.draggedTaskId = 't1'
      await nextTick()
      expect(bar(w).exists()).toBe(false)
      dragState.value.draggedTaskId = null
      await nextTick() // no frames yet: a chip that has just become visible has no earlier look to ease from
      expect(bar(w).classes()).toContain('chip--now')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('never starts a timer of its own (#352)', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    render({ isNow: true })
    expect(interval).not.toHaveBeenCalled()
    interval.mockRestore()
  })
})
