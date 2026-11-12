#!/usr/bin/env node
/**
 * The project's testing mode (#693): `fast` (pre-stable, verification only where importance or the likelihood of a
 * finding is high) or `quality` (the full requirements). One word in the file `.claude/testing-mode` (not committed; a
 * linked worktree without its own file reads the main checkout's, `mainCheckoutOf`); a missing file, an empty file or any other value reads as `quality`, so a typo can only make the checks stricter.
 * Read by the pre-merge E2E gate (`scripts/e2e-gate.mjs`), the Stop hook (`.claude/hooks/verify.sh` and
 * `.githooks/pre-push` call this script), `npm run release` and the workflow skills. Switching it is a one-way item of the profile.
 *
 * CLI: `node scripts/testing-mode.mjs [root]` prints the mode of a checkout.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MODE_FILE = '.claude/testing-mode'
export const TESTING_MODES = ['fast', 'quality']
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {unknown} text file content or any value @returns {'fast' | 'quality'} */
export function parseTestingMode(text) {
  return typeof text === 'string' && text.trim() === 'fast' ? 'fast' : 'quality'
}

/**
 * Mode of a checkout (`quality` when the file is absent). `KANDO_TESTING_MODE` in `env` wins over the file: only the
 * gate's own tests set it, so they hold in either mode; no hook or script sets it.
 * @param {string} [root] @param {Record<string, string | undefined>} [env]
 */
export function readTestingMode(root = ROOT, env = {}) {
  if (env.KANDO_TESTING_MODE !== undefined) return parseTestingMode(env.KANDO_TESTING_MODE)
  for (const checkout of [root, mainCheckoutOf(root)]) {
    if (!checkout) continue
    try {
      return parseTestingMode(readFileSync(join(checkout, MODE_FILE), 'utf8'))
    } catch {
      // no file in this checkout: try the next one
    }
  }
  return 'quality'
}

/**
 * The main checkout a linked worktree belongs to, or null for the main checkout itself and for a folder that is no
 * checkout. The mode file is not committed, so a new worktree has none: it follows the main checkout's mode (kd#222;
 * without this every worktree ran in `quality` while the owner had chosen `fast`). A worktree's own file still wins.
 * Read from the worktree's `.git` pointer file (`gitdir: <main>/.git/worktrees/<name>`), no subprocess.
 * @param {string} root @returns {string | null}
 */
export function mainCheckoutOf(root) {
  try {
    const gitDir = readFileSync(join(root, '.git'), 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
    const main = gitDir?.match(/^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/)?.[1]
    return main ?? null
  } catch {
    return null // `.git` is a directory (the main checkout) or missing
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(readTestingMode(process.argv[2] ?? ROOT))
