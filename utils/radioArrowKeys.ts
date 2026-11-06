/**
 * @module radioArrowKeys
 * @description Arrow-key handling for a custom `role="radiogroup"` (topic hues and symbols, #431): the arrows move
 * the selection and the focus to the neighbouring radio (wrapping), the way a native radio group does. Home / End
 * jump to the ends. `columns` makes Up / Down move by a grid row.
 */

/** The index a key moves to, or `null` when the key is not a navigation key of the group. */
export function nextRadioIndex(key: string, current: number, count: number, columns = 1): number | null {
  if (count <= 0) return null
  const wrap = (index: number) => ((index % count) + count) % count
  switch (key) {
    case 'ArrowRight': return wrap(current + 1)
    case 'ArrowLeft': return wrap(current - 1)
    case 'ArrowDown': return columns > 1 ? Math.min(current + columns, count - 1) : wrap(current + 1)
    case 'ArrowUp': return columns > 1 ? Math.max(current - columns, 0) : wrap(current - 1)
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}

/**
 * Keydown handler for the radios of one group: moves focus to the target radio and returns its index (the caller
 * selects it), or `null` for any other key. `radios` are the group's elements in order.
 */
export function onRadioKeydown(event: KeyboardEvent, radios: readonly HTMLElement[], columns = 1): number | null {
  const current = radios.indexOf(event.currentTarget as HTMLElement)
  if (current === -1) return null
  const next = nextRadioIndex(event.key, current, radios.length, columns)
  if (next === null) return null
  event.preventDefault()
  radios[next]?.focus()
  return next
}
