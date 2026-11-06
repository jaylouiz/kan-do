import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #247, ADR 014: the screenshot pipeline lives in ArrayBuffer, ImageBitmap, <canvas> and Blob only. An `<img>`
 * with a blob/data source or an object URL would need `blob:`/`data:` in `img-src`, which the desktop CSP does
 * not grant (ADR 012). The page also never calls `fetch` for GitHub: everything goes through `github_request`.
 */
const roots = ['components/feedback', 'lib/feedback']
const files = ['composables/useFeedback.ts', 'composables/useScreenshotCapture.ts', 'composables/useElementPicker.ts']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const sources = [...roots.flatMap(walk), ...files].map(path => ({ path, text: readFileSync(path, 'utf8') }))

describe('feedback code and the CSP', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(6)
  })

  it('never builds an <img> with a blob or data source', () => {
    for (const { path, text } of sources) {
      const images = text.match(/<img\b[^>]*>/gi) ?? []
      for (const tag of images) expect(tag, path).not.toMatch(/(blob|data):/i)
      expect(text, path).not.toMatch(/URL\.createObjectURL/)
      expect(text, path).not.toMatch(/new Image\(/)
    }
  })

  it('never calls fetch', () => {
    for (const { path, text } of sources) expect(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), path).not.toMatch(/\bfetch\s*\(/)
  })
})
