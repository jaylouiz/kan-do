import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import TaskSheet from '~/components/task/TaskSheet.vue'

/**
 * Mirrors vaul-vue's DrawerRoot: it watches `open` with `immediate: true` and emits
 * `update:open` with the current value on mount, also while the drawer is closed.
 */
const UDrawer = defineComponent({
  props: { open: Boolean },
  emits: ['update:open', 'after:enter', 'after:leave'],
  watch: {
    open: { handler(this: { $emit: (e: 'update:open', v: boolean) => void }, value: boolean) { this.$emit('update:open', value) }, immediate: true },
  },
  render() { return h('div', { 'data-testid': 'drawer' }) },
})

const mountSheet = async (open: boolean) => {
  const wrapper = mount(TaskSheet, {
    props: { open, title: 'Task' },
    global: { stubs: { UDrawer, USlideover: true } },
  })
  // The drawer replaces the slideover once onMounted has read the media query
  await flushPromises()
  expect(wrapper.findComponent(UDrawer).exists()).toBe(true)
  return wrapper
}

describe('TaskSheet', () => {
  beforeEach(() => {
    // Below the 768px breakpoint: the sheet renders the bottom drawer
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it('does not report a close when the closed drawer echoes its state on mount', async () => {
    const wrapper = await mountSheet(false)
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('does not report an open the host already knows about', async () => {
    const wrapper = await mountSheet(true)
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('forwards a real close request from the open drawer', async () => {
    const wrapper = await mountSheet(true)
    wrapper.findComponent(UDrawer).vm.$emit('update:open', false)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('swallows an outside press right after opening (the second click of a double-click), not a later one (#25)', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    const wrapper = await mountSheet(false)
    await wrapper.setProps({ open: true, hideTitle: true })
    const content = wrapper.findComponent(UDrawer).vm.$attrs.content as { onPointerDownOutside: (e: Event) => void }
    const early = new Event('pointerdown', { cancelable: true })
    now.mockReturnValue(1400)
    content.onPointerDownOutside(early)
    expect(early.defaultPrevented).toBe(true)
    const late = new Event('pointerdown', { cancelable: true })
    now.mockReturnValue(1000 + 5000)
    content.onPointerDownOutside(late)
    expect(late.defaultPrevented).toBe(false)
    // The add route is not opened by a card click: its overlay click is never swallowed
    await wrapper.setProps({ hideTitle: false })
    now.mockReturnValue(1100)
    const add = new Event('pointerdown', { cancelable: true })
    content.onPointerDownOutside(add)
    expect(add.defaultPrevented).toBe(false)
    now.mockRestore()
  })

  it('gives the drawer footer the sheet-footer hook class', async () => {
    const wrapper = await mountSheet(true)
    const ui = wrapper.findComponent(UDrawer).vm.$attrs.ui as { footer?: string }
    expect(ui.footer).toContain('sheet-footer')
  })

  it('gives the slideover footer the sheet-footer hook class', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const USlideover = defineComponent({
      props: { ui: { type: Object, default: () => ({}) } },
      render() { return h('div', { 'data-testid': 'slideover', 'data-footer': (this.ui as { footer?: string }).footer }) },
    })
    const wrapper = mount(TaskSheet, {
      props: { open: true, title: 'Task' },
      global: { stubs: { USlideover, UDrawer: true } },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="slideover"]').attributes('data-footer')).toContain('sheet-footer')
  })
})
