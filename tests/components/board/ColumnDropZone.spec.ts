import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import ColumnDropZone from '~/components/board/ColumnDropZone.vue'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { TaskStatus } from '~/types/taskStatus'

// The ghost decision of the zone (#372, #379): what the list renders decides on a non-empty column
const isDropTarget = ref(false)
vi.mock('@dnd-kit/vue', () => ({ useDroppable: () => ({ isDropTarget }) }))

const { dragState } = useBoardDragState()
let wrapper: VueWrapper | null = null
let list: HTMLElement

/** The zone inside a real list element, as BoardColumn renders it, holding `items` item nodes first */
const mountZone = (isEmpty: boolean, items: string[]) => {
  list = document.createElement('div')
  list.innerHTML = items.map(cls => `<div class="${cls}" data-task-id="x"></div>`).join('')
  document.body.appendChild(list)
  wrapper = mount(ColumnDropZone, { props: { taskStatus: TaskStatus.Open, isEmpty } })
  list.appendChild(wrapper.element) // the zone is a direct child of the list, after the items
}
const ghost = () => wrapper!.find('.column-drop-zone__ghost')
const beginDrag = async () => {
  dragState.value.isDragging = true
  await flushPromises()
}

describe('ColumnDropZone ghost (#372, #379)', () => {
  beforeEach(() => {
    isDropTarget.value = false
    dragState.value.isDragging = false
    dragState.value.isDropBlocked = false
  })
  afterEach(() => {
    wrapper?.unmount()
    list.remove()
    wrapper = null
  })

  it('shows no ghost on a list that holds a card, even as the target', async () => {
    mountZone(false, ['task-wrapper'])
    await beginDrag()
    isDropTarget.value = true
    await flushPromises()
    expect(ghost().exists()).toBe(false)
  })

  it('shows the ghost on a list that holds only a node of another kind (no card, no stack)', async () => {
    mountZone(false, ['add-task-slot'])
    await beginDrag()
    isDropTarget.value = true
    await flushPromises()
    expect(ghost().exists()).toBe(true)
  })

  it.each(['task-wrapper', 'task-stack'])('follows a %s that dnd-kit moves out after the zone became the target', async (cls) => {
    mountZone(false, [cls])
    await beginDrag()
    isDropTarget.value = true
    await flushPromises()
    expect(ghost().exists()).toBe(false)

    list.querySelector(`.${cls}`)!.remove() // dnd-kit moves the dragged node to another column
    await flushPromises()
    expect(ghost().exists()).toBe(true)

    list.insertBefore(Object.assign(document.createElement('div'), { className: cls }), list.firstChild) // and back
    await flushPromises()
    expect(ghost().exists()).toBe(false)
  })

  it('shows no ghost while the drop is refused', async () => {
    mountZone(true, [])
    await beginDrag()
    isDropTarget.value = true
    dragState.value.isDropBlocked = true
    await flushPromises()
    expect(ghost().exists()).toBe(false)
  })
})
