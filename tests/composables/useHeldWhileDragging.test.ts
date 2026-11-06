import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging'

const { dragState } = useBoardDragState()
afterEach(() => { dragState.value.isDragging = false })

describe('useHeldWhileDragging', () => {
  it('follows the source while nothing is dragged', () => {
    const source = ref<string | null>(null)
    const held = useHeldWhileDragging(source)
    source.value = 'pending'
    expect(held.value).toBe('pending')
    source.value = null
    expect(held.value).toBeNull()
  })

  it('freezes during a drag, in both directions, and catches up on drop', () => {
    const source = ref<string | null>(null)
    const held = useHeldWhileDragging(source)
    dragState.value.isDragging = true
    source.value = 'pending'
    expect(held.value).toBeNull()
    dragState.value.isDragging = false
    expect(held.value).toBe('pending')
    dragState.value.isDragging = true
    source.value = null
    expect(held.value).toBe('pending')
    dragState.value.isDragging = false
    expect(held.value).toBeNull()
  })
})
