import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, inject } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import ResponsiveOverlay from '~/components/ui/ResponsiveOverlay.vue'
import { OVERLAY_DESKTOP_KEY } from '~/composables/useIsDesktop'

/** Mirrors vaul-vue's DrawerRoot: watches `open` immediately and emits `update:open` with the current value on mount. */
const UDrawer = defineComponent({
  props: { open: Boolean },
  emits: ['update:open', 'after:enter', 'after:leave'],
  watch: {
    open: { handler(this: { $emit: (e: 'update:open', v: boolean) => void }, value: boolean) { this.$emit('update:open', value) }, immediate: true },
  },
  render() { return h('div', { 'data-testid': 'drawer' }, [this.$slots.body?.(), this.$slots.footer?.()]) },
})
const UModal = defineComponent({
  props: { open: Boolean },
  emits: ['update:open', 'after:leave'],
  render() { return h('div', { 'data-testid': 'modal' }, [this.$slots.body?.(), this.$slots.footer?.()]) },
})
const USlideover = defineComponent({
  props: { open: Boolean },
  emits: ['update:open', 'after:leave'],
  render() { return h('div', { 'data-testid': 'slideover' }, [this.$slots.body?.()]) },
})

type Listener = (event: { matches: boolean }) => void
let matches = false
const listeners = new Set<Listener>()
/** Crosses the breakpoint the way a resize does. */
const resizeTo = (desktop: boolean) => {
  matches = desktop
  for (const listener of listeners) listener({ matches })
}

const Probe = defineComponent({
  render() { return h('span', { 'data-testid': 'probe', 'data-desktop': String(inject(OVERLAY_DESKTOP_KEY)?.value) }) },
})

const mountOverlay = async (props: { open: boolean, desktop?: 'modal' | 'slideover' }) => {
  const wrapper = mount(ResponsiveOverlay, {
    props: { title: 'Title', ...props },
    slots: {
      body: ({ isDesktop }: { isDesktop: boolean }) => h('div', [h(Probe), h('i', { 'data-testid': 'slot-desktop' }, String(isDesktop))]),
      footer: ({ isDesktop }: { isDesktop: boolean }) => h('b', { 'data-testid': 'footer' }, String(isDesktop)),
    },
    global: { stubs: { UModal, USlideover, UDrawer } },
  })
  await flushPromises()
  return wrapper
}

describe('ResponsiveOverlay', () => {
  beforeEach(() => {
    matches = false
    listeners.clear()
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return matches },
      media: query,
      addEventListener: (_: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    }))
  })

  describe('open/close echo guard', () => {
    it('does not report a close when the closed drawer echoes its state on mount', async () => {
      const wrapper = await mountOverlay({ open: false })
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true)
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('does not report an open the host already knows about', async () => {
      const wrapper = await mountOverlay({ open: true })
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('forwards a real close request from the open drawer', async () => {
      const wrapper = await mountOverlay({ open: true })
      wrapper.findComponent(UDrawer).vm.$emit('update:open', false)
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('forwards a real close request from the open modal', async () => {
      matches = true
      const wrapper = await mountOverlay({ open: true })
      wrapper.findComponent(UModal).vm.$emit('update:open', false)
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('stays silent for the echo of a drawer mounted by a resize across the breakpoint', async () => {
      matches = true
      const wrapper = await mountOverlay({ open: false })
      expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)
      resizeTo(false)
      await flushPromises()
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true)
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })
  })

  describe('variant', () => {
    it('renders a modal at desktop width and a slideover when asked for one', async () => {
      matches = true
      expect((await mountOverlay({ open: true })).find('[data-testid="modal"]').exists()).toBe(true)
      expect((await mountOverlay({ open: true, desktop: 'slideover' })).find('[data-testid="slideover"]').exists()).toBe(true)
    })

    it('gives the footer, the body and the hosted content the variant on screen', async () => {
      const wrapper = await mountOverlay({ open: true })
      expect(wrapper.get('[data-testid="footer"]').text()).toBe('false')
      expect(wrapper.get('[data-testid="slot-desktop"]').text()).toBe('false')
      expect(wrapper.get('[data-testid="probe"]').attributes('data-desktop')).toBe('false')
    })

    it('keeps the variant while open and swaps after the overlay has left', async () => {
      matches = true
      const wrapper = await mountOverlay({ open: true })
      resizeTo(false)
      await flushPromises()
      // A swap now would remount the hosted content and drop drafts
      expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="probe"]').attributes('data-desktop')).toBe('true')

      await wrapper.setProps({ open: false })
      expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)

      wrapper.findComponent(UModal).vm.$emit('after:leave')
      await flushPromises()
      expect(wrapper.emitted('after-leave')).toHaveLength(1)
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true)
    })

    it('swaps at once while closed', async () => {
      matches = true
      const wrapper = await mountOverlay({ open: false })
      resizeTo(false)
      await flushPromises()
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true)
    })
  })

  describe('focus into the drawer (#566)', () => {
    /** The element vaul renders: a focusable dialog the overlay is expected to focus. */
    const mountDrawerDom = () => {
      const drawer = document.createElement('div')
      drawer.setAttribute('data-vaul-drawer', '')
      drawer.setAttribute('role', 'dialog')
      drawer.tabIndex = -1
      const field = document.createElement('input')
      drawer.append(field)
      document.body.append(drawer)
      return { drawer, field }
    }

    afterEach(() => {
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    })

    it('focuses the drawer when its enter animation ends', async () => {
      const { drawer } = mountDrawerDom()
      const wrapper = await mountOverlay({ open: true })
      wrapper.findComponent(UDrawer).vm.$emit('after:enter')
      expect(document.activeElement).toBe(drawer)
    })

    it('focuses the drawer a frame after opening, before the enter animation ends', async () => {
      vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
      const { drawer } = mountDrawerDom()
      const wrapper = await mountOverlay({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()
      expect(document.activeElement).toBe(drawer)
    })

    it('does not pull focus into a drawer that was closed again before the frame ran', async () => {
      const frames: Array<() => void> = []
      vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return 0 })
      const { drawer } = mountDrawerDom()
      const wrapper = await mountOverlay({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()
      await wrapper.setProps({ open: false })
      for (const cb of frames) cb()
      wrapper.findComponent(UDrawer).vm.$emit('after:enter')
      expect(document.activeElement).not.toBe(drawer)
    })

    it('does not touch focus on the desktop variants', async () => {
      matches = true
      vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
      const { drawer } = mountDrawerDom()
      const wrapper = await mountOverlay({ open: false })
      await wrapper.setProps({ open: true })
      await flushPromises()
      expect(document.activeElement).not.toBe(drawer)
    })

    it('leaves focus alone when hosted content already focused something inside', async () => {
      const { field } = mountDrawerDom()
      const wrapper = await mountOverlay({ open: true })
      field.focus()
      wrapper.findComponent(UDrawer).vm.$emit('after:enter')
      expect(document.activeElement).toBe(field)
    })
  })
})
