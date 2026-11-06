/**
 * #422 review F2/F6: pointer and focus hold a delete window open as two flags; a container that unmounts while
 * holding (Escape in the day-close dialog with focus on "Rückgängig") releases its windows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const pauseDelete = vi.fn()
const resumeDelete = vi.fn()
vi.mock('~/composables/useTaskDeletion', () => ({
  useTaskDeletion: () => ({ pauseDelete, resumeDelete }),
}))

// eslint-disable-next-line import/first -- order-sensitive: the mock must be registered before the SUT is imported
import { useDeleteHold } from '~/composables/useDeleteHold'

function mountHolder() {
  let api!: ReturnType<typeof useDeleteHold>
  const wrapper = mount(defineComponent({
    setup() {
      api = useDeleteHold()
      return () => h('div')
    },
  }))
  return { wrapper, api: () => api }
}

describe('useDeleteHold (#422)', () => {
  beforeEach(() => {
    pauseDelete.mockReset()
    resumeDelete.mockReset()
  })

  it('resumes only when pointer and focus have both left', () => {
    const { api } = mountHolder()
    api().hold('a', 'pointer', true)
    api().hold('a', 'focus', true)
    api().hold('a', 'pointer', false)
    expect(resumeDelete).not.toHaveBeenCalled()
    api().hold('a', 'focus', false)
    expect(resumeDelete).toHaveBeenCalledTimes(1)
    expect(resumeDelete).toHaveBeenCalledWith('a')
  })

  it('focus moving inside the container is not a leave', () => {
    const { api } = mountHolder()
    const container = document.createElement('div')
    const inner = document.createElement('button')
    container.append(inner)
    api().hold('a', 'focus', true)
    api().onFocusOut('a', { currentTarget: container, relatedTarget: inner } as unknown as FocusEvent)
    expect(resumeDelete).not.toHaveBeenCalled()
    api().onFocusOut('a', { currentTarget: container, relatedTarget: null } as unknown as FocusEvent)
    expect(resumeDelete).toHaveBeenCalledWith('a')
  })

  it('unmounting while held resumes the window (no focusout/pointerleave fires for a removed node)', () => {
    const { wrapper, api } = mountHolder()
    api().hold('a', 'focus', true)
    api().hold('b', 'pointer', true)
    expect(resumeDelete).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(resumeDelete.mock.calls.map(call => call[0]).sort()).toEqual(['a', 'b'])
  })

  it('unmounting without a hold resumes nothing', () => {
    const { wrapper } = mountHolder()
    wrapper.unmount()
    expect(resumeDelete).not.toHaveBeenCalled()
  })
})
