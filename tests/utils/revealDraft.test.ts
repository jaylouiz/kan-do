import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revealDraft, scrollDeltaClearOfToast } from '~/utils/revealDraft'

describe('revealDraft', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="page" style="overflow-y: auto"><div id="list"><div id="draft"></div></div></div>'
    const page = document.getElementById('page')!
    Object.defineProperty(page, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(page, 'clientHeight', { configurable: true, value: 400 })
  })

  it('on a phone scrolls the page to its top, so the column title and the add button stay in view', () => {
    const page = document.getElementById('page')!
    const draft = document.getElementById('draft')!
    page.scrollTo = vi.fn() as unknown as typeof page.scrollTo
    draft.scrollIntoView = vi.fn()
    revealDraft(draft, { phone: true, reducedMotion: false })
    expect(page.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(draft.scrollIntoView).not.toHaveBeenCalled()
  })

  it('elsewhere scrolls to the nearest edge, never to the start of the card', () => {
    const draft = document.getElementById('draft')!
    draft.scrollIntoView = vi.fn()
    revealDraft(draft, { phone: false, reducedMotion: true })
    expect(draft.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  })

  it('on a phone without a scrolling page falls back to nearest', () => {
    document.getElementById('page')!.style.overflowY = 'visible'
    const draft = document.getElementById('draft')!
    draft.scrollIntoView = vi.fn()
    revealDraft(draft, { phone: true, reducedMotion: false })
    expect(draft.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
  })
})

describe('scrollDeltaClearOfToast', () => {
  it('scrolls a card under the toast up to the limit', () => {
    expect(scrollDeltaClearOfToast(537, 471, 409, 100)).toBe(66)
  })
  it('does nothing for a card already clear', () => {
    expect(scrollDeltaClearOfToast(300, 471, 172, 100)).toBe(0)
  })
  it('never pushes the card top above the floor', () => {
    expect(scrollDeltaClearOfToast(700, 471, 150, 100)).toBe(50)
  })
})
