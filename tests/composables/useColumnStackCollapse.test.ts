import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useColumnStackCollapse } from '~/composables/useColumnStackCollapse'
import { useBoardDragState } from '~/composables/useBoardDragState'

/**
 * Outside click across columns (#156). Two columns, each with its own composable instance and its own
 * document listener. A collapsed stack is a plain node here: clicking it removes it synchronously, as
 * Vue's re-render does between the element's handler and the document listeners of a real click.
 */

interface Column {
  list: Ref<HTMLElement | null>
  onOutsideClick: Mock<(keepKey: string | null) => void>
  onEscape: Mock<() => void>
  collapse?: ReturnType<typeof useColumnStackCollapse>
}

const mountColumns = () => {
  const columns: Record<'A' | 'B', Column> = {
    A: { list: ref(null), onOutsideClick: vi.fn(), onEscape: vi.fn() },
    B: { list: ref(null), onOutsideClick: vi.fn(), onEscape: vi.fn() },
  }
  const Col = defineComponent({
    props: { name: { type: String, required: true } },
    setup(props) {
      const column = columns[props.name as 'A' | 'B']
      column.collapse = useColumnStackCollapse({
        listEl: column.list,
        hasExpanded: () => true,
        onOutsideClick: column.onOutsideClick,
        onEscape: column.onEscape,
      })
      return () =>
        h('div', { class: 'column', ref: (el: unknown) => (column.list.value = el as HTMLElement) }, [
          h('div', { class: 'task-stack', 'data-stack-key': 'collapsed', onClick: (e: Event) => (e.currentTarget as HTMLElement).remove() }),
          h('div', { class: 'task-wrapper', 'data-from-stack': 'open', 'data-task-id': `${props.name}-member` }),
        ])
    },
  })
  const wrapper = mount(
    defineComponent({ render: () => h('div', [h(Col, { name: 'A' }), h(Col, { name: 'B' })]) }),
    { attachTo: document.body },
  )
  const find = (selector: string, which: 'A' | 'B') => columns[which].list.value!.querySelector<HTMLElement>(selector)!
  return { wrapper, columns, find }
}

let mounted: VueWrapper | null = null

beforeEach(() => {
  useBoardDragState().dragState.value.isDragging = false
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
/** The pointer click that ends a drag: it has a click count and lands where the pointer was released */
const releaseAt = (x: number, y: number) => document.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }))
const pointerClick = (el: Element, x: number, y: number) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }))
const pointerdown = (el: Element = document.body) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
/** A drag runs and ends; `onEnd` stands in for what dnd-kit does while the drag-ending event is dispatched */
const dragStart = () => { useBoardDragState().dragState.value.isDragging = true }
const dragEnd = () => { useBoardDragState().dragState.value.isDragging = false }
// the listeners ignore a click that predates their attachment
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

describe('useColumnStackCollapse: clicks across columns', () => {
  it('a click that expands a stack in column A collapses the expanded stacks of column B', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()

    click(find('.task-stack', 'A'))

    expect(columns.B.onOutsideClick).toHaveBeenCalledOnce()
    expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('the same click is not an outside click for column A itself', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()

    click(find('.task-stack', 'A'))

    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
  })

  it('a click on a member of an expanded stack in column A leaves column A alone and collapses B', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()

    click(find('.task-wrapper', 'A'))

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith('open')
    expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('a click outside every column collapses both', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()

    click(document.body)

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith(null)
    expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('ignores the click that ends a drag in both columns', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()
    const { dragState } = useBoardDragState()
    dragState.value.isDragging = true

    click(find('.task-stack', 'A'))

    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
    expect(columns.B.onOutsideClick).not.toHaveBeenCalled()
  })
})

describe('useColumnStackCollapse: classified once in the capture listener (#176)', () => {
  /** A target that removes itself when clicked, like a portaled menu item, a toast close or a draft cancel */
  const addDetaching = (className: string, parent: Element) => {
    const el = document.createElement('button')
    el.className = className
    el.addEventListener('click', () => el.remove())
    parent.appendChild(el)
    return el
  }

  it('a target removed by its own click outside every list is an outside click for all columns', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    const portaled = addDetaching('menu-item', document.body)

    click(portaled)

    expect(portaled.isConnected).toBe(false)
    expect(columns.A.onOutsideClick).toHaveBeenCalledWith(null)
    expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('a target removed by its own click inside the list, outside any stack, is an outside click there too', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    const cancel = addDetaching('draft-cancel', columns.A.list.value!)

    click(cancel)

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith(null)
    expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('a click on a connected non-stack part of the list is an outside click that keeps no group', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()

    click(columns.A.list.value!)

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith(null)
  })

  describe('without a verdict (the capture listener never saw the event)', () => {
    afterEach(() => vi.restoreAllMocks())

    const mountWithoutCapture = () => {
      const add = document.addEventListener.bind(document)
      vi.spyOn(document, 'addEventListener').mockImplementation(
        ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
          if (type === 'click' && options === true) return
          add(type, listener, options)
        }) as typeof document.addEventListener,
      )
      return mountColumns()
    }

    it('classifies a connected target live', async () => {
      const { wrapper, columns, find } = mountWithoutCapture()
      mounted = wrapper
      await settle()

      click(find('.task-wrapper', 'A'))

      expect(columns.A.onOutsideClick).toHaveBeenCalledWith('open')
      expect(columns.B.onOutsideClick).toHaveBeenCalledWith(null)
    })

    it('ignores a click whose target is gone', async () => {
      const { wrapper, columns } = mountWithoutCapture()
      mounted = wrapper
      await settle()
      const gone = addDetaching('menu-item', document.body)

      click(gone)

      expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
      expect(columns.B.onOutsideClick).not.toHaveBeenCalled()
    })
  })
})

describe('useColumnStackCollapse: gestures that end a drag are event-scoped (#154)', () => {
  it('ignores the click that ends a drag, and acts on a click after a pointerdown 1ms later, without timers', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()

    pointerClick(document.body, 40, 50)
    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
    expect(columns.B.onOutsideClick).not.toHaveBeenCalled()

    pointerdown(find('.task-wrapper', 'A'))
    click(find('.task-wrapper', 'A'))
    expect(columns.A.onOutsideClick).toHaveBeenCalledWith('open')
  })

  it('ignores only that click: the next click acts even without a pointerdown in between', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()

    pointerClick(document.body, 40, 50)
    pointerClick(document.body, 40, 50)

    expect(columns.A.onOutsideClick).toHaveBeenCalledOnce()
  })

  it('a synthetic click right after a drag is not the drag\'s (VoiceOver, TalkBack, voice control, el.click())', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    expect([columns.A.collapse!.isDragClick(event), columns.A.collapse!.isDragClick(event)]).toEqual([false, false])
    find('.task-wrapper', 'A').click()
    expect(columns.A.onOutsideClick).toHaveBeenCalledWith('open')
  })

  it('a click with a pointer but away from the release point is not the drag\'s either', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()

    pointerClick(document.body, 300, 400)

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith(null)
  })

  it('a synthetic click does not use up the drag click: the real one at the release point is still ignored', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()

    find('.task-wrapper', 'A').click()
    columns.A.onOutsideClick.mockClear()
    pointerClick(document.body, 40, 50)

    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
  })

  it('answers the same event the same way, so the stack handler and the document listener agree', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    releaseAt(40, 50)
    dragEnd()
    const event = new MouseEvent('click', { bubbles: true, detail: 1, clientX: 40, clientY: 50 })

    expect([columns.A.collapse!.isDragClick(event), columns.A.collapse!.isDragClick(event)]).toEqual([true, true])
    expect(columns.A.collapse!.isDragClick(new MouseEvent('click', { detail: 1, clientX: 40, clientY: 50 }))).toBe(false)
  })

  it('a click long after a keyboard drag acts: the key release ends the drag gesture', async () => {
    const { wrapper, columns, find } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    dragEnd()
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))

    click(find('.task-wrapper', 'A'))

    expect(columns.A.onOutsideClick).toHaveBeenCalledWith('open')
  })

  it('a click while a drag runs is the drag\'s', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()

    expect(columns.A.collapse!.isDragActive()).toBe(true)
    click(document.body)
    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
  })

  it('skips the Escape that ended a keyboard drag; the next Escape collapses at once', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    dragStart()
    // dnd-kit cancels the drag in its own document listener, before the column's window listener runs
    const cancel = () => dragEnd()
    document.addEventListener('keydown', cancel, { once: true })

    escape()
    expect(columns.A.onEscape).not.toHaveBeenCalled()

    escape()
    expect(columns.A.onEscape).toHaveBeenCalledOnce()
  })
})

describe('useColumnStackCollapse: a command chosen from the keyboard in an overlay (#476)', () => {
  /** What the palette's list does on Enter: a click without a pointer on the item, inside a dialog */
  const paletteItem = () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const item = document.createElement('button')
    dialog.append(item)
    document.body.append(dialog)
    return item
  }

  it('does not collapse on the keyboard click (detail 0), but still on a pointer click on the same item', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    const item = paletteItem()

    click(item)
    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()
    expect(columns.B.onOutsideClick).not.toHaveBeenCalled()

    pointerClick(item, 5, 5)
    expect(columns.A.onOutsideClick).toHaveBeenCalledOnce()
    expect(columns.B.onOutsideClick).toHaveBeenCalledOnce()
  })

  it('a keyboard click outside any overlay still collapses, and Escape and an outside click still work afterwards', async () => {
    const { wrapper, columns } = mountColumns()
    mounted = wrapper
    await settle()
    click(paletteItem())
    expect(columns.A.onOutsideClick).not.toHaveBeenCalled()

    click(document.body)
    expect(columns.A.onOutsideClick).toHaveBeenCalledOnce()

    document.querySelector('[role="dialog"]')!.remove()
    escape()
    expect(columns.A.onEscape).toHaveBeenCalledOnce()
  })
})
