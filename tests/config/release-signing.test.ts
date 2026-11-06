import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { MIN_TAURI_CLI } from '../../scripts/release/preflight.mjs'
import { SECRET_VARIABLES } from '../../scripts/release/signing.mjs'
import { compareSemver } from '../../scripts/release/version.mjs'

// Guards for desktop signing and the CI release workflow (#228 phases 2 and 3, ADR 013). Both only show
// their faults on a real release, which agents never run, so the shape is pinned here.

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')
const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  bundle: { macOS: { signingIdentity?: string, hardenedRuntime?: boolean, entitlements?: string } }
}
const workflow = read('.github/workflows/release.yml')

interface Step { name?: string, id?: string, uses?: string, if?: string, run?: string, env?: Record<string, string>, with?: Record<string, unknown> }
interface Job { 'needs'?: string, 'if'?: string, 'runs-on': string, 'outputs'?: Record<string, string>, 'steps': Step[] }
// `on` is a YAML 1.1 boolean to some parsers; `yaml` (1.2) keeps it a string key.
const doc = parse(workflow) as {
  on: { push: { tags: string[] }, workflow_dispatch: { inputs: Record<string, { default?: unknown, type: string }> } } & Record<string, unknown>
  concurrency: { 'group': string, 'cancel-in-progress': boolean }
  permissions: Record<string, string>
  env: Record<string, string>
  jobs: Record<string, Job>
}
const gate = doc.jobs.gate!
const release = doc.jobs.release!
const allSteps = Object.values(doc.jobs).flatMap(job => job.steps)
const stepNamed = (job: Job, name: string) => job.steps.find(step => step.name === name)!

describe('tauri.conf.json bundle.macOS', () => {
  it('stays ad-hoc by default: Developer ID comes from APPLE_SIGNING_IDENTITY, never from the repository', () => {
    expect(conf.bundle.macOS.signingIdentity).toBe('-')
  })

  it('turns the hardened runtime on and points at an entitlements file that exists', () => {
    expect(conf.bundle.macOS.hardenedRuntime).toBe(true)
    const entitlements = conf.bundle.macOS.entitlements
    expect(entitlements).toBeTruthy()
    expect(existsSync(resolve(root, 'src-tauri', entitlements!))).toBe(true)
  })

  it('assumes no JIT or other entitlement without evidence (ADR 013)', () => {
    const plist = read('src-tauri/entitlements.plist').replace(/<!--[\s\S]*?-->/g, '')
    expect(plist).toContain('<dict/>')
    expect(plist).not.toContain('com.apple.security')
  })
})

describe('release script credential scoping (#228 review M1)', () => {
  const script = read('scripts/release.mjs')
  const packageScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts

  it('never hands process.env itself to a child: every spawn goes through a scoped environment', () => {
    const spawns = script.match(/spawnSync\([^)]*\)/g) ?? []
    expect(spawns.length).toBeGreaterThan(0)
    for (const call of spawns) expect(call).not.toMatch(/env:\s*process\.env/)
    expect(script).not.toMatch(/env \?\? process\.env/)
    // The only uses of the whole environment are the scoped builders and the facts read from it.
    const direct = [...script.matchAll(/^.*\bprocess\.env\b.*$/gm)].map(match => match[0].trim())
    for (const line of direct) {
      expect(line, line).toMatch(/neutralEnv\(process\.env\)|githubEnv\(process\.env\)|buildSigningEnv\(|parseArgs\(|resolveSigning\(|resolveApple\(|bundleBase = \{ \.\.\.process\.env \}|process\.env\.APPLE_API_KEY_P8|GITHUB_ACTIONS|^\/\/|^\*|^`npm|npm_config/)
    }
  })

  it('compiles with a neutral environment and bundles (signs, notarizes) in a second child with the credentials', () => {
    expect(script).toMatch(/run\('npm', \['run', 'tauri:build', '--', '--no-bundle'\], \{ env: neutralEnv\(process\.env\) \}\)/)
    expect(script).toMatch(/run\('npm', \['run', 'tauri:bundle'\], \{ env: buildSigningEnv\(/)
    expect(script).not.toMatch(/'tauri:build'\]/)
    expect(packageScripts['tauri:build']).toMatch(/cargo tauri build$/)
    expect(packageScripts['tauri:bundle']).toMatch(/cargo tauri bundle$/)
  })

  it('gives gh the token and everything else none', () => {
    expect(script).toMatch(/cmd === 'gh' \? githubEnv\(process\.env\) : neutralEnv\(process\.env\)/)
  })

  it('covers every secret the workflow can set', () => {
    const referenced = [...workflow.matchAll(/secrets\.([A-Z_0-9]+)/g)].map(match => match[1]!)
    for (const name of new Set(referenced)) expect(SECRET_VARIABLES, name).toContain(name)
  })

  it('writes the notarization key to a file only around the bundling child and always deletes it', () => {
    const compile = script.indexOf("'--no-bundle'")
    const write = script.indexOf("writeFileSync(keyFile, process.env.APPLE_API_KEY_P8")
    const bundle = script.indexOf("run('npm', ['run', 'tauri:bundle']")
    const cleanup = script.indexOf('rmSync(keyDir')
    expect(compile).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(compile)
    expect(bundle).toBeGreaterThan(write)
    expect(cleanup).toBeGreaterThan(bundle)
    expect(script.slice(bundle, cleanup)).toMatch(/\} finally \{/)
    expect(script).toMatch(/mode: 0o600/)
    expect(workflow).not.toMatch(/AuthKey\.p8|GITHUB_ENV|RUNNER_TEMP/)
  })

  it('does not resolve Keychain secrets for --bump-only or an ad-hoc release', () => {
    expect(script).toMatch(/dryRun \|\| bumpOnly \? null : resolveSigning/)
    expect(script).toMatch(/resolveApple\(process\.env, \{ dryRun, ci, lookup: !bumpOnly \}\)/)
    expect(script).toMatch(/const developerId = lookup && isDeveloperIdIdentity\(identity\)/)
  })
})

describe('release workflow', () => {
  it('triggers on version tags and manually, never on branches or pull requests', () => {
    expect(Object.keys(doc.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(doc.on.push).toEqual({ tags: ['v*.*.*'] })
  })

  it('reuses the release script in CI mode instead of its own build steps', () => {
    const build = stepNamed(release, 'Build, sign, notarize and upload the draft release')
    expect(build.run).toContain('node scripts/release.mjs "$VERSION" "${args[@]}"')
    expect(build.run).toContain('args=(--ci --skip-verify)')
    expect(workflow).not.toMatch(/tauri-action|gh release create/)
  })

  it('requires Developer ID unless a manual dispatch explicitly allows ad-hoc', () => {
    const build = stepNamed(release, 'Build, sign, notarize and upload the draft release')
    expect(build.run).toContain('[ "$ALLOW_ADHOC" = "true" ] || args+=(--require-developer-id)')
    expect(doc.on.workflow_dispatch.inputs.allow_adhoc).toMatchObject({ type: 'boolean', default: false })
    expect(build.env!.ALLOW_ADHOC).toBe('${{ inputs.allow_adhoc }}')
  })

  it('serializes a version with one concurrency group whether the tag push or the dispatch started it', () => {
    // Tag push: `release-v1.2.3` (the ref name). Dispatch: the input, with the `v` added when missing, gives the same name.
    expect(doc.concurrency.group).toBe("release-${{ github.event_name == 'workflow_dispatch' && (startsWith(inputs.version, 'v') && inputs.version || format('v{0}', inputs.version)) || github.ref_name }}")
    expect(doc.concurrency['cancel-in-progress']).toBe(false)
  })

  it('does not persist the checkout token in the git config', () => {
    const checkout = release.steps.find(step => step.uses?.startsWith('actions/checkout@'))!
    expect(checkout.with!['persist-credentials']).toBe(false)
    expect(workflow).not.toMatch(/git (fetch|push|pull)/)
  })

  it('may only write repository contents', () => {
    expect(doc.permissions).toEqual({ contents: 'write' })
    expect(workflow.match(/permissions:/g)).toHaveLength(1)
  })

  it('reads secrets only in the env of the one build step, never in a command line or an echo', () => {
    const holders = allSteps.filter(step => JSON.stringify(step).includes('secrets.'))
    expect(holders.map(step => step.name)).toEqual(['Build, sign, notarize and upload the draft release'])
    for (const [name, value] of Object.entries(holders[0]!.env!)) {
      if (value.includes('secrets.')) expect(value, name).toBe(`\${{ secrets.${name} }}`)
    }
    expect(JSON.stringify(gate)).not.toContain('secrets.')
    expect(workflow).not.toMatch(/set -x|echo .*\$\{?(APPLE|TAURI)_/)
  })

  it('passes user-controlled text (ref name, input, step outputs) to shell code through env only', () => {
    for (const step of allSteps) {
      expect(step.run ?? '', step.name).not.toMatch(/\$\{\{\s*(github\.ref_name|inputs\.|steps\.|needs\.)/)
    }
  })

  it('names only secrets the runbook lists', () => {
    const referenced = [...workflow.matchAll(/secrets\.([A-Z_0-9]+)/g)].map(match => match[1]!)
    const runbook = read('docs/release.md')
    for (const name of new Set(referenced)) expect(runbook, name).toContain(name)
  })

  it('gates the macOS job behind an ubuntu job that skips an already published release (L9)', () => {
    expect(gate['runs-on']).toMatch(/^ubuntu-/)
    expect(gate.outputs).toEqual({ version: '${{ steps.version.outputs.version }}', skip: '${{ steps.published.outputs.skip }}' })
    expect(stepNamed(gate, 'Skip a release that is already published').run).toContain('echo "skip=true" >> "$GITHUB_OUTPUT"')
    expect(release.needs).toBe('gate')
    expect(release.if).toBe("needs.gate.outputs.skip != 'true'")
    expect(release['runs-on']).toMatch(/^macos-/)
    // The skip decision lives in the job condition, not in per-step conditions.
    for (const step of release.steps) expect(step.if, step.name ?? step.uses).toBeUndefined()
    const checkout = release.steps.find(step => step.uses?.startsWith('actions/checkout@'))!
    expect(checkout.with!.ref).toBe('refs/tags/v${{ needs.gate.outputs.version }}')
  })

  it('pins one exact Tauri CLI for the cache key and the install, at or above the preflight minimum (L2)', () => {
    const pin = doc.env.TAURI_CLI_VERSION!
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/)
    expect(compareSemver(pin, MIN_TAURI_CLI)).toBeGreaterThanOrEqual(0)
    const cache = release.steps.find(step => step.uses?.startsWith('actions/cache@'))!
    expect(cache.with!.key).toContain('${{ env.TAURI_CLI_VERSION }}')
    const install = stepNamed(release, 'Install the Tauri CLI')
    expect(install.run).toContain('cargo install tauri-cli --version "$TAURI_CLI_VERSION" --locked')
    expect(install.run).toContain('!= "$TAURI_CLI_VERSION"')
    expect(install.run).not.toContain('command -v')
  })

  it('does not change what skips the regular CI (docs-only paths)', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain("paths-ignore: ['docs/**', '**/*.md', '.claude/**']")
  })
})

describe('release script post-build verification (L7)', () => {
  const script = read('scripts/release.mjs')
  it('verifies the unpacked updater bundle and the mounted DMG before anything is uploaded, and always detaches', () => {
    const verify = script.indexOf('verifyContainers(join(bundleDir')
    const stage = script.indexOf('copyFileSync(sources[key]')
    expect(verify).toBeGreaterThan(-1)
    expect(verify).toBeLessThan(stage)
    const body = script.slice(script.indexOf('function verifyContainers'), script.indexOf('/** Builds, checks the artifacts'))
    expect(body).toMatch(/\} finally \{[\s\S]*target\.teardown/)
  })
})
