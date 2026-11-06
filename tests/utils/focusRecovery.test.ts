import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusFirstAvailable, focusWhenReady } from '~/utils/focusRecovery'

describe('focusRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    document.body.innerHTML = '<div id="col"><h2 id="h">Head</h2></div>'
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('focusWhenReady waits for a late element', () => {
    focusWhenReady(() => document.getElementById('late'), [() => document.getElementById('h')])
    const late = document.createElement('button')
    late.id = 'late'
    setTimeout(() => document.getElementById('col')!.appendChild(late), 50)
    vi.advanceTimersByTime(100)
    expect(document.activeElement).toBe(late)
  })

  it('falls back to the heading (never body) and removes the temporary tabindex on blur', () => {
    focusWhenReady(() => null, [() => document.getElementById('h')])
    vi.advanceTimersByTime(1000)
    const h = document.getElementById('h')!
    expect(document.activeElement).toBe(h)
    expect(h.getAttribute('tabindex')).toBe('-1')
    h.blur()
    expect(h.hasAttribute('tabindex')).toBe(false)
  })

  it('focusFirstAvailable skips missing candidates', () => {
    focusFirstAvailable([() => null, () => document.getElementById('h')])
    expect(document.activeElement).toBe(document.getElementById('h'))
  })
})
