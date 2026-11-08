// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_GIT_ENV_VARS, scrubLocalGitEnv } from '../helpers/gitEnv'

const dirs: string[] = []
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('local git env scrub (#41)', () => {
  it('covers every variable `git rev-parse --local-env-vars` lists', () => {
    const listed = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    expect([...LOCAL_GIT_ENV_VARS].toSorted()).toEqual(listed.toSorted())
  })

  it('keeps a temp-dir git init away from the repository GIT_DIR points at', () => {
    const decoy = tmp('decoy-')
    execFileSync('git', ['init', '-q', '-b', 'main', decoy], { env: { PATH: process.env.PATH, HOME: decoy } })
    const decoyGit = join(decoy, '.git')
    const before = readFileSync(join(decoyGit, 'config'), 'utf8')
    const work = tmp('work-')
    const inherited = { ...process.env, GIT_DIR: decoyGit, GIT_WORK_TREE: decoy, GIT_INDEX_FILE: join(decoyGit, 'index') }

    scrubLocalGitEnv(inherited)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work, env: inherited })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: work, env: inherited })

    expect(readFileSync(join(decoyGit, 'config'), 'utf8')).toBe(before)
    expect(readFileSync(join(work, '.git', 'config'), 'utf8')).toContain('name = t')
  })

  it('is applied to process.env by the global setup file', async () => {
    const decoy = tmp('decoy-')
    process.env.GIT_DIR = decoy
    await import('../setup/git-env?again')
    expect(process.env.GIT_DIR).toBeUndefined()
  })
})
