/**
 * Shortens a long path in the middle ("/Users/me/…/iCloud Drive/kan-do") so the start (where it
 * lives) and the end (which folder) stay readable. Short strings are returned unchanged.
 */
export function middleEllipsis(value: string, max = 56): string {
  if (value.length <= max) return value
  const keep = max - 1
  const tail = Math.ceil(keep * 0.6)
  const head = keep - tail
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
