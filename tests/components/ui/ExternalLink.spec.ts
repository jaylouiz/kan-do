import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ExternalLink from '~/components/ui/ExternalLink.vue'

const openUrlMock = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

function setDesktop(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

describe('ExternalLink', () => {
  beforeEach(() => { openUrlMock.mockReset(); handleErrorMock.mockReset(); setDesktop(true) })
  afterEach(() => setDesktop(false))

  it('hands the URL to the opener on desktop', async () => {
    openUrlMock.mockResolvedValue(undefined)
    const wrapper = mount(ExternalLink, { props: { href: 'https://example.com' }, slots: { default: 'x' } })
    await wrapper.trigger('click')
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledWith('https://example.com'))
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('reports a rejecting opener through useErrorHandler without throwing (#245 L6)', async () => {
    const failure = new Error('not allowed')
    openUrlMock.mockRejectedValue(failure)
    const wrapper = mount(ExternalLink, { props: { href: 'https://example.com' }, slots: { default: 'x' } })
    await wrapper.trigger('click')
    await vi.waitFor(() => expect(handleErrorMock).toHaveBeenCalledWith(failure, 'external_link'))
  })

  it('does nothing special on web (plain link)', async () => {
    setDesktop(false)
    const wrapper = mount(ExternalLink, { props: { href: 'https://example.com' }, slots: { default: 'x' } })
    await wrapper.trigger('click')
    expect(openUrlMock).not.toHaveBeenCalled()
  })
})
