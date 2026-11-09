// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TermEntry } from '~/lib/copy-editor/terms'
import { run as realRun, type Runner } from '~/server/copy-editor/exec'
import { branchName, publish } from '~/server/copy-editor/publish'

// The git flow runs for real against a throwaway bare remote and clone (never this repository); `gh` is faked.
const dirs: string[] = []
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const de = { a: { title: 'Aufgabe {name}' }, b: 'Zurück' }
const en = { a: { title: 'Task {name}' }, b: 'Back' }
const terms: TermEntry[] = [{ id: 'src', de: 'Verbindung', en: 'connection', avoidDe: ['Quelle'], avoidEn: [], status: 'decided' }]

let remote: string
let clone: string

beforeEach(() => {
  remote = tmp('copy-remote-')
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  clone = tmp('copy-clone-')
  git(clone, 'init', '-q', '-b', 'main')
  mkdirSync(join(clone, 'i18n/locales'), { recursive: true })
  writeFileSync(join(clone, 'i18n/locales/de.json'), json(de))
  writeFileSync(join(clone, 'i18n/locales/en.json'), json(en))
  git(clone, 'add', '.')
  git(clone, 'commit', '-q', '-m', 'init')
  git(clone, 'remote', 'add', 'origin', remote)
  git(clone, 'push', '-q', 'origin', 'main')
  // a dirty checkout and an unrelated branch must stay untouched
  writeFileSync(join(clone, 'i18n/locales/de.json'), json({ ...de, b: 'LOCAL WIP' }))
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const withGh = (url: string | null): Runner => async (cmd, args, options) => {
  if (cmd === 'gh') return url ? { code: 0, stdout: `${url}\n`, stderr: '', timedOut: false } : { code: 1, stdout: '', stderr: 'gh: not logged in', timedOut: false }
  return realRun(cmd, args, options)
}
const passingCheck = async () => ({ ok: true, output: '' })
const edits = [{ key: 'b', de: 'Zurück zur Liste', en: 'Back to the list' }]

describe('copy editor publish', () => {
  it('pushes one copy branch with only the two locale files and leaves the checkout alone', async () => {
    const result = await publish({ edits }, { root: clone, run: withGh('https://github.com/o/r/pull/7'), terms, check: passingCheck, now: () => new Date(2026, 10, 9, 12, 30, 5) })
    expect(result).toMatchObject({ ok: true, prUrl: 'https://github.com/o/r/pull/7', branch: 'copy/20261109-123005-b', edits: 1, files: 2, note: null })

    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('copy/20261109-123005-b main')
    expect(git(remote, 'diff', '--name-only', 'main', 'copy/20261109-123005-b').trim().split('\n').sort()).toEqual(['i18n/locales/de.json', 'i18n/locales/en.json'])
    expect(JSON.parse(git(remote, 'show', 'copy/20261109-123005-b:i18n/locales/de.json')).b).toBe('Zurück zur Liste')
    expect(git(remote, 'show', 'main:i18n/locales/de.json')).toContain('Zurück')
    expect(git(remote, 'show', 'main:i18n/locales/de.json')).not.toContain('Liste')

    // the designer's checkout: still on main, WIP intact, no leftover worktree or branch
    expect(readFileSync(join(clone, 'i18n/locales/de.json'), 'utf8')).toContain('LOCAL WIP')
    expect(git(clone, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('main')
    expect(git(clone, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })

  it('changes only the edited language on origin/main when the local checkout is behind it', async () => {
    // main moves on (newer English copy for key b) after the designer's clone last fetched
    const other = tmp('copy-other-')
    git(other, 'clone', '-q', remote, '.')
    writeFileSync(join(other, 'i18n/locales/en.json'), json({ ...en, b: 'Go back' }))
    git(other, 'commit', '-qam', 'newer en copy')
    git(other, 'push', '-q', 'origin', 'main')
    const stale = [{ key: 'b', de: 'Zurück zur Liste', en: 'Back', changed: ['de'] }]
    const result = await publish({ edits: stale }, { root: clone, run: withGh(null), terms, check: passingCheck, now: () => new Date(2026, 10, 9, 12, 30, 6) })
    expect(result).toMatchObject({ ok: true })
    const branch = (result as { branch: string }).branch
    expect(JSON.parse(git(remote, 'show', `${branch}:i18n/locales/de.json`)).b).toBe('Zurück zur Liste')
    expect(JSON.parse(git(remote, 'show', `${branch}:i18n/locales/en.json`)).b).toBe('Go back')
  })

  it('keeps the pushed branch and reports a note when the pull request cannot be created', async () => {
    const result = await publish({ edits }, { root: clone, run: withGh(null), terms, check: passingCheck })
    expect(result).toMatchObject({ ok: true, prUrl: null })
    expect((result as { note: string }).note).toContain('is pushed')
  })

  it('fails with the step name and pushes nothing for invalid edits, a failed check, or an unreachable remote', async () => {
    const invalid = await publish({ edits: [{ key: 'b', de: 'Quelle', en: 'Back' }] }, { root: clone, run: withGh(null), terms, check: passingCheck })
    expect(invalid).toMatchObject({ ok: false, step: 'validate' })
    const failedCheck = await publish({ edits }, { root: clone, run: withGh(null), terms, check: async () => ({ ok: false, output: 'FAIL terminology' }) })
    expect(failedCheck).toMatchObject({ ok: false, step: 'check', errors: ['npm run i18n:check failed', 'FAIL terminology'] })
    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, '')).toBe('main')
    git(clone, 'remote', 'set-url', 'origin', join(remote, 'does-not-exist'))
    expect(await publish({ edits }, { root: clone, run: withGh(null), terms, check: passingCheck })).toMatchObject({ ok: false, step: 'fetch' })
  })

  it('never builds a branch name outside copy/ and slugs the first key', () => {
    expect(branchName([{ key: 'A.b/../c', de: 'x', en: 'y' }], new Date(2026, 0, 2, 3, 4, 5))).toBe('copy/20260102-030405-a-b-c')
    expect(branchName([], new Date(2026, 0, 2, 3, 4, 5))).toBe('copy/20260102-030405-copy')
  })

  it('refuses a second publish while one runs', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = publish({ edits }, { root: clone, run: withGh(null), terms, check: async () => { await gate; return { ok: true, output: '' } } })
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(await publish({ edits }, { root: clone, run: withGh(null), terms, check: passingCheck })).toMatchObject({ ok: false, step: 'busy' })
    release()
    await slow
  })
})
