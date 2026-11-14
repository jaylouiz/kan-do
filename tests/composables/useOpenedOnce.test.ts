import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useOpenedOnce } from '~/composables/useOpenedOnce'

describe('useOpenedOnce', () => {
  it('stays false until the flag is true, then stays true after it closes', () => {
    const open = ref(false)
    const opened = useOpenedOnce(open)
    expect(opened.value).toBe(false)
    open.value = true
    expect(opened.value).toBe(true)
    open.value = false
    expect(opened.value).toBe(true)
  })

  it('is true at once when the flag already is', () => {
    expect(useOpenedOnce(() => true).value).toBe(true)
  })
})
