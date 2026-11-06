import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import InlineEditable from '~/components/ui/inline/InlineEditable.vue'

const render = (props: Record<string, unknown> = {}) =>
  mount(InlineEditable, {
    props: { modelValue: 'Text', label: 'Notizen', ...props },
    slots: { display: '<p>Text <a href="https://example.com/">Link</a></p>' },
  })

describe('InlineEditable interactiveDisplay (#208)', () => {
  it('renders the display content as a sibling of an empty role=button trigger', () => {
    const wrapper = render({ interactiveDisplay: true })
    const trigger = wrapper.get('[role="button"]')
    expect(trigger.text()).toBe('')
    expect(trigger.attributes('aria-label')).toBe('Notizen: Text')
    expect(trigger.find('a').exists()).toBe(false)
    expect(wrapper.get('a').element.closest('[role="button"]')).toBeNull()
  })

  it('starts editing from the trigger', async () => {
    const wrapper = render({ interactiveDisplay: true })
    await wrapper.get('[role="button"]').trigger('keydown.enter')
    expect(wrapper.find('[role="button"]').exists()).toBe(false)
  })

  it('keeps the display inside the trigger by default', () => {
    const wrapper = render()
    expect(wrapper.get('[role="button"] a').exists()).toBe(true)
  })

  describe('focus restore across a delayed trigger swap (#218)', () => {
    let wrapper: ReturnType<typeof render> | undefined
    afterEach(() => { wrapper?.unmount(); wrapper = undefined })

    const mountAttached = (props: Record<string, unknown>) => {
      wrapper = mount(InlineEditable, {
        props: { modelValue: '', label: 'Notizen', ...props },
        slots: { display: '<p>Text</p>' },
        attachTo: document.body,
      })
      return wrapper
    }

    it('empty to written: focuses the new interactive trigger after a late prop update', async () => {
      const w = mountAttached({ interactiveDisplay: false, modelValue: '' })
      w.vm.$.exposed!.startEdit()
      await nextTick()
      w.vm.$.exposed!.finishEdit(true)
      await nextTick()
      await nextTick()
      expect(document.activeElement).toBe(w.get('[role="button"]').element)
      await w.setProps({ interactiveDisplay: true, modelValue: 'Neu' })
      await nextTick()
      expect(document.activeElement).toBe(w.get('[role="button"]').element)
    })

    it('written to empty: focuses the plain trigger after a late prop update', async () => {
      const w = mountAttached({ interactiveDisplay: true, modelValue: 'Neu' })
      w.vm.$.exposed!.startEdit()
      await nextTick()
      w.vm.$.exposed!.finishEdit(true)
      await nextTick()
      await w.setProps({ interactiveDisplay: false, modelValue: '' })
      await nextTick()
      expect(document.activeElement).toBe(w.get('[role="button"]').element)
    })

    it('does not steal focus when the user moved on before the swap', async () => {
      const other = document.createElement('button')
      document.body.appendChild(other)
      const w = mountAttached({ interactiveDisplay: false, modelValue: '' })
      w.vm.$.exposed!.startEdit()
      await nextTick()
      w.vm.$.exposed!.finishEdit(true)
      await nextTick()
      other.focus()
      await w.setProps({ interactiveDisplay: true, modelValue: 'Neu' })
      await nextTick()
      expect(document.activeElement).toBe(other)
      other.remove()
    })

    it('restores once only and never after a blur save without restoreFocus', async () => {
      const w = mountAttached({ interactiveDisplay: false, modelValue: '' })
      w.vm.$.exposed!.startEdit()
      await nextTick()
      w.vm.$.exposed!.finishEdit()
      await nextTick()
      ;(document.activeElement as HTMLElement | null)?.blur()
      await w.setProps({ interactiveDisplay: true, modelValue: 'Neu' })
      await nextTick()
      expect(document.activeElement).toBe(document.body)

      w.vm.$.exposed!.startEdit()
      await nextTick()
      w.vm.$.exposed!.finishEdit(true)
      await nextTick()
      await w.setProps({ interactiveDisplay: false, modelValue: '' })
      await nextTick()
      expect(document.activeElement).toBe(w.get('[role="button"]').element)
      ;(document.activeElement as HTMLElement).blur()
      await w.setProps({ interactiveDisplay: true, modelValue: 'x' })
      await nextTick()
      expect(document.activeElement).toBe(document.body)
    })
  })
})
