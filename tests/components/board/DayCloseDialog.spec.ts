import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import DayCloseDialog from '~/components/board/DayCloseDialog.vue'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'

const handleError = vi.hoisted(() => vi.fn())

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError }) }))
vi.mock('~/composables/useDayClose', () => ({
  useDayClose: () => ({ isOpen: ref(true), close: vi.fn(), restoreFocus: vi.fn() }),
  useDayCloseData: () => ({
    done: ref([{ id: 'd1', title: 'Done task', timeSpentSeconds: 60 }]),
    inFlight: ref([]),
    totalSeconds: ref(60),
  }),
}))
vi.mock('~/components/board/DayCloseBody.vue', () => ({ default: { template: '<div />' } }))

// Slot-rendering stubs for the Nuxt UI shells (jsdom has no portal/dialog support)
const ModalStub = { template: '<div><slot name="body" /><slot name="footer" /></div>' }
const ButtonStub = { template: '<button v-bind="$attrs"><slot /></button>' }
const IconStub = { props: ['name'], template: '<i :data-icon="name" />' }

function mountDialog() {
  return mount(DayCloseDialog, {
    global: { stubs: { UModal: ModalStub, UDrawer: ModalStub, UButton: ButtonStub, UIcon: IconStub } },
  })
}

describe('DayCloseDialog copy summary', () => {
  beforeEach(() => {
    handleError.mockClear()
    toastAddMock.mockClear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('confirms in the button and an in-dialog announcement, without a toast, when the clipboard write succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const wrapper = mountDialog()
      const button = wrapper.get('[data-testid="day-close-copy"]')
      const visibleState = () => button.findAll('span span')
        .filter(span => !span.classes('invisible'))
        .map(span => `${span.get('i').attributes('data-icon')} ${span.text()}`)
      expect(visibleState()).toEqual(['i-ph-copy Zusammenfassung kopieren'])

      await button.trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      expect(writeText).toHaveBeenCalledOnce()
      expect(toastAddMock).not.toHaveBeenCalled()
      expect(handleError).not.toHaveBeenCalled()
      expect(visibleState()).toEqual(['i-ph-check Kopiert'])
      expect(wrapper.get('[data-testid="day-close-status"]').text()).toBe('Zusammenfassung kopiert')

      await vi.advanceTimersByTimeAsync(2999)
      expect(visibleState()).toEqual(['i-ph-check Kopiert'])
      await vi.advanceTimersByTimeAsync(1)
      expect(visibleState()).toEqual(['i-ph-copy Zusammenfassung kopieren'])
      expect(wrapper.get('[data-testid="day-close-status"]').text()).toBe('')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('footer: one markup without a hand-set floor, Fertig is the only primary and the `lg` CTA (#551, #552)', () => {
    const wrapper = mountDialog()
    const copy = wrapper.get('[data-testid="day-close-copy"]')
    const done = wrapper.get('[data-testid="day-close-done-button"]')
    // The 44 px phone floor comes from the button theme (tests/config/button-ladder.test.ts), not from a class here
    expect(copy.classes()).not.toContain('touch-target')
    expect(done.classes()).not.toContain('touch-target')
    expect(copy.attributes('variant')).toBe('soft')
    expect(done.attributes('color')).toBe('primary')
    expect(wrapper.findAll('button[color="primary"]')).toHaveLength(1)
    // One footer for modal and drawer: the CTA is `lg` in both, the sibling keeps the default `md`
    expect(copy.attributes('size')).toBeUndefined()
    expect(done.attributes('size')).toBe('lg')
  })

  it('routes a clipboard failure through useErrorHandler with the clipboard context, without a success state', async () => {
    const failure = new Error('denied')
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(failure) } })
    const wrapper = mountDialog()
    await wrapper.get('[data-testid="day-close-copy"]').trigger('click')
    await flushPromises()
    expect(handleError).toHaveBeenCalledWith(failure, 'clipboard')
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="day-close-copy"] .invisible').text()).toBe('Kopiert')
    expect(wrapper.get('[data-testid="day-close-status"]').text()).toBe('')
  })

  it('treats a missing clipboard API as a failure too', async () => {
    vi.stubGlobal('navigator', {})
    const wrapper = mountDialog()
    await wrapper.get('[data-testid="day-close-copy"]').trigger('click')
    await flushPromises()
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'clipboard')
    expect(toastAddMock).not.toHaveBeenCalled()
  })
})
