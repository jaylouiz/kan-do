import { describe, expect, it } from 'vitest'
import { isLayerDragStart } from '~/lib/windowDrag'

// #614: the `.titlebar` drag strip sits under every overlay scrim, so a mousedown on the scrim's top row must start the
// window drag itself (the native title bar always could).

function scrim(): HTMLElement {
  const el = document.createElement('div')
  el.dataset.slot = 'overlay'
  return el
}

const down = (over: Partial<{ button: number, clientY: number, target: EventTarget | null }> = {}) => ({
  button: 0, clientY: 20, target: scrim(), ...over,
})

describe('isLayerDragStart', () => {
  it('starts on a left press on a scrim inside the bar row', () => {
    expect(isLayerDragStart(down(), 56)).toBe(true)
  })

  it('ignores a press below the bar row', () => {
    expect(isLayerDragStart(down({ clientY: 56 }), 56)).toBe(false)
  })

  it('ignores a bar of height 0 (phone layout, no bar row)', () => {
    expect(isLayerDragStart(down({ clientY: 0 }), 0)).toBe(false)
  })

  it('ignores other buttons', () => {
    expect(isLayerDragStart(down({ button: 2 }), 56)).toBe(false)
  })

  it('ignores dialog content: only the scrim itself drags', () => {
    const content = document.createElement('div')
    content.dataset.slot = 'content'
    const inner = document.createElement('button')
    scrim().append(inner)
    expect(isLayerDragStart(down({ target: content }), 56)).toBe(false)
    expect(isLayerDragStart(down({ target: inner }), 56)).toBe(false)
    expect(isLayerDragStart(down({ target: null }), 56)).toBe(false)
  })

  // A custom full-screen layer (NewDayRecap) carries `data-window-drag-layer`; its own content fills the bar row too
  describe('custom layer marked data-window-drag-layer', () => {
    function layer(): HTMLElement {
      const el = document.createElement('div')
      el.dataset.windowDragLayer = ''
      return el
    }

    it('drags from the layer and from its empty padding in the bar row', () => {
      const wrapper = document.createElement('div')
      const root = layer()
      root.append(wrapper)
      expect(isLayerDragStart(down({ target: root }), 56)).toBe(true)
      expect(isLayerDragStart(down({ target: wrapper }), 56)).toBe(true)
    })

    it('leaves interactive content inside the layer alone', () => {
      const root = layer()
      const button = document.createElement('button')
      const icon = document.createElement('span')
      button.append(icon)
      root.append(button)
      expect(isLayerDragStart(down({ target: button }), 56)).toBe(false)
      expect(isLayerDragStart(down({ target: icon }), 56)).toBe(false)
    })

    it('still ignores presses below the bar row and other buttons', () => {
      const root = layer()
      expect(isLayerDragStart(down({ target: root, clientY: 56 }), 56)).toBe(false)
      expect(isLayerDragStart(down({ target: root, button: 2 }), 56)).toBe(false)
    })
  })
})
