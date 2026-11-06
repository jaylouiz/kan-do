/**
 * #394: one shared "a layer is open over the board" signal (modal scroll lock or an open popper).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useOpenLayer } from '~/composables/useOpenLayer'

let wrapper: VueWrapper | null = null

function setup() {
  let api!: ReturnType<typeof useOpenLayer>
  wrapper = mount(defineComponent({
    setup() {
      api = useOpenLayer()
      return () => h('div')
    },
  }), { attachTo: document.body })
  return api
}

/** MutationObserver callbacks run as microtasks */
const settle = async () => {
  await Promise.resolve()
  await nextTick()
}

describe('useOpenLayer', () => {
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.style.pointerEvents = ''
    document.body.querySelectorAll('[data-reka-popper-content-wrapper]').forEach(el => el.remove())
  })

  it('follows a modal (body pointer-events none) open and closed (A -> B -> A)', async () => {
    const { layerOpen } = setup()
    expect(layerOpen.value).toBe(false)
    document.body.style.pointerEvents = 'none'
    await settle()
    expect(layerOpen.value).toBe(true)
    document.body.style.pointerEvents = ''
    await settle()
    expect(layerOpen.value).toBe(false)
  })

  it('follows a popper content wrapper mounted to the body', async () => {
    const { layerOpen } = setup()
    const popper = document.createElement('div')
    popper.setAttribute('data-reka-popper-content-wrapper', '')
    document.body.appendChild(popper)
    await settle()
    expect(layerOpen.value).toBe(true)
    popper.remove()
    await settle()
    expect(layerOpen.value).toBe(false)
  })

  it('ignores a tooltip: it is a hover hint, not a layer', async () => {
    const { layerOpen } = setup()
    const tip = document.createElement('div')
    tip.setAttribute('data-reka-popper-content-wrapper', '')
    tip.innerHTML = '<span role="tooltip">Tag abschließen</span>'
    document.body.appendChild(tip)
    await settle()
    expect(layerOpen.value).toBe(false)
  })

  it('reads a layer that is already open when it mounts', () => {
    document.body.style.pointerEvents = 'none'
    expect(setup().layerOpen.value).toBe(true)
  })
})
