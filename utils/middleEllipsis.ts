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

/** Graphemes kept after the ellipsis of an option name: enough of a last word to tell "…rbung" from "…ldung", little enough to leave the start its share of a 117 px pill */
export const MIDDLE_TAIL_GRAPHEMES = 5

/** What the user sees as one character: an emoji with its joiners and modifiers, a letter with its combining marks */
function graphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment)
  }
  // No Segmenter: code points at least keep surrogate pairs whole
  return Array.from(value)
}

/** A last word (or last words) of up to this many graphemes stays whole after the ellipsis: "Kun…Angebot", not "Kunde…gebot". 7 is what leaves a head and its ellipsis in the new-card flow's desktop pill (76 px of text: with 9, "Bewerbung" filled it and the ellipsis was clipped) */
export const MIDDLE_WORD_GRAPHEMES = 7
/** A last word shorter than this is no tail of its own ("Kunde A"): the cut takes the word before it along, or falls back to the plain tail */
const MIDDLE_WORD_MIN = 3

/** White space, and the marks a name is built with ("Karriere: Bewerbung", "Kunde/Angebot", "Q3-Planung"): the next grapheme starts a word */
const isBreak = (grapheme: string) => !grapheme.trim() || /^[:/–—·|-]$/u.test(grapheme)

/**
 * Splits a name that does not fit for an ellipsis in the middle that follows the real width (kd#119, `MiddleEllipsis`):
 * the head is cut by CSS (`text-overflow: ellipsis`) where the room runs out, the tail always shows. So
 * "Karriere: Bewerbung" and "Karriere: Weiterbildung" stay apart as "Karr…rbung" and "Karr…ldung" at any width; no
 * character is counted against a width here.
 *
 * `head + tail` is always the whole value. The tail starts at a word when the last word (or words) has 3 to `word`
 * graphemes, so it reads as a word; otherwise it is the last `tail` graphemes. It is never more than half the name (a
 * short name keeps its start), never begins with white space (it would sit after the ellipsis as a gap) and never
 * breaks a grapheme. A name of one grapheme, or `tail` below 1, has no tail: the head then ends in a plain ellipsis.
 */
export function splitMiddle(value: string, { tail = MIDDLE_TAIL_GRAPHEMES, word = MIDDLE_WORD_GRAPHEMES }: { tail?: number, word?: number } = {}): { head: string, tail: string } {
  const parts = graphemes(value)
  const half = Math.floor(parts.length / 2)
  let count = Math.min(Math.floor(tail), half)
  if (count > 0) {
    // The shortest run of whole last words that is long enough to read and still leaves the head its half
    for (let size = MIDDLE_WORD_MIN; size <= Math.min(Math.floor(word), half); size += 1) {
      const first = parts.length - size
      if (isBreak(parts[first - 1]!) && !isBreak(parts[first]!)) {
        count = size
        break
      }
    }
  }
  while (count > 0 && !parts[parts.length - count]!.trim()) count -= 1
  if (count <= 0) return { head: value, tail: '' }
  return { head: parts.slice(0, parts.length - count).join(''), tail: parts.slice(parts.length - count).join('') }
}
