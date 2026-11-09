/**
 * @module copy-editor/messages
 * @description Pure helpers for the live copy editor (#59): flatten and edit the nested locale JSON by dotted key,
 * and compare placeholders and plural branches between two languages. Shared by the dev-only client tool and the
 * dev-only server routes; imports nothing from the app, so it runs in the browser and in Node.
 * @responsibility Key paths and message-syntax parity. No I/O, no i18n instance.
 */

export type MessageTree = { [key: string]: string | MessageTree }

/** Dotted key -> string leaf, same flattening as `tests/i18n/locale-parity.test.ts`. */
export function flattenMessages(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${name}` : name
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flattenMessages(value, path))
  }
  return out
}

/** The string at `key`, or undefined when the path is missing or ends in a branch. */
export function getLeaf(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree = tree
  for (const part of key.split('.')) {
    if (typeof node === 'string' || !Object.hasOwn(node, part)) return undefined
    node = node[part] as string | MessageTree
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * A copy of `tree` with the string leaf at `key` replaced. Throws when `key` is not an existing string leaf:
 * the editor changes copy, it never adds or removes keys.
 */
export function setLeaf(tree: MessageTree, key: string, value: string): MessageTree {
  if (getLeaf(tree, key) === undefined) throw new Error(`unknown key: ${key}`)
  const root: MessageTree = structuredClone(tree)
  const parts = key.split('.')
  let node = root
  for (const part of parts.slice(0, -1)) node = node[part] as MessageTree
  node[parts[parts.length - 1] as string] = value
  return root
}

/** `{ a: { b: value } }` for key `a.b`: the shape `mergeLocaleMessage` takes. */
export function nestedMessage(key: string, value: string): MessageTree {
  const parts = key.split('.')
  let tree: string | MessageTree = value
  for (const part of [...parts].reverse()) tree = { [part]: tree }
  return tree as MessageTree
}

/** Named and list placeholders (`{count}`, `{0}`) and linked messages (`@:a.b`), sorted, deduplicated; `{'literal'}` is not one. */
export function placeholdersOf(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\{\s*([^{}'"\s]+)\s*\}/g)) found.add(`{${match[1]}}`)
  for (const match of text.matchAll(/@(?:\.[a-z]+)?:(\w+(?:\.\w+)*)/g)) found.add(`@:${match[1]}`)
  return [...found].sort()
}

/** Plural branches: `a | b | c` has 3. */
export function pluralBranches(text: string): number {
  return text.split('|').length
}

/** Why `text` and `other` cannot be the two languages of one key; empty when they can. */
export function parityProblems(text: string, other: string): string[] {
  const problems: string[] = []
  const a = placeholdersOf(text)
  const b = placeholdersOf(other)
  if (a.join(' ') !== b.join(' ')) {
    problems.push(`placeholders differ: ${a.join(' ') || 'none'} vs ${b.join(' ') || 'none'}`)
  }
  if (pluralBranches(text) !== pluralBranches(other)) {
    problems.push(`plural branches differ: ${pluralBranches(text)} vs ${pluralBranches(other)}`)
  }
  return problems
}
