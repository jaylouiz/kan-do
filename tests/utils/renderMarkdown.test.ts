import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '~/utils/renderMarkdown'

describe('renderMarkdown (#161)', () => {
  it('renders the common Markdown a note uses', () => {
    const html = renderMarkdown('# Plan\n\n**fett** und *kursiv*\n\n- eins\n- zwei\n\n`code`')
    expect(html).toContain('<h1>Plan</h1>')
    expect(html).toContain('<strong>fett</strong>')
    expect(html).toContain('<em>kursiv</em>')
    expect(html).toContain('<li>eins</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('keeps single line breaks, as the plain-text display did', () => {
    expect(renderMarkdown('eins\nzwei')).toContain('eins<br>zwei')
  })

  it('shows raw HTML as escaped text and keeps it inert', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)><b onclick="x()">b</b> text')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('script, img, b, [onerror], [onclick]')).toBeNull()
    expect(doc.body.textContent).toContain('<script>alert(1)</script>')
    expect(doc.body.textContent).toContain('text')
  })

  it('shows tag-like text literally', () => {
    for (const src of ['<tag>', 'a <b> c', '<div>x</div>']) {
      const doc = new DOMParser().parseFromString(renderMarkdown(src), 'text/html')
      expect(doc.body.textContent?.trim()).toBe(src)
      expect(doc.body.querySelector('div, b, tag')).toBeNull()
    }
  })

  it('drops images (no remote loads from a note)', () => {
    expect(renderMarkdown('![x](https://example.com/p.png)')).not.toContain('<img')
  })

  it('does not keep javascript: links', () => {
    const html = renderMarkdown('[klick](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('opens links in a new tab without opener or referrer and reachable by keyboard', () => {
    const html = renderMarkdown('[Notion](https://notion.so/x)')
    expect(html).toContain('href="https://notion.so/x"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('tabindex')
  })

  it('returns an empty string for an empty note', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
