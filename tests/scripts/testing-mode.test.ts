import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mainCheckoutOf, parseTestingMode, readTestingMode } from '../../scripts/testing-mode.mjs'

// The testing mode file (#693): only the single word `fast` selects fast; everything else is quality.

describe('testing mode', () => {
  const dirs: string[] = []
  const checkout = (content?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-mode-'))
    dirs.push(dir)
    if (content !== undefined) {
      mkdirSync(join(dir, '.claude'))
      writeFileSync(join(dir, '.claude/testing-mode'), content)
    }
    return dir
  }
  afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

  it('reads fast only from the exact word, tolerating whitespace', () => {
    expect(parseTestingMode('fast\n')).toBe('fast')
    expect(parseTestingMode('  fast  ')).toBe('fast')
    for (const value of ['quality\n', '', 'Fast', 'fast mode', 'turbo', undefined, null, 1]) expect(parseTestingMode(value), String(value)).toBe('quality')
  })

  it('reads a checkout, with a missing file as quality', () => {
    expect(readTestingMode(checkout('fast\n'))).toBe('fast')
    expect(readTestingMode(checkout('quality\n'))).toBe('quality')
    expect(readTestingMode(checkout())).toBe('quality')
  })

  // kd#222: the file is not committed, so a new worktree has none and ran every check in quality
  it('a linked worktree without its own file follows the main checkout; its own file wins', () => {
    const main = checkout('fast\n')
    const worktree = (content?: string) => {
      const dir = checkout(content)
      writeFileSync(join(dir, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'some-branch')}\n`)
      return dir
    }
    expect(mainCheckoutOf(worktree())).toBe(main)
    expect(readTestingMode(worktree())).toBe('fast')
    expect(readTestingMode(worktree('quality\n'))).toBe('quality')
    // the main checkout itself (`.git` is a directory) and a plain folder have no other checkout to ask
    mkdirSync(join(main, '.git'))
    expect(mainCheckoutOf(main)).toBeNull()
    expect(mainCheckoutOf(checkout())).toBeNull()
  })

  it('lets KANDO_TESTING_MODE override the file', () => {
    expect(readTestingMode(checkout('quality\n'), { KANDO_TESTING_MODE: 'fast' })).toBe('fast')
    expect(readTestingMode(checkout('fast\n'), { KANDO_TESTING_MODE: 'x' })).toBe('quality')
  })
})
