/**
 * @module copy-editor/picker
 * @description Text selection mode of the live copy editor (#59): while on, hovering outlines text that comes from an
 * i18n key and a click picks it instead of acting. Capture-phase listeners (like `composables/useElementPicker.ts`)
 * keep the page's own handlers, dnd-kit included, from seeing the pick. The key comes from the recorder (which key
 * rendered this exact text), never from a text search in the locale files.
 * @responsibility Find keys for an element, the hover outline, listener setup and cleanup. No dialog, no edits.
 */
import { ref } from 'vue'
import { keysForText, normalizeText } from '~/lib/copy-editor/recorder'
import { UI_ATTR } from './constants'

export interface HoverRect { top: number, left: number, width: number, height: number }

/** Attributes that carry copy. */
const COPY_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const
const SWALLOWED = ['pointerdown', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick', 'dragstart', 'selectstart'] as const
const MAX_LEVELS = 3

const ownText = (el: Element) => normalizeText([...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? '').join(' '))

/** Keys of the copy an element shows: its own text, its copy attributes, or (up to 3 levels up) its parents'. */
export function keysForElement(start: Element): { keys: string[], element: Element } | null {
  if (start.closest(`[${UI_ATTR}], [data-private]`)) return null
  let el: Element | null = start
  for (let level = 0; el && level < MAX_LEVELS && el !== document.body; level++, el = el.parentElement) {
    if (el.matches('[data-private]')) return null
    const texts = [ownText(el), ...COPY_ATTRS.map(attr => el!.getAttribute(attr) ?? '')]
    if (el.children.length <= 1) texts.push(normalizeText(el.textContent ?? ''))
    const keys = [...new Set(texts.filter(Boolean).flatMap(keysForText))]
    if (keys.length) return { keys, element: el }
  }
  return null
}

export const hoverRect = ref<HoverRect | null>(null)
/** A short line for the mode bar (`No copy here`), cleared on the next hover. */
export const pickMessage = ref('')

const isOwnUi = (target: EventTarget | null) => target instanceof Element && !!target.closest(`[${UI_ATTR}]`)

export function startPicker(onPick: (keys: string[]) => void, isPaused: () => boolean): () => void {
  let frame = 0

  const onMove = (event: PointerEvent) => {
    if (isPaused() || isOwnUi(event.target) || !(event.target instanceof Element)) { hoverRect.value = null; return }
    const target = event.target
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const found = keysForElement(target)
      pickMessage.value = ''
      if (!found) { hoverRect.value = null; return }
      const rect = found.element.getBoundingClientRect()
      hoverRect.value = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    })
  }
  const onClick = (event: MouseEvent) => {
    if (isPaused() || isOwnUi(event.target) || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const found = keysForElement(event.target)
    if (found) onPick(found.keys)
    else pickMessage.value = 'No UI copy here. Press ⌥K to search all keys.'
  }
  const swallow = (event: Event) => {
    if (isPaused() || isOwnUi(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onLeave = () => { hoverRect.value = null }

  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerleave', onLeave, true)
  for (const name of SWALLOWED) document.addEventListener(name, swallow, true)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerleave', onLeave, true)
    for (const name of SWALLOWED) document.removeEventListener(name, swallow, true)
    hoverRect.value = null
    pickMessage.value = ''
  }
}
