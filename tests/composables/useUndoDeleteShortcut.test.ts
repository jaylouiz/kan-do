import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useUndoDeleteShortcut } from '~/composables/useUndoDeleteShortcut'

function mountWith(undo: () => boolean) {
  const Host = defineComponent({
    setup() {
      useUndoDeleteShortcut(undo)
      return () => h('div', [h('input', { 'data-testid': 'field' })])
    },
  })
  return mount(Host, { attachTo: document.body })
}

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('useUndoDeleteShortcut (#27)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('Ctrl+Z and Cmd+Z undo and prevent the default', () => {
    const undo = vi.fn(() => true)
    const wrapper = mountWith(undo)
    expect(press(document.body, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(press(document.body, { key: 'z', metaKey: true }).defaultPrevented).toBe(true)
    expect(undo).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('leaves the key alone when nothing was undone', () => {
    const wrapper = mountWith(() => false)
    expect(press(document.body, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('ignores text fields, redo (Shift) and a plain z', () => {
    const undo = vi.fn(() => true)
    const wrapper = mountWith(undo)
    press(wrapper.get('input').element, { key: 'z', ctrlKey: true })
    press(document.body, { key: 'z', ctrlKey: true, shiftKey: true })
    press(document.body, { key: 'z' })
    expect(undo).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores a key pressed inside a dialog', () => {
    const undo = vi.fn(() => true)
    const wrapper = mountWith(undo)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    press(dialog, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stops listening after unmount', () => {
    const undo = vi.fn(() => true)
    mountWith(undo).unmount()
    press(document.body, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
  })
})
