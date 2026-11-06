import { afterEach, describe, expect, it } from 'vitest'
import { componentChain, describeElement, elementLabel, selectorOf } from '~/lib/feedback/describeElement'

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}
afterEach(() => { document.body.innerHTML = '' })

describe('describeElement', () => {
  it('anchors the selector at the nearest test id and walks tag/nth-of-type below it', () => {
    mount('<div data-testid="board"><section><div class="a b c"><button id="x"></button><span>1</span><span>2</span></div></section></div>')
    const second = document.querySelectorAll('span')[1]!
    expect(selectorOf(second)).toBe('[data-testid="board"] > section > div > span:nth-of-type(2)')
    expect(selectorOf(document.querySelector('button')!)).toBe('#x')
  })

  it('never puts class names into the selector', () => {
    mount('<div data-testid="t"><p class="px-4 text-sm font-semibold">x</p></div>')
    expect(selectorOf(document.querySelector('p')!)).toBe('[data-testid="t"] > p')
  })

  it('cuts long paths from the top to stay short', () => {
    mount('<div data-testid="r"><a><b><i><u><s><em>x</em></s></u></i></b></a></div>')
    expect(selectorOf(document.querySelector('em')!)).toBe('[data-testid="r"] i > u > s > em')
  })

  it('falls back to body when no test id or unique id exists', () => {
    mount('<main><p>x</p></main>')
    expect(selectorOf(document.querySelector('p')!)).toBe('body > main > p')
  })

  it('ignores an id that is not unique', () => {
    mount('<div id="dup"><p>a</p></div><div id="dup"><p>b</p></div>')
    expect(selectorOf(document.querySelector('p')!)).toBe('body > div:nth-of-type(1) > p')
  })

  it('collects at most the nearest three component names, innermost first, without repeats', () => {
    mount('<div data-component="Board"><div data-component="BoardColumn"><div data-component="TaskCard BoardColumn"><button></button></div></div></div>')
    expect(componentChain(document.querySelector('button')!)).toEqual(['TaskCard', 'BoardColumn', 'Board'])
  })

  it('skips framework and UI-library wrappers that share a root with an app component', () => {
    mount('<div data-component="BoardColumnItem"><div data-component="Primitive TaskCard"><button></button></div></div>')
    expect(componentChain(document.querySelector('button')!)).toEqual(['TaskCard', 'BoardColumnItem'])
  })

  it('returns an empty chain without markers', () => {
    mount('<p>x</p>')
    expect(componentChain(document.querySelector('p')!)).toEqual([])
  })

  it('records test id, rounded rect and the nearest task id', () => {
    mount('<div class="task-wrapper" data-task-id="seed-open-1"><div data-testid="task-card" data-component="TaskCard"><h3>T</h3></div></div>')
    const heading = document.querySelector('h3')!
    heading.getBoundingClientRect = () => ({ x: 10.4, y: 20.6, width: 99.5, height: 30.2 }) as DOMRect
    expect(describeElement(heading)).toEqual({
      chain: ['TaskCard'],
      testId: 'task-card',
      selector: '[data-testid="task-card"] > h3',
      rect: { x: 10, y: 21, width: 100, height: 30 },
      taskId: 'seed-open-1',
    })
  })

  it('labels a candidate as "<component>, <selector>" for the live region', () => {
    mount('<div data-testid="t" data-component="TaskCard"><h3>x</h3></div>')
    expect(elementLabel(document.querySelector('h3')!)).toBe('TaskCard, [data-testid="t"] > h3')
  })
})
