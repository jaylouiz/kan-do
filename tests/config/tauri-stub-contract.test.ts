import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Drift guard for the desktop E2E stub (#256). `installTauriStub` re-implements the Rust commands;
// a command registered in `generate_handler![...]` without a stub branch makes desktop specs fail
// (or worse, silently get `undefined`) only when a spec happens to call it.

const root = resolve(__dirname, '../..')
const lib = readFileSync(resolve(root, 'src-tauri/src/lib.rs'), 'utf8')
const stub = readFileSync(resolve(root, 'tests/e2e/helpers/tauriStub.ts'), 'utf8')

/** Commands that are intentionally not stubbed. Add one only with a reason; prefer stubbing it. */
const UNSTUBBED: Record<string, string> = {}

const registered = (): string[] => {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(lib)?.[1]
  if (!block) throw new Error('generate_handler![...] not found in src-tauri/src/lib.rs')
  return block
    .split(',')
    .map(entry => entry.trim().split('::').pop() ?? '')
    .filter(Boolean)
}

describe('tauri E2E stub contract', () => {
  const commands = registered()

  it('finds the registered commands', () => {
    expect(commands.length).toBeGreaterThan(10)
  })

  it.each(commands)('stubs %s', (command) => {
    if (command in UNSTUBBED) return
    expect(
      stub.includes(`cmd === '${command}'`),
      `tests/e2e/helpers/tauriStub.ts has no handler for the Rust command "${command}": update the stub to mirror it (or list it in UNSTUBBED with a reason).`,
    ).toBe(true)
  })

  it('keeps the allowlist free of stale entries', () => {
    for (const command of Object.keys(UNSTUBBED)) expect(commands).toContain(command)
  })
})
