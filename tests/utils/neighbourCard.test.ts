import { afterEach, describe, expect, it } from 'vitest'
import { neighbourCardId } from '~/utils/neighbourCard'

const list = (html: string) => { document.body.innerHTML = `<div>${html}</div>` }
const card = (id: string) => `<div class="task-wrapper" data-task-id="${id}"></div>`

describe('neighbourCardId', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('prefers the next card', () => {
    list(card('a') + card('b') + card('c'))
    expect(neighbourCardId('b')).toBe('c')
  })

  it('falls back to the previous card for the last one', () => {
    list(card('a') + card('b'))
    expect(neighbourCardId('b')).toBe('a')
  })

  it('is null for a lone card or an unknown id', () => {
    list(card('a'))
    expect(neighbourCardId('a')).toBeNull()
    expect(neighbourCardId('zzz')).toBeNull()
  })

  it('does not count a gap or a stack as a card', () => {
    list(`${card('a')}<div class="task-stack"></div>`)
    expect(neighbourCardId('a')).toBeNull()
    list(`${card('a')}<div class="task-gap" data-gap-id="g"></div>`)
    expect(neighbourCardId('a')).toBeNull()
  })

  it('steps over the gap of an earlier delete (#579)', () => {
    list(`${card('a')}<div class="task-gap"></div><div class="task-gap"></div>${card('c')}`)
    expect(neighbourCardId('a')).toBe('c')
    expect(neighbourCardId('c')).toBe('a')
  })
})
