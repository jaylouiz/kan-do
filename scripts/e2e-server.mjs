#!/usr/bin/env node
/**
 * Playwright's `webServer` (#541): builds the app as a Nitro node-server and serves it, so the E2E suite, the
 * pre-merge gate and `npm run release` run against what ships and not against `nuxt dev`.
 *
 * The build goes to `.e2e-build/<port>/` (`KANDO_E2E_BUILD_DIR`, read by `nuxt.config.ts`): neither `.nuxt` (a dev
 * server or `typecheck` may be using it) nor `.output` (`npm run generate` for Tauri) is touched, and two runs in one
 * checkout on different ports do not overwrite each other. It builds every start (a warm build is seconds, the Vite
 * cache lives in `node_modules/.cache`); a fresh worktree gets `nuxt prepare` first; the directory is removed when the server stops (Playwright's `gracefulShutdown` sends SIGTERM; stale ones of killed runs older than a day go at the next start). The Notion stub is allowed in
 * the bundle (`NOTION_STUB_ENABLED=true` at build time sets `__NOTION_STUB_ALLOWED__`) and on at runtime
 * (`E2E_NOTION_STUB=1`); a real `npm run build` / `generate` sets neither.
 *
 * Needs `PORT`. The server runs inside this process (the Nitro entry listens on import), so Playwright stopping the
 * process stops the server. It serves from the repo root: the Notion stub resolves its fixtures against the working
 * directory, and Playwright starts `webServer` commands in `tests/e2e`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.PORT
if (!/^\d+$/.test(port ?? '')) {
  console.error('e2e-server: PORT is required (a number)')
  process.exit(1)
}

const buildDir = join(root, '.e2e-build', port)
const env = {
  ...process.env,
  KANDO_E2E_BUILD_DIR: buildDir,
  NODE_ENV: 'production',
  NITRO_PRESET: 'node-server',
  NOTION_STUB_ENABLED: 'true',
  // The live copy editor (#59) is dev-only; the E2E build carries it (the dev routes stay out, specs mock them).
  KANDO_COPY_EDITOR: '1',
  // `/ui` (#65) is dev-only like it: only this build carries the catalog route (lib/devPages.ts).
  KANDO_UI_CATALOG: '1',
  E2E_NOTION_STUB: process.env.E2E_NOTION_STUB || '1',
}
// The build must not inherit a BASE_URL (it would become `app.baseURL`); the config only uses it for the dev path.
delete env.BASE_URL

const cleanup = () => rmSync(buildDir, { recursive: true, force: true })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup()
    process.exit(0)
  })
}
process.on('exit', cleanup)

rmSync(buildDir, { recursive: true, force: true })
// Leftovers of runs that were SIGKILLed (no cleanup ran): drop other ports' directories untouched for a day; a
// concurrent run on another port keeps writing to its own directory and stays well inside that.
const buildsRoot = join(root, '.e2e-build')
if (existsSync(buildsRoot)) {
  for (const name of readdirSync(buildsRoot)) {
    const dir = join(buildsRoot, name)
    if (Date.now() - statSync(dir).mtimeMs > 24 * 3600 * 1000) rmSync(dir, { recursive: true, force: true })
  }
}
// The root tsconfig extends `.nuxt/tsconfig.json`, which the build's Vite transform reads even with another buildDir:
// a fresh worktree has no `.nuxt` until `nuxt prepare` ran (it only generates types, seconds).
if (!existsSync(join(root, '.nuxt', 'tsconfig.json'))) {
  console.log('[e2e-server] no .nuxt yet: nuxt prepare')
  const prepare = spawnSync('npx', ['nuxt', 'prepare'], { cwd: root, encoding: 'utf8' })
  if (prepare.status !== 0) {
    process.stderr.write(`${prepare.stdout ?? ''}${prepare.stderr ?? ''}`)
    process.exit(prepare.status ?? 1)
  }
}
const started = Date.now()
console.log(`[e2e-server] nuxt build -> .e2e-build/${port}`)
// Output stays quiet (dozens of Vite externalisation warnings per build); it is printed when the build fails.
const build = spawnSync('npx', ['nuxt', 'build'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (build.status !== 0) {
  process.stderr.write(`${build.stdout ?? ''}${build.stderr ?? ''}`)
  console.error(`[e2e-server] build failed (exit ${build.status ?? build.signal})`)
  process.exit(build.status ?? 1)
}
console.log(`[e2e-server] built in ${((Date.now() - started) / 1000).toFixed(1)} s`)

const entry = join(buildDir, 'output', 'server', 'index.mjs')
if (!existsSync(entry)) {
  console.error(`[e2e-server] no server entry at ${entry}`)
  process.exit(1)
}
// Serve from the repo root (server/utils/notionStub.ts reads tests/fixtures/notion relative to the cwd). Runtime env:
process.chdir(root)
Object.assign(process.env, { NODE_ENV: 'production', NITRO_PORT: port, NOTION_STUB_ENABLED: 'true', E2E_NOTION_STUB: env.E2E_NOTION_STUB })
await import(pathToFileURL(entry).href)
