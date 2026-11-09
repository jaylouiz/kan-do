/**
 * @module copy-editor/locales
 * @description Reading and writing the two locale files for the copy editor (#59). Output is byte-identical to the
 * repository's formatting (2-space JSON, trailing newline), so a PR diff shows only the edited lines.
 * @responsibility Locale file paths and serialisation; the only files the tool may write.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setLeaf, type MessageTree } from '../../lib/copy-editor/messages'
import type { BaseTrees, Edit } from './validate'

/** Repository-relative paths, the only two files Publish adds to its commit. */
export const LOCALE_FILES = { de: 'i18n/locales/de.json', en: 'i18n/locales/en.json' } as const

export const serializeLocale = (tree: MessageTree) => `${JSON.stringify(tree, null, 2)}\n`

export function readLocaleTrees(root: string): BaseTrees {
  const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8')) as MessageTree
  return { de: read(LOCALE_FILES.de), en: read(LOCALE_FILES.en) }
}

/** Both locale files' text with `edits` applied to `base` (unchanged languages keep their exact text). */
export function applyEdits(base: BaseTrees, edits: readonly Edit[]): { de: string, en: string } {
  let de = base.de
  let en = base.en
  for (const edit of edits) {
    de = setLeaf(de, edit.key, edit.de)
    en = setLeaf(en, edit.key, edit.en)
  }
  return { de: serializeLocale(de), en: serializeLocale(en) }
}
