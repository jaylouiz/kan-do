/**
 * @module copy-editor/exec
 * @description Runs an external program for the copy editor routes (#59): argument array only (never a shell), a
 * hard timeout, stdin input, and the repository-selecting git variables removed from the environment.
 * @responsibility Process spawning. Injectable (`Runner`) so tests run the flows without git remotes or an agent.
 */
import { spawn } from 'node:child_process'

export interface RunOptions { cwd?: string, input?: string, timeoutMs: number, env?: Record<string, string | undefined> }
export interface RunResult { code: number | null, stdout: string, stderr: string, timedOut: boolean }
export type Runner = (cmd: string, args: readonly string[], options: RunOptions) => Promise<RunResult>

const MAX_OUTPUT = 5_000_000

/** Variables that make git act on another repository than `cwd` (`git rev-parse --local-env-vars`). */
const GIT_LOCAL_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
]

export const run: Runner = (cmd, args, { cwd, input, timeoutMs, env }) => new Promise((resolve) => {
  const merged = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(([name]) => !GIT_LOCAL_ENV.includes(name)),
  ) as Record<string, string | undefined>
  merged.GIT_TERMINAL_PROMPT = '0'
  const child = spawn(cmd, [...args], { cwd, env: merged as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let settled = false
  const finish = (code: number | null, extra = '') => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ code, stdout, stderr: stderr + extra, timedOut })
  }
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString() })
  child.on('error', error => finish(null, String(error.message)))
  child.on('close', code => finish(code))
  child.stdin.on('error', () => { /* the child exited before reading its input */ })
  child.stdin.end(input ?? '')
})
