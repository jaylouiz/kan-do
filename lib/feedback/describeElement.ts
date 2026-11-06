/**
 * @module feedback/describeElement
 * @description Turns a DOM element into the context the element picker records (#227): component
 * chain (from the `data-component` marker), test id, a short stable selector, bounding box and the
 * related task id. Pure over the DOM it is given; no Vue internals (`__vueParentComponent` is
 * absent in production builds).
 */
import type { ElementInfo, ElementRect } from '~/lib/feedback/types'

export const COMPONENT_ATTR = 'data-component'
const CHAIN_LENGTH = 3
/** Path segments below the anchor; deeper paths are cut from the top to stay short. */
const MAX_PATH_SEGMENTS = 4

/**
 * Framework and UI-library wrappers that mark the same root as the app component they wrap
 * (`Primitive TaskCard`) or add nothing to a bug report. The marker keeps them; the chain skips them.
 */
const LIBRARY_COMPONENT = /^(Primitive|PrimitiveSlot|Slot|CollectionSlot|CollectionItem|Presence|BaseTransition|Transition|TransitionGroup|KeepAlive|Suspense|Teleport|RouteProvider|RouterView|RouterLink|NuxtPage|NuxtLink|NuxtLayout|NuxtRoot|NuxtIcon|NuxtIconSvg)$/

/** `CSS.escape` where it exists (every browser); a minimal stand-in elsewhere (jsdom in Vitest). */
function escapeIdent(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, char => `\\${char}`)
}

/** Class names are never used: Tailwind class soup is neither short nor stable. */
function segment(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const parent = el.parentElement
  if (!parent) return tag
  const sameTag = [...parent.children].filter(child => child.tagName === el.tagName)
  return sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})` : tag
}

function anchorOf(el: Element): { anchor: Element | null, expression: string } {
  for (let cursor: Element | null = el; cursor; cursor = cursor.parentElement) {
    const testId = cursor.getAttribute('data-testid')
    if (testId) return { anchor: cursor, expression: `[data-testid="${escapeIdent(testId)}"]` }
    if (cursor.id && cursor.ownerDocument.querySelectorAll(`#${escapeIdent(cursor.id)}`).length === 1) {
      return { anchor: cursor, expression: `#${escapeIdent(cursor.id)}` }
    }
  }
  return { anchor: null, expression: 'body' }
}

export function selectorOf(el: Element): string {
  const { anchor, expression } = anchorOf(el)
  const path: string[] = []
  for (let cursor: Element | null = el; cursor && cursor !== anchor && cursor !== el.ownerDocument.body; cursor = cursor.parentElement) {
    path.unshift(segment(cursor))
  }
  const tail = path.slice(-MAX_PATH_SEGMENTS)
  // A cut path no longer starts at the anchor's child: a descendant combinator keeps the selector true.
  const joined = tail.join(' > ')
  if (!joined) return expression
  return `${expression}${path.length > tail.length ? ' ' : ' > '}${joined}`
}

export function componentChain(el: Element): string[] {
  const chain: string[] = []
  for (let cursor: Element | null = el; cursor && chain.length < CHAIN_LENGTH; cursor = cursor.parentElement) {
    // A marker can list nested roots ("A > B"): innermost first, like the walk itself.
    const names = cursor.getAttribute(COMPONENT_ATTR)?.split(' ').filter(Boolean) ?? []
    for (const name of names) {
      if (LIBRARY_COMPONENT.test(name)) continue
      if (chain.length < CHAIN_LENGTH && chain.at(-1) !== name) chain.push(name)
    }
  }
  return chain
}

export function roundRect(rect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>): ElementRect {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
}

export function describeElement(el: Element): ElementInfo {
  return {
    chain: componentChain(el),
    testId: el.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    selector: selectorOf(el),
    rect: roundRect(el.getBoundingClientRect()),
    taskId: el.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null,
  }
}

/** Short label for the hover chip and the live region: "<Komponente>, <Selektor>". */
export function elementLabel(el: Element): string {
  const name = componentChain(el)[0] ?? el.tagName.toLowerCase()
  return `${name}, ${selectorOf(el)}`
}
