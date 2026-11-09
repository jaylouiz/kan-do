/**
 * Minimal CSS declaration scanner for the `/ui` Tokens part (#65). It reads the real stylesheets as text and returns
 * every declaration with its file, line and the selectors and at-rules around it, so the catalog can say where a token
 * is defined. Handles comments, strings, `url(data:...;...)` and minified input; it is not a general CSS parser.
 */

export interface CssDeclaration {
  /** Property name, e.g. `--task-list-gap` or `z-index`. */
  prop: string
  value: string
  file: string
  /** 1-based line of the property name. */
  line: number
  /** Enclosing preludes, outermost first, e.g. `['@layer base', ':root']`. */
  context: string[]
  /** Trailing `/* ... *\/` comment on the declaration's line, if any. */
  note: string
}

/** Replaces comment characters by spaces (newlines kept), so offsets and line numbers stay those of the source. */
function blankComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (ch === '"' || ch === '\'') {
      const end = skipString(source, i)
      out += source.slice(i, end)
      i = end
    }
    else if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2
      out += source.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
    }
    else {
      out += ch
      i++
    }
  }
  return out
}

function skipString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1
  return Math.min(i + 1, source.length)
}

/** Scans `source` and returns every declaration (`prop: value`) in document order. */
export function scanDeclarations(source: string, file: string): CssDeclaration[] {
  const text = blankComments(source)
  const result: CssDeclaration[] = []
  const stack: string[] = []
  let start = 0
  let depth = 0
  const lineStarts: number[] = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1)
  const lineOf = (offset: number) => {
    // binary search over lineStarts
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const flush = (end: number, terminator: ';' | '}') => {
    const raw = text.slice(start, end)
    const match = /^(\s*)([-\w]+)\s*:([\s\S]*)$/.exec(raw)
    if (match && !/^\s*(?:[-\w]+\s*:)?\s*$/.test(match[3]!)) {
      const prop = match[2]!
      const offset = start + match[1]!.length
      let note = ''
      if (terminator === ';') {
        const rest = /^[ \t]*\/\*([\s\S]*?)\*\//.exec(source.slice(end + 1, end + 400))
        if (rest) note = rest[1]!.replace(/\s+/g, ' ').trim()
      }
      result.push({ prop, value: match[3]!.replace(/\s+/g, ' ').trim(), file, line: lineOf(offset), context: [...stack], note })
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"' || ch === '\'') {
      i = skipString(text, i) - 1
    }
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && ch === '{') {
      stack.push(text.slice(start, i).replace(/\s+/g, ' ').trim())
      start = i + 1
    }
    else if (depth === 0 && ch === ';') {
      flush(i, ';')
      start = i + 1
    }
    else if (depth === 0 && ch === '}') {
      flush(i, '}')
      stack.pop()
      start = i + 1
    }
  }
  return result
}
