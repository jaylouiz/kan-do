import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The command guard (#387) with fake payloads: each blocked command exits 2 with a reason naming the
// allowed alternative; everything else, including the sanctioned variants, exits 0 untouched.

const root = resolve(__dirname, '../..')

const hook = (command: string) => spawnSync('bash', [resolve(root, '.claude/hooks/guard-commands.sh')], {
  input: JSON.stringify({ tool_input: { command } }),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: root },
})

// The sandbox recipe exactly as the doc gives it, so a change to the doc's command is tested too.
const sandboxDoc = readFileSync(resolve(root, 'docs/testing/tauri-dev-sandbox.md'), 'utf8')
const recipe = /## Recipe\s+```bash\n([\s\S]*?)```/.exec(sandboxDoc)?.[1] ?? ''
const sandboxStep = recipe.split('\n').filter((line) => /HOME=|cargo" tauri dev|--config/.test(line)).join('\n')

// Built from parts so this file itself never reads as one of the commands it tests.
const nuxtKill = ['pkill', '-f', 'nuxt'].join(' ')
const tauriDev = ['npm run', 'tauri:dev'].join(' ')
const release = ['npm run', 'release'].join(' ')
const npmInstall = ['npm', 'install'].join(' ')
const termsApprove = ['npm run', 'terms:approve'].join(' ')
const termsScript = ['node scripts/copy-terms.mjs', 'approve'].join(' ')
// #623: agent desktop runs never touch the production app or steal focus.
const frontmost = `osascript -e 'tell application "System Events" to set frontmost of first process whose unix id is 123 to true'`
const byName = `osascript -e 'tell application "System Events" to get name of first process whose name is "app"'`
const fullScreen = ['screen', 'capture'].join('')

describe('guard-commands hook', () => {
  it('the stop section kills the dev server by the recipe PORT, not a hard-coded port (#629)', () => {
    const stop = /## Stopping only your own process\s+```bash\n([\s\S]*?)```/.exec(sandboxDoc)?.[1] ?? ''
    expect(stop).toContain('tcp:$PORT')
    expect(recipe).toMatch(/^PORT=\d+/m) // the variable the stop section relies on is defined by the recipe
    expect(stop).not.toMatch(/tcp:\d/)
  })

  it('finds the sandbox recipe in the doc', () => {
    expect(recipe).toContain('tauri dev')
    expect(sandboxStep).toContain('com.julius.kan-do.sandbox-')
  })

  it.each([
    [nuxtKill, 'port'],
    ['pkill nuxt', 'port'],
    [`lsof -ti tcp:3101 | head; ${nuxtKill}`, 'port'],
    [tauriDev, 'tauri-dev-sandbox.md'],
    ['cargo tauri dev', 'tauri-dev-sandbox.md'],
    ['~/.cargo/bin/cargo tauri dev', 'tauri-dev-sandbox.md'],
    ['npx tauri dev', 'tauri-dev-sandbox.md'],
    ['tauri dev', 'tauri-dev-sandbox.md'],
    [`cd src-tauri && ${tauriDev}`, 'tauri-dev-sandbox.md'],
    [`${release} 0.4.0`, '--dry-run'],
    [release, '--dry-run'],
    ['node scripts/release.mjs 0.4.0', '--dry-run'],
    [`${release} 0.4.0 -- --dry-run && ${release} 0.4.0`, '--dry-run'],
    ['gh workflow run release.yml', '/prepare-release'],
    ['gh workflow run release -f version=0.4.0', '/prepare-release'],
    ['gh workflow run Release', '/prepare-release'],
    ['gh workflow run "Release"', '/prepare-release'],
    ['gh workflow run Release.yml', '/prepare-release'],
    [npmInstall, 'npx npm@11.19.0 install'],
    [`${npmInstall} lodash`, 'npx npm@11.19.0 install'],
    ['npm i -D vitest', 'npx npm@11.19.0 install'],
    ['npm ci', 'npx npm@11.19.0 install'],
    [`cd x && ${npmInstall}`, 'npx npm@11.19.0 install'],
    [`FOO=1 ${npmInstall}`, 'npx npm@11.19.0 install'],
    ['npx npm@11.6.0 install x', 'npx npm@11.19.0 install'],
    [termsApprove, 'only the user approves'],
    [`${termsApprove} -- timebox topic`, 'own terminal'],
    [termsScript, 'only the user approves'],
    [`${termsScript} timebox`, 'Term question'],
    [`node ./scripts/copy-terms.mjs approve`, 'only the user approves'],
    [`cd x && ${termsApprove}`, 'only the user approves'],
    [['npm run -s', 'terms:approve'].join(' '), 'only the user approves'],
    [['npm run --silent', 'terms:approve'].join(' '), 'own terminal'],
    [['npm run --silent', 'terms:approve -- timebox'].join(' '), 'Term question'],
    [['npm --silent run', 'terms:approve'].join(' '), 'only the user approves'],
    [['npm -s run', 'terms:approve'].join(' '), 'only the user approves'],
    [['npm run-script', 'terms:approve'].join(' '), 'only the user approves'],
    [['npm --silent run-script --silent', 'terms:approve'].join(' '), 'only the user approves'],
    [['cd x && npm --silent run', 'terms:approve'].join(' '), 'only the user approves'],
    [`FOO=1 ${termsApprove}`, 'only the user approves'],
    [frontmost, 'steal focus'],
    ['osascript -e \'tell application "kan-do" to activate\'', 'steal focus'],
    ['osascript -e \'tell application "System Events" to keystroke "n" using command down\'', 'keystrokes'],
    ['osascript -e \'tell application "System Events" to key code 36\'', 'keystrokes'],
    [`osascript -l JavaScript -e 'Application("System Events").processes.byName("app").frontmost = true'`, 'steal focus'],
    [`osascript <<'EOF'\ntell application "System Events"\nset frontmost of process "app" to true\nend tell\nEOF`, 'steal focus'],
    [byName, 'unix id'],
    ['osascript -e \'tell application "System Events" to tell process "app" to get name of menu bar 1\'', 'unix id'],
    [`cd x && ${byName}`, 'unix id'],
    [fullScreen, '-l <window id>'],
    [`${fullScreen} shot.png`, '-l <window id>'],
    [`${fullScreen} -x shot.png`, 'own window'],
    [`${fullScreen} -T 2 shot.png`, 'private windows'],
    [`/usr/sbin/${fullScreen} -x /tmp/a.png`, 'private windows'],
    [`sleep 1 && ${fullScreen} -x a.png`, 'private windows'],
    ['pkill -f target/debug/app', 'PID of your own'],
    ['pkill app', 'lsof -a -p <pid> -d cwd'],
    ['killall app', 'PID of your own'],
    ['killall kan-do', 'PID of your own'],
    // kill by a pgrep pattern hits other workers' windows too (#629)
    ["kill $(pgrep -f target/debug/app)", 'lsof -a -p <pid> -d cwd'],
    ['kill -9 `pgrep -f target/debug/app`', 'PID of your own'],
    ['cd x && kill "$(pgrep app)"', 'PID of your own'],
  ])('blocks %s', (command, alternative) => {
    const result = hook(command)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('guard-commands:')
    expect(result.stderr).toContain(alternative)
  })

  it.each([
    `${release} -- --dry-run`,
    `${release} 0.4.0 -- --dry-run`,
    recipe,
    sandboxStep,
    'npx npm@11.19.0 install x',
    'npx npm@11.19.0 install',
    'lsof -ti tcp:3101 -sTCP:LISTEN | xargs kill',
    'npm run dev',
    'npm run test',
    'npm run i18n:check',
    'node scripts/copy-terms.mjs check',
    `${termsApprove}-test`,
    ['npm run --silent', 'terms:approve-test'].join(' '),
    'npm run --silent test',
    'npm --silent run i18n:check',
    'npm run-script test',
    `git commit -m "docs: never ${['npm --silent run', 'terms:approve'].join(' ')}"`,
    `git commit -m "docs: only the user runs ${termsApprove}"`,
    `rg -n '${termsScript}' docs`,
    'npm run test:e2e -- tests/e2e/smoke.spec.ts',
    'npm info vitest',
    'npm run tauri:build',
    'gh workflow run ci.yml',
    `${release}:notes 0.4.0`,
    `${npmInstall}-test`,
    `git commit -m "docs: never ${nuxtKill}; ${npmInstall} is blocked"`,
    `gh issue comment 387 --body 'agents never run ${tauriDev} or ${release} 0.4.0'`,
    `git commit -F - <<'EOF'\nfix: guard\n\n${npmInstall}\n${release} 1.0.0\nEOF`,
    `rg -n '${npmInstall}' docs`,
    'git status',
    `${fullScreen} -x -l 4242 own.png`,
    `${fullScreen} -xl4242 own.png`,
    `${fullScreen} -x -R0,0,400,300 region.png`,
    'osascript -e \'display notification "done"\'',
    'osascript -e \'tell application "System Events" to get name of first process whose unix id is 123\'',
    'lsof -p 123 | grep cwd',
    'lsof -a -p 123 -d cwd',
    'kill 123',
    'pgrep -f target/debug/app',
    'kill $(lsof -ti tcp:$PORT -sTCP:LISTEN)',
    'lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill',
    "git commit -m 'never kill $(pgrep -f app)'",
    'pkill -f vitest',
    `git commit -m "docs: never ${fullScreen} or osascript set frontmost"`,
    `gh issue comment 623 --body 'no ${fullScreen} -x; no osascript keystroke; no pkill app'`,
    `git commit -F - <<'EOF'\nfix: guard\n\n${fullScreen}\nosascript -e 'set frontmost'\nEOF`,
  ])('allows %s', (command) => {
    const result = hook(command)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  // The analysis is its own file (#654), so an apostrophe in it, even in a comment, cannot end a shell string and break the hook.
  describe('analysis file (#654)', () => {
    const shell = readFileSync(resolve(root, '.claude/hooks/guard-commands.sh'), 'utf8')
    const parser = readFileSync(resolve(root, '.claude/hooks/guard-commands.pl'), 'utf8')
    const hookIn = (dir: string, command: string) => spawnSync('bash', [join(dir, 'guard-commands.sh')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    })
    const copyHook = (perl: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'kando-guard-'))
      copyFileSync(resolve(root, '.claude/hooks/guard-commands.sh'), join(dir, 'guard-commands.sh'))
      chmodSync(join(dir, 'guard-commands.sh'), 0o755)
      writeFileSync(join(dir, 'guard-commands.pl'), perl)
      return dir
    }

    it('keeps no perl program and no \\x27 workaround in the shell script', () => {
      expect(shell).not.toMatch(/perl\s+-0777\s+-ne/)
      expect(shell).not.toContain('\\x27')
      expect(parser).not.toContain('\\x27')
    })

    it('keeps deciding when the analysis file contains an apostrophe in a comment, a string and a regex', () => {
      const dir = copyHook(`# it's a comment with an apostrophe, and "a quote"\n${parser}\n$c =~ /it's/; my $x = "don't";\n`)
      const blocked = hookIn(dir, nuxtKill)
      expect(blocked.status).toBe(2)
      expect(blocked.stderr).toContain('guard-commands:')
      expect(hookIn(dir, 'git status').status).toBe(0)
    })

    it('blocks with a message instead of failing open when the analysis file is broken or missing', () => {
      const broken = hookIn(copyHook('this is not perl (\n'), nuxtKill)
      expect(broken.status).toBe(2)
      expect(broken.stderr).toContain('perl failed on')
      const dir = copyHook('')
      rmSync(join(dir, 'guard-commands.pl'))
      const missing = hookIn(dir, nuxtKill)
      expect(missing.status).toBe(2)
      expect(missing.stderr).toContain('perl failed on')
      expect(hookIn(dir, 'git status').status).toBe(0) // the cheap prefilter still lets unrelated commands through
    })

    it('a harmless warning on perl stderr neither blocks nor changes a decision', () => {
      const dir = copyHook(parser)
      const env = { ...process.env, CLAUDE_PROJECT_DIR: root, LC_ALL: 'xx_NOPE.UTF-8', LANG: 'xx_NOPE.UTF-8' }
      const run = (command: string) => spawnSync('bash', [join(dir, 'guard-commands.sh')], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8', env })
      const warned = spawnSync('perl', ['-e', '1'], { encoding: 'utf8', env })
      expect(warned.status).toBe(0)
      expect(run(`${release} 0.4.0 -- --dry-run`).status).toBe(0)
      expect(run(nuxtKill).status).toBe(2)
    })

    it('reads the analysis file next to the hook, whatever the working directory', () => {
      const dir = copyHook('print "marker from the copied file";\n')
      const result = hookIn(dir, nuxtKill)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('marker from the copied file')
      const real = spawnSync('bash', [resolve(root, '.claude/hooks/guard-commands.sh')], {
        input: JSON.stringify({ tool_input: { command: nuxtKill } }),
        encoding: 'utf8',
        cwd: tmpdir(),
      })
      expect(real.status).toBe(2)
    })
  })
})
