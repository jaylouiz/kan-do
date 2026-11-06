// @vitest-environment node
/**
 * `.claude/hooks/edit-root.sh`: two PostToolUse hooks record the edited checkout on the same edit, and
 * check-then-append is not atomic. A duplicate must not make the Stop hook verify one checkout twice.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../.claude/hooks/edit-root.sh')
const dirs: string[] = []

function bash(tmp: string, body: string): string {
  return execFileSync('bash', ['-c', `. "${SCRIPT}"; ${body}`], { env: { ...process.env, TMPDIR: tmp }, encoding: 'utf8' })
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('kando_recorded_roots', () => {
  it('lists a root once even when it was recorded twice (racing hooks)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'edit-root-'))
    dirs.push(tmp)
    // The racing case: both hooks passed the "already recorded?" check, then both appended.
    bash(tmp, 'f=$(kando_roots_file s1); printf "/a\\n/b\\n/a\\n" >"$f"')
    expect(bash(tmp, 'kando_recorded_roots s1').trim().split('\n')).toEqual(['/a', '/b'])
  })

  it('records sequentially without duplicates and lists nothing for an unknown session', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'edit-root-'))
    dirs.push(tmp)
    bash(tmp, 'kando_record_root s2 /a; kando_record_root s2 /a')
    expect(bash(tmp, 'kando_recorded_roots s2')).toBe('/a\n')
    expect(bash(tmp, 'kando_recorded_roots nobody')).toBe('')
  })
})
