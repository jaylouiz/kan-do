import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useElementPicker } from '~/composables/useElementPicker'

const box = { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) } as DOMRect

function key(name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
  document.activeElement?.dispatchEvent(event)
  if (!event.defaultPrevented) document.dispatchEvent(event)
  return event
}

describe('useElementPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="board" data-component="Board" data-testid="board">
        <button id="a">A</button>
        <section id="s"><button id="b">B</button></section>
        <div data-feedback-picker=""><button id="ui">Abbrechen</button></div>
      </div>`
    for (const el of document.querySelectorAll('button')) el.getBoundingClientRect = () => box
    document.elementFromPoint = vi.fn(() => document.getElementById('b'))
  })
  afterEach(() => {
    useElementPicker().cancel()
    document.body.innerHTML = ''
  })

  it('a click picks the element under the pointer and never reaches the page', async () => {
    const pageClick = vi.fn()
    document.getElementById('b')!.addEventListener('click', pageClick)
    const picker = useElementPicker()
    const result = picker.start()
    expect(picker.active.value).toBe(true)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    document.getElementById('b')!.dispatchEvent(click)
    const info = await result
    expect(pageClick).not.toHaveBeenCalled()
    expect(click.defaultPrevented).toBe(true)
    expect(info).toMatchObject({ selector: '#b', chain: ['Board'], testId: 'board' })
    expect(picker.active.value).toBe(false)
  })

  it('swallows pointer events so dnd-kit and the page never see them', () => {
    const seen = vi.fn()
    const target = document.getElementById('a')!
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart', 'contextmenu']) target.addEventListener(name, seen)
    useElementPicker().start()
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart', 'contextmenu']) {
      const event = new Event(name, { bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(seen).not.toHaveBeenCalled()
  })

  it('leaves no listener behind: events reach the page untouched after the pick ends', async () => {
    const picker = useElementPicker()
    const result = picker.start()
    picker.cancel()
    await expect(result).resolves.toBeNull()
    const seen = vi.fn()
    const target = document.getElementById('a')!
    target.addEventListener('pointerdown', seen)
    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets the picker\'s own buttons receive their clicks', () => {
    const picker = useElementPicker()
    void picker.start()
    const click = vi.fn()
    document.getElementById('ui')!.addEventListener('click', click)
    document.getElementById('ui')!.click()
    expect(click).toHaveBeenCalledTimes(1)
    expect(picker.active.value).toBe(true)
  })

  it('Escape cancels with null', async () => {
    const result = useElementPicker().start()
    expect(key('Escape').defaultPrevented).toBe(true)
    await expect(result).resolves.toBeNull()
  })

  it('walks with Tab and Shift+Tab, skipping the picker UI, and announces the candidate', () => {
    const picker = useElementPicker()
    void picker.start()
    key('Tab')
    expect(picker.candidate.value?.id).toBe('a')
    key('Tab')
    expect(picker.candidate.value?.id).toBe('b')
    key('Tab')
    expect(picker.candidate.value?.id).toBe('a') // wraps; #ui is never a candidate
    key('Tab', { shiftKey: true })
    expect(picker.candidate.value?.id).toBe('b')
    expect(picker.label.value).toBe('Board, #b')
  })

  it('ArrowUp selects the parent, ArrowDown the first child, Enter picks', async () => {
    const picker = useElementPicker()
    const result = picker.start()
    key('Tab')
    key('Tab') // #b
    key('ArrowUp')
    expect(picker.candidate.value?.id).toBe('s')
    key('ArrowUp')
    expect(picker.candidate.value?.id).toBe('board')
    key('ArrowDown')
    expect(picker.candidate.value?.id).toBe('a')
    key('Enter')
    await expect(result).resolves.toMatchObject({ testId: 'board' })
    expect(picker.active.value).toBe(false)
  })

  it('Enter without a candidate is a no-op: the picker stays active', async () => {
    const picker = useElementPicker()
    const result = picker.start()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(picker.candidate.value).toBeNull()
    key('Enter')
    expect(picker.active.value).toBe(true)
    picker.cancel()
    await expect(result).resolves.toBeNull()
  })

  it('a second start cancels the first', async () => {
    const picker = useElementPicker()
    const first = picker.start()
    void picker.start()
    await expect(first).resolves.toBeNull()
    expect(picker.active.value).toBe(true)
  })
})
