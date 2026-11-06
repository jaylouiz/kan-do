/**
 * Renders task notes (Markdown) to sanitized HTML for the read mode of the task sheet (#161).
 *
 * marked parses, DOMPurify sanitizes: notes are free text that may come from Notion or Todoist,
 * and the output goes through `v-html`, so nothing the parser emits is trusted. Only a small set
 * of text tags survives; images and tables are dropped (no remote loads from a note, notes stay
 * calm text), raw HTML is shown as escaped text, and links open in a new tab without referrer or opener.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

/** Raw HTML in a note is text, not markup: `<tag>` shows literally instead of being stripped. */
const escapeHtml = (text: string) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
marked.use({ renderer: { html: ({ text }) => escapeHtml(text) } });

let hookInstalled = false;

function installLinkHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** Line breaks in a note stay line breaks (`breaks`), as they did in the plain-text display. */
export function renderMarkdown(source: string): string {
  installLinkHook();
  const html = marked.parse(source, { gfm: true, breaks: true, async: false });
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
