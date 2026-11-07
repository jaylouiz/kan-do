import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The pre-merge hook (#355) with fake payloads: a fake `gh` that always fails makes a recognised
// merge command exit 2 ("cannot resolve the PR head SHA"), while anything else exits 0 untouched.
// A second fake answers the REST calls the hook makes (cloud sessions reject GraphQL), so a docs-only PR
// reaches the gate and skips.

const root = resolve(__dirname, '../..')
const bin = mkdtempSync(join(tmpdir(), 'kando-hook-'))
writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho gh-stub-failed >&2\nexit 1\n')
chmodSync(join(bin, 'gh'), 0o755)

const restBin = mkdtempSync(join(tmpdir(), 'kando-hook-rest-'))
writeFileSync(join(restBin, 'gh'), [
  '#!/bin/sh',
  'echo "$*" >> "$0.log"',
  'case "$*" in',
  '  *pulls/12/files*) echo docs/notes.md ;;',
  '  *pulls/12*) echo \'{"head":{"sha":"abc123"},"base":{"ref":"main"},"body":"Docs only."}\' ;;',
  '  *) exit 1 ;;',
  'esac',
  '',
].join('\n'))
chmodSync(join(restBin, 'gh'), 0o755)

const merge = (prefix = '', gh = 'gh') => `${prefix}${gh} pr ${'mer' + 'ge'} 12`
const restMerge = (method = '-X PUT') => `gh api ${method} repos/o/r/pulls/12/${'mer' + 'ge'} -f merge_method=merge`

// The hook inherits GH_REPO=o/r unless `ghRepo` is null: a wrapper that may strip it (env -i, sudo, ...) is refused then (#637),
// so the matcher cases that name such a wrapper run without one.
const hook = (command: string, path = bin, ghRepo: string | null = 'o/r') => {
  const { GH_REPO: _inherited, ...inherited } = process.env
  return spawnSync('bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...inherited, PATH: `${path}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root, ...(ghRepo ? { GH_REPO: ghRepo } : {}) },
  })
}

describe('e2e-before-merge hook matcher', () => {
  it.each([
    merge(),
    `${merge('E2E_GATE=full ')} --merge`,
    merge('FOO=1 E2E_GATE=full '),
    merge('cd x && E2E_GATE=full '),
    merge('', '/opt/homebrew/bin/gh'),
    merge('', '/path/to/gh'),
    merge('cd x && '),
    merge('FOO="a b" '),
    merge('S=/tmp/x; '),
    `echo hi\n${merge()}`,
    `git commit -m "note"\n${merge()} --merge`,
    // the heredoc ends before the real command
    `cat <<'EOF' > f\n${merge()} stays\nEOF\n${merge()}`,
    // an apostrophe in a comment opens no quote that could swallow the real command (code review, #506)
    `ls # don't\n${merge()}\necho 'x'`,
    // control-flow keywords and redirections do not hide it
    `if ${merge()} --squash; then echo ok; fi`,
    `${merge()} 2>&1`,
    `if ! ${merge()}; then echo fail; fi`,
    // every control-flow word in front of the command (#608)
    `! ${merge()}`,
    `while ${merge()}; do echo again; done`,
    `until ${merge()}; do echo again; done`,
    `if false; then true; elif ${merge()}; then true; fi`,
    `if false; then true; else ${merge()}; fi`,
    `{ ${merge()}; }`,
    `echo $'it\\'s'; ${merge()}`,
    `cat <<<EOF; ${merge()}\nEOF`,
    // a merge on the heredoc's own first line still runs
    `cat <<EOF && ${merge()}\nbody\nEOF`,
    // the REST merge of cloud sessions goes through the same tokenizer
    restMerge(),
    restMerge('--method PUT'),
    restMerge('--method=PUT'),
    restMerge('-X "PUT"'),
    `cd x && ${restMerge('-XPUT')}`,
    `echo hi\n${restMerge()}`,
    `S=1 ${restMerge()} 2>&1`,
    // gh options between gh and the subcommand (#516)
    'gh -R o/r pr merge 12',
    'gh --repo x pr merge 12',
    'gh --repo=x pr merge 12',
    'gh -Ro/r pr merge 12 --squash',
    'gh -R o/r pr -R o/r merge 12',
    'gh pr merge 12 -R o/r',
    `gh --hostname h ${restMerge().slice(3)}`,
    `cd x && /usr/bin/gh -R o/r pr merge 12`,
    // wrappers with options
    'env -i gh pr merge 12',
    'env -- gh pr merge 12',
    `echo "a (b" && ${merge()}`,
    'env -u FOO gh pr merge 12',
    'env -i FOO=1 gh pr merge 12',
    // GNU getopt_long takes any prefix of a long option, so the separate value must not become the command word (#621)
    'env --un GH_REPO gh pr merge 12',
    'env --chd /tmp gh pr merge 12',
    'env --chdir /tmp gh pr merge 12',
    'env --arg x gh pr merge 12',
    'env --un=GH_REPO gh pr merge 12',
    'sudo --us x gh pr merge 12',
    'sudo --user x gh pr merge 12',
    'timeout --kill 5 60 gh pr merge 12',
    'timeout --sig TERM 60 gh pr merge 12',
    'nice --adj 5 gh pr merge 12',
    'stdbuf --out L gh pr merge 12',
    'ionice --cl 3 gh pr merge 12',
    'env -S "gh pr merge 12"',
    'env --split gh pr merge 12',
    'env --split-string="gh pr merge 12"',
    'time --out /tmp/t gh pr merge 12',
    'sudo -u x gh pr merge 12',
    'sudo -E -u "x y" gh pr merge 12',
    'time -p gh pr merge 12',
    'nohup gh pr merge 12',
    'exec -a name gh pr merge 12',
    `env -i ${restMerge()}`,
    `sudo -u x ${restMerge()}`,
    // subshell, command substitution and backticks
    '(gh pr merge 12)',
    '( gh pr merge 12 ) && echo ok',
    'out=$(gh pr merge 12)',
    'out=$(gh pr merge 12 2>&1)',
    'echo $(gh pr merge 12)',
    'out=`gh pr merge 12`',
    '{ gh pr merge 12; }',
    `(${restMerge()})`,
    `out=$(${restMerge()})`,
    `echo $(${restMerge()})`,
    // a quoted heredoc operator opens no heredoc, so the real merge line after it still runs (#516)
    `echo "x <<EOF"\n${merge()}\nEOF`,
    `echo 'x <<EOF'\n${merge()}\nEOF`,
    `git commit -m "see <<'EOF' below"\n${restMerge()}\nEOF`,
    // two heredocs on one line, then a real merge
    `cat <<A <<B\nbody a\nA\nbody b\nB\n${merge()}`,
    // more wrappers, with their options and the duration of timeout (#535)
    'timeout 60 gh pr merge 12',
    'timeout -k 5 -s KILL 60 gh pr merge 12',
    'timeout --kill-after=5 60 gh pr merge 12',
    'nice gh pr merge 12',
    'nice -n 5 gh pr merge 12',
    'nice -5 gh pr merge 12',
    'stdbuf -oL gh pr merge 12',
    'stdbuf -o L -e0 gh pr merge 12',
    'ionice -c 3 gh pr merge 12',
    'ionice -c3 -n 7 gh pr merge 12',
    'nice -n 5 timeout 9 env -i gh pr merge 12',
    `timeout 60 ${restMerge()}`,
    // a quoted or escaped command word
    '\\gh pr merge 12',
    '"gh" pr merge 12',
    "'gh' pr merge 12",
    "$'gh' pr merge 12",
    'g""h pr merge 12',
    'g\\h pr merge 12',
    '"/usr/bin/gh" pr merge 12',
    '\\env -i gh pr merge 12',
    '"sudo" -u x gh pr merge 12',
    // a wrapper called by path is the same wrapper (#659); doas is handled like sudo
    '/usr/bin/env -i gh pr merge 12',
    '/usr/bin/sudo gh pr merge 12',
    '/usr/bin/sudo -u x gh pr merge 12',
    '/usr/bin/timeout 60 gh pr merge 12',
    '/usr/bin/nice -n 5 /usr/bin/env -i /opt/homebrew/bin/gh pr merge 12',
    '"/usr/bin/sudo" gh pr merge 12',
    'doas gh pr merge 12',
    'doas -u x gh pr merge 12',
    'doas -nu x gh pr merge 12',
    'doas -u x -s gh pr merge 12',
    '/usr/bin/doas -n gh pr merge 12',
    `/usr/bin/env -i ${restMerge()}`,
    `\\gh ${restMerge().slice(3)}`,
    // an unquoted heredoc expands $(...) and backticks in its body, so those run (#535)
    `cat <<EOF\n$(${merge()})\nEOF`,
    `cat <<EOF\nsee \`${merge()}\`\nEOF`,
    `cat <<EOF\nline one\ntext $(echo $(${merge()}))\nEOF`,
    `cat <<-EOF\n\t$(${merge()})\n\tEOF`,
    `cat <<EOF\n$(${restMerge()})\nEOF`,
    // an escaped backslash does not escape the substitution behind it
    `cat <<EOF\n\\\\\`${merge()}\`\nEOF`,
    `cat <<EOF\n\\\\$(${merge()})\nEOF`,
    // a heredoc terminator carrying spaces ends nothing: the lines behind it are commands (as for bash, where they are body only if the real terminator never comes)
    `cat <<EOF\nbody\n EOF\n${merge()}`,
    `cat <<EOF\nbody\nEOF \n${merge()}`,
    `cat <<-EOF\nbody\n  EOF\n${merge()}`,
    // an inline GH_REPO= prefix is a plain variable word
    'GH_REPO=o/r gh pr merge 12',
    'FOO=1 GH_REPO=o/r gh pr merge 12',
    'env GH_REPO=o/r gh pr merge 12',
    // GH_REPO set in an earlier segment (#596)
    'export GH_REPO=o/r; gh pr merge 12',
    'GH_REPO=o/r; gh pr merge 12',
    'export GH_REPO=o/r && gh pr merge 12',
    'unset GH_REPO; gh pr merge 12',
    // wrappers that were missing (#596)
    'setsid gh pr merge 12',
    'setsid -w gh pr merge 12',
    'setsid --fork --wait gh pr merge 12',
    'caffeinate gh pr merge 12',
    'caffeinate -dimsu gh pr merge 12',
    'caffeinate -t 60 gh pr merge 12',
    'caffeinate -w 123 gh pr merge 12',
    'chronic gh pr merge 12',
    'chronic -e gh pr merge 12',
    'unbuffer gh pr merge 12',
    'unbuffer -p gh pr merge 12',
    'nice setsid caffeinate -i gh pr merge 12',
    `setsid ${restMerge()}`,
    // an escape-encoded or locale-quoted command word (#596)
    "$'\\x67h' pr merge 12",
    "$'\\x67\\x68' pr merge 12",
    "$'\\147\\150' pr merge 12",
    "$'\\u0067h' pr merge 12",
    "g$'\\x68' pr merge 12",
    "$'gh\\x00junk' pr merge 12",
    '$"gh" pr merge 12',
    '$"g"h pr merge 12',
    "$'\\x65nv' gh pr merge 12",
    "setsid $'\\x67h' pr merge 12",
    `$"gh" ${restMerge().slice(3)}`,
  ])('recognises %j', (command) => {
    const result = hook(command, bin, null)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot resolve the PR head SHA')
  })

  it.each([
    `git commit -m "note: ${merge()} later"`,
    `echo ${merge()}`,
    'gh pr view 12',
    `gh api repos/o/r/pulls/12/${'mer' + 'ge'}`,
    `gh api -X GET repos/o/r/pulls/12/${'mer' + 'ge'}`,
    `gh api -X PUT repos/o/r/pulls/12/comments`,
    // a PUT elsewhere whose text only mentions a merge path with spaces in it is no merge
    `gh api -X PUT repos/o/r/pulls/12/update-branch -f note="see pulls/x y/${'mer' + 'ge'}"`,
    `echo ${restMerge()}`,
    `git commit -m "x\n${restMerge()}\nmore"`,
    `cat <<EOF\n${restMerge()}\nEOF`,
    // multi-line commit message, a line starts with the command (#506)
    `git commit -m "fix the hook\n\n${merge()} stays blocked on a failing gate\nmore text"`,
    `git commit -m 'fix the hook\n${merge('', '/usr/bin/gh')} 12'`,
    // heredoc body that names the command, plain and with a prefix on the same command (#506 second sighting)
    `cat > f <<'EOF'\n- [ ] Real invocations still trigger: ${merge()} --merge\nEOF`,
    `S=/tmp/scratchpad; cat > "$S/ac.md" <<EOF\n${merge()}\nEOF`,
    `cat <<-EOF\n\t${merge('E2E_GATE=full ')}\n\tEOF`,
    // a full-gate prefix inside a quoted string is no switch and no merge
    `echo "E2E_GATE=full ${merge()}"`,
    `# ${merge()}\nls`,
    `printf '%s' "a;${merge()}"`,
    // other gh commands and wrappers that do not run a merge
    'gh -R o/r pr view 12',
    'gh -R o/r issue comment 12 -b "pr merge 12"',
    `env -i echo ${merge()}`,
    `sudo -u x echo gh pr ${'mer' + 'ge'} 12`,
    `/usr/bin/sudo /bin/echo gh pr ${'mer' + 'ge'} 12`,
    `doas echo gh pr ${'mer' + 'ge'} 12`,
    `echo "$(echo hi)" "(${merge()})"`,
    // heredoc bodies stay ignored, also two on a line and with an options-carrying wrapper
    `cat <<A <<B\n${merge()}\nA\n${restMerge()}\nB`,
    `env -i cat <<EOF\nenv -i ${merge()}\nEOF`,
    `cat <<EOF\nEOF\necho done`,
    // wrappers and quoted words that run something else
    'timeout 60 echo gh pr merge 12',
    'nice -n 5 echo hi',
    'xargs echo gh pr merge',
    '\\echo gh pr merge 12',
    '"echo" gh pr merge 12',
    'setsid echo gh pr merge 12',
    'caffeinate -t 60 echo hi',
    'chronic echo gh pr merge 12',
    'unbuffer echo gh pr merge 12',
    "$'\\x65cho' gh pr merge 12",
    '$"echo" gh pr merge 12',
    'export GH_REPO=o/r; gh pr view 12',
    // heredoc bodies: escaped or quoted substitutions run nothing, a real terminator and tab-indented <<- still end the body
    `cat <<EOF\n\\$(${merge()})\nEOF`,
    `cat <<EOF\n\\\\\\$(${merge()})\nEOF`, // three backslashes: the last one escapes the substitution
    `cat <<'EOF'\n$(${merge()})\nEOF`,
    `cat <<"EOF"\n\`${merge()}\`\nEOF`,
    `cat <<EOF\n$(echo hi)\nEOF\necho done`,
    `cat <<EOF\n${merge()}\nEOF\n$(echo hi)`,
    `cat <<-EOF\n\t${merge()}\n\tEOF`,
    // a spaced `  EOF` is body for bash (only the bare word ends it), so the line behind it stays body too
    `cat <<EOF\n EOF\n${merge()}\nEOF`,
    `cat <<EOF\nEOF \n${merge()}\nEOF`,
    `cat <<-EOF\n  EOF\n${merge()}\nEOF`,
  ])('ignores %j', (command) => {
    const result = hook(command)
    expect(result.stderr).not.toContain('cannot resolve the PR head SHA')
    expect(result.status).toBe(0)
  })
})

describe('e2e-before-merge hook arguments', () => {
  // Fake gh that records its arguments and then fails, to see which PR the hook looks up.
  const argBin = mkdtempSync(join(tmpdir(), 'kando-hook-args-'))
  const argLog = join(argBin, 'args.log')
  writeFileSync(join(argBin, 'gh'), `#!/bin/sh\necho "$@" >>"${argLog}"\nexit 1\n`)
  chmodSync(join(argBin, 'gh'), 0o755)
  // GH_REPO is dropped from the inherited environment unless a test sets it: the default repository is origin.
  const run = (command: string, ghRepo?: string) => {
    writeFileSync(argLog, '')
    const { GH_REPO: _inherited, ...inherited } = process.env
    const result = spawnSync('bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...inherited, ...(ghRepo ? { GH_REPO: ghRepo } : {}), PATH: `${argBin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root },
    })
    return { status: result.status, calls: readFileSync(argLog, 'utf8') }
  }

  it('looks up the PR named after the command', () => {
    const { status, calls } = run(`cd x && ${merge('', 'gh')} --merge`.replace(' 12 ', ' 34 '))
    expect(status).toBe(2)
    expect(calls).toContain('pulls/34')
    expect(calls).not.toMatch(/^pr /m)
  })

  it.each(['$N', '${PR}', '$(gh pr list -q .[0].number)', '`echo 5`', '12abc'])('blocks a REST merge with %s as PR number and says why, with no lookup', (pr) => {
    writeFileSync(argLog, '')
    const result = spawnSync('bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command: restMerge().replace('pulls/12', `pulls/${pr}`) } }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${argBin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('no literal PR number')
    expect(readFileSync(argLog, 'utf8')).toBe('')
  })

  it.each(['$(echo 5)', '`echo 5`', '${PR}'])('blocks a REST merge with a quoted path holding %s, with no lookup', (pr) => {
    const result = run(`gh api -X PUT "repos/o/r/pulls/${pr}/${'mer' + 'ge'}"`)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it('treats what follows -- as positional, not as options', () => {
    const { status, calls } = run('gh pr merge 34 -- -R x')
    expect(status).toBe(2)
    expect(calls).toContain('/pulls/34')
    expect(calls).not.toContain('repos/x/')
  })

  it('still blocks a merge when perl cannot parse the command (REST form and gh options too), and lets other commands through', () => {
    const noPerl = mkdtempSync(join(tmpdir(), 'kando-hook-noperl-'))
    writeFileSync(join(noPerl, 'perl'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(noPerl, 'perl'), 0o755)
    const runNoPerl = (command: string) => spawnSync('bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${noPerl}:${argBin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root },
    })
    for (const command of [
      merge(),
      restMerge(),
      'gh -R o/r pr merge 12',
      'gh --repo x pr merge 12',
      'gh --repo=x pr merge 12',
      'gh -Ro/r pr merge 12',
      'gh pr -R o/r merge 12',
      'env -i gh -R o/r pr merge 12',
      '"gh" pr merge 12',
      `gh --hostname h ${restMerge().slice(3)}`,
    ]) {
      const result = runNoPerl(command)
      expect(result.status, command).toBe(2)
      expect(result.stderr, command).toContain('cannot parse the command')
    }
    for (const command of ['echo hi', 'gh pr view 12', 'gh -R o/r pr view 12', 'gh issue list --repo o/r']) {
      const result = runNoPerl(command)
      expect(result.status, command).toBe(0)
      expect(result.stderr, command).toBe('')
    }
  })

  it.each([
    ['gh -R o/r pr merge 12', 'repos/o/r/pulls/12'],
    ['gh --repo=x/y pr merge 34 --squash', 'repos/x/y/pulls/34'],
    ['gh --repo x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['gh -Rx/y pr merge 34', 'repos/x/y/pulls/34'],
    ['gh pr merge -R x/y 34', 'repos/x/y/pulls/34'],
    ['gh pr merge 34 --repo github.com/x/y', 'repos/x/y/pulls/34'],
    ['gh pr merge --subject "a b 99" 34', 'pulls/34'],
    ['gh pr merge 34 -b "closes 99" -t x --squash', 'pulls/34'],
    ['gh pr merge --body-file notes.md 34', 'pulls/34'],
    ['(gh pr merge 5)', 'pulls/5'],
    ['( gh pr merge 5 ) && echo done', 'pulls/5'],
    ['out=$(gh pr merge 12)', 'pulls/12'],
    ['echo $(gh pr merge 34) 2>&1', 'pulls/34'],
    ['env -i gh pr merge 34', 'pulls/34'],
    ['env -u FOO -i gh pr merge 34', 'pulls/34'],
    ['sudo -u x gh pr merge 34', 'pulls/34'],
    ['sudo --user x -E gh pr merge 34', 'pulls/34'],
    ['/usr/bin/env -i gh pr merge 34', 'pulls/34'],
    ['/usr/bin/sudo gh pr merge 34', 'pulls/34'],
    ['/usr/bin/timeout 60 gh pr merge 34', 'pulls/34'],
    ['doas gh pr merge 34', 'pulls/34'],
    ['doas -u x gh pr merge 34', 'pulls/34'],
    ['time -p gh pr merge 34', 'pulls/34'],
    ['env -- gh pr merge 34', 'pulls/34'],
    ['gh pr merge -- 34', 'pulls/34'],
    [`echo "x <<EOF"\ngh pr merge 34\nEOF`, 'pulls/34'],
    [`(${restMerge().replace('pulls/12', 'pulls/34')})`, 'pulls/34'],
    [`env -i ${restMerge().replace('pulls/12', 'pulls/34')}`, 'pulls/34'],
    // the REST path names the repository, not GH_REPO or origin (#533)
    ['gh api -X PUT repos/other/x/pulls/12/merge', 'repos/other/x/pulls/12'],
    ['gh api repos/other/x/pulls/12/merge --method PUT', 'repos/other/x/pulls/12'],
    ['gh api -X PUT "repos/other/x/pulls/12/merge"', 'repos/other/x/pulls/12'],
    ['gh api -X PUT /repos/other/x/pulls/12/merge', 'repos/other/x/pulls/12'],
    ['gh api -X PUT https://api.github.com/repos/other/x/pulls/12/merge', 'repos/other/x/pulls/12'],
    ['gh api -X PUT repos/other/x/pulls/12/merge -f merge_method=merge', 'repos/other/x/pulls/12'],
    ['GH_REPO=a/b gh api -X PUT repos/other/x/pulls/12/merge', 'repos/other/x/pulls/12'],
    ['gh --hostname h api -X PUT repos/other/x/pulls/12/merge', 'repos/other/x/pulls/12'],
    // gh fills in {owner}/{repo} itself: the current repository
    ['gh api -X PUT repos/{owner}/{repo}/pulls/12/merge', 'api repos/'], // origin of this checkout
    ['GH_REPO=x/y gh api -X PUT repos/{owner}/{repo}/pulls/12/merge', 'repos/x/y/pulls/12'],
    // an inline GH_REPO= names the repository unless -R does (#535)
    ['GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['GH_REPO="x/y" gh pr merge 34', 'repos/x/y/pulls/34'],
    ["GH_REPO='x/y' gh pr merge 34", 'repos/x/y/pulls/34'],
    ['FOO=1 GH_REPO=x/y BAR=2 gh pr merge 34', 'repos/x/y/pulls/34'],
    ['env GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['GH_REPO=a/b gh pr merge 34 -R x/y', 'repos/x/y/pulls/34'],
    ['GH_REPO=a/b gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['GH_REPO=github.com/x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    // GH_REPO set in an earlier segment names the repository, the nearest assignment wins, -R and an inline prefix beat it (#596)
    ['export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y && gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO="x/y"; gh pr merge 34', 'repos/x/y/pulls/34'],
    ["export GH_REPO='x/y'; gh pr merge 34", 'repos/x/y/pulls/34'],
    ['declare -x GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export FOO=1 GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['FOO=1 GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b\nexport GH_REPO=x/y\ngh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; gh pr merge 34 -R x/y', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=github.com/x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; cd z; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['cd z && export GH_REPO=x/y && gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; env FOO=1 gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; nice -n 5 gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; env -i GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; gh api -X PUT repos/{owner}/{repo}/pulls/34/merge', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; gh api -X PUT repos/other/x/pulls/34/merge', 'repos/other/x/pulls/34'],
    ['export GH_REPO=x/y; echo hi; gh pr merge 34', 'repos/x/y/pulls/34'],
    // a later unset or an empty value restores the default repository (origin of this checkout)
    ['export GH_REPO=x/y; unset GH_REPO; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; unset -v GH_REPO FOO; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; GH_REPO=; gh pr merge 34', 'api repos/'],
    // control-flow words in front of the assignment, a quoted unset, local, export -n, an empty inline value (code review)
    ['if true; then export GH_REPO=x/y; gh pr merge 34; fi', 'repos/x/y/pulls/34'],
    ['for i in 1; do export GH_REPO=x/y; gh pr merge 34; done', 'repos/x/y/pulls/34'],
    ['{ export GH_REPO=x/y; gh pr merge 34; }', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; unset "GH_REPO"; gh pr merge 34', 'api repos/'],
    ["export GH_REPO=x/y; unset 'GH_REPO'; gh pr merge 34", 'api repos/'],
    ['export GH_REPO=x/y; local GH_REPO=a/b; gh pr merge 34', 'repos/a/b/pulls/34'],
    ['export -n GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; GH_REPO= gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; GH_REPO="" gh pr merge 34', 'api repos/'],
    // a bare word is a command, not a name to export: its assignment-like arguments set nothing (code review)
    ['echo GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['ls GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; echo GH_REPO=; gh pr merge 34', 'repos/x/y/pulls/34'],
    // unset -f drops a function only
    ['export GH_REPO=x/y; unset -f GH_REPO; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; unset GH_REPO; gh pr merge 34', 'api repos/'],
    // env -C dir and env -- keep GH_REPO: only a bare `-` (or -i/-u/-S) strips it (#608)
    ['export GH_REPO=x/y; env -C dir gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; env --chdir=dir gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; env -- gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; env -C dir -- gh pr merge 34', 'repos/x/y/pulls/34'],
    // GH_REPO assigned behind every control-flow word the parser skips (#608)
    ['! export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['while export GH_REPO=x/y; do gh pr merge 34; done', 'repos/x/y/pulls/34'],
    ['until export GH_REPO=x/y; do gh pr merge 34; done', 'repos/x/y/pulls/34'],
    ['if false; then true; elif export GH_REPO=x/y; then gh pr merge 34; fi', 'repos/x/y/pulls/34'],
    ['if false; then true; else export GH_REPO=x/y; gh pr merge 34; fi', 'repos/x/y/pulls/34'],
    ['time export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['time -p export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    // export -n and declare +x take the export attribute away, also when they assign a value (#608)
    ['export GH_REPO=x/y; export -n GH_REPO; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; export -n GH_REPO=a/b; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; export -n FOO GH_REPO; gh pr merge 34', 'api repos/'],
    ['export GH_REPO=x/y; export -n FOO; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=x/y; declare +x GH_REPO; gh pr merge 34', 'api repos/'],
    // declare/typeset/local/readonly without -x export nothing new, but keep a value that is already exported (#608)
    ['declare GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['typeset GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['local GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['readonly GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['declare -r GH_REPO=x/y; gh pr merge 34', 'api repos/'],
    ['local -x GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['typeset -x GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; declare GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['export GH_REPO=a/b; readonly GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    // an inline empty value reaches gh as no repository, whatever env does behind it
    ['GH_REPO= env -u GH_REPO gh pr merge 34', 'api repos/'],
    ['export GH_REPO=a/b; GH_REPO= env -u GH_REPO gh pr merge 34', 'api repos/'],
    // a bare assignment inside $(...) with a command behind it is a prefix and sets nothing
    ['export GH_REPO=a/b; echo $(GH_REPO=c/d true); gh pr merge 34', 'repos/a/b/pulls/34'],
    // an assignment that does not persist (a prefix of another command, env) leaves the repository alone
    ['GH_REPO=x/y echo hi; gh pr merge 34', 'api repos/'],
    ['env GH_REPO=x/y true; gh pr merge 34', 'api repos/'],
    // wrappers that were missing (#596)
    ['setsid gh pr merge 34', 'pulls/34'],
    ['setsid -f gh pr merge 34', 'pulls/34'],
    ['caffeinate gh pr merge 34', 'pulls/34'],
    ['caffeinate -i -t 60 gh pr merge 34', 'pulls/34'],
    ['caffeinate -dimsu gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['chronic gh pr merge 34', 'pulls/34'],
    ['chronic -ev gh pr merge 34', 'pulls/34'],
    ['unbuffer gh pr merge 34', 'pulls/34'],
    ['unbuffer -p gh pr merge 34', 'pulls/34'],
    ['setsid chronic unbuffer caffeinate gh pr merge 34', 'pulls/34'],
    [`setsid ${restMerge().replace('pulls/12', 'pulls/34')}`, 'pulls/34'],
    // escape-encoded and locale-quoted command words (#596)
    ["$'\\x67h' pr merge 34", 'pulls/34'],
    ["$'\\147\\150' -R x/y pr merge 34", 'repos/x/y/pulls/34'],
    ["$'\\U00000067h' pr merge 34", 'pulls/34'],
    ["$'\\x2fusr/bin/gh' pr merge 34", 'pulls/34'],
    ['$"gh" pr merge 34', 'pulls/34'],
    ["$'\\x65nv' -i gh pr merge 34", 'pulls/34'],
    [`$"gh" ${restMerge().slice(3).replace('pulls/12', 'pulls/34')}`, 'pulls/34'],
    // more wrappers, quoted words and a heredoc substitution still find the PR
    ['env --un GH_REPO gh pr merge 34', 'pulls/34'],
    ['env --chd /tmp gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['env --un FOO --chd /tmp -- gh pr merge 34', 'pulls/34'],
    ['sudo --us x gh pr merge 34', 'pulls/34'],
    ['timeout --kill 5 60 gh pr merge 34', 'pulls/34'],
    ['nice --adj 5 gh pr merge 34', 'pulls/34'],
    ['stdbuf --out L gh pr merge 34', 'pulls/34'],
    ['ionice --cl 3 gh pr merge 34', 'pulls/34'],
    ['timeout 60 gh pr merge 34', 'pulls/34'],
    ['timeout -k 5 60 gh pr merge 34', 'pulls/34'],
    ['nice -n 5 gh pr merge 34', 'pulls/34'],
    ['stdbuf -oL gh pr merge 34', 'pulls/34'],
    ['ionice -c 3 gh pr merge 34', 'pulls/34'],
    ['\\gh pr merge 34', 'pulls/34'],
    ['"gh" -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    [`cat <<EOF\n$(gh pr merge 34)\nEOF`, 'pulls/34'],
    [`cat <<EOF\nbody\n EOF\ngh pr merge 34`, 'pulls/34'],
    [`timeout 9 ${restMerge().replace('pulls/12', 'pulls/34')}`, 'pulls/34'],
  ])('looks up the right PR for %j', (command, lookup) => {
    const { status, calls } = run(command)
    expect(status).toBe(2)
    expect(calls).toContain(lookup)
    expect(calls).not.toMatch(/pulls\/5\)|pulls\/x\b|pulls\/-|pulls\/99/)
    // 'api repos/' means the default repository (origin): a repository the command names (x/y, a/b) must not have been looked up
    if (lookup === 'api repos/') expect(calls).not.toMatch(/repos\/(?:x\/y|a\/b)\//)
  })

  it('says a subshell can be the reason when GH_REPO was changed inside one', () => {
    const result = hook('(export GH_REPO=x/y; gh pr merge 12)')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('inside a subshell')
  })

  it.each(['declare', 'typeset', 'local', 'readonly'])('%s GH_REPO=... changes a GH_REPO the hook inherited (it stays exported)', (kw) => {
    const { status, calls } = run(`${kw} GH_REPO=x/y; gh pr merge 34`, 'a/b')
    expect(status).toBe(2)
    expect(calls).toContain('repos/x/y/pulls/34')
  })

  it.each(['unset GH_REPO', 'export -n GH_REPO', 'declare +x GH_REPO'])('%s drops a GH_REPO the hook inherited, so a later plain declare sets nothing', (drop) => {
    const { status, calls } = run(`${drop}; declare GH_REPO=x/y; gh pr merge 34`, 'a/b')
    expect(status).toBe(2)
    expect(calls).not.toContain('repos/x/y/')
  })

  it.each(['(unset GH_REPO)', '(export -n GH_REPO)', '(declare +x GH_REPO)'])('%s in a subshell does not drop a GH_REPO the hook inherited', (drop) => {
    const { status, calls } = run(`${drop}; declare GH_REPO=x/y; gh pr merge 34`, 'a/b')
    expect(status).toBe(2)
    expect(calls).toContain('repos/x/y/pulls/34')
  })

  // The hook inherited GH_REPO=a/b; a drop in the same shell means gh runs without it and merges in origin (#622).
  it.each([
    'unset GH_REPO; gh pr merge 34',
    'export -n GH_REPO; gh pr merge 34',
    'declare +x GH_REPO; gh pr merge 34',
    'GH_REPO= gh pr merge 34',
    'unset GH_REPO\ngh pr merge 34',
    'export GH_REPO=x/y; unset GH_REPO; gh pr merge 34',
  ])('%s looks the PR up in origin, not in the GH_REPO the hook inherited', (command) => {
    const { status, calls } = run(command, 'a/b')
    expect(status).toBe(2)
    expect(calls).toContain('pulls/34')
    expect(calls).not.toMatch(/repos\/(?:a\/b|x\/y)\//)
  })

  it.each([
    ['unset GH_REPO; export GH_REPO=x/y; gh pr merge 34', 'repos/x/y/pulls/34'],
    ['unset GH_REPO; GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['unset GH_REPO; gh pr merge 34 -R x/y', 'repos/x/y/pulls/34'],
    ['unset FOO; gh pr merge 34', 'repos/a/b/pulls/34'],
    ['gh pr merge 34', 'repos/a/b/pulls/34'],
  ])('%s keeps the repository %s', (command, lookup) => {
    const { status, calls } = run(command, 'a/b')
    expect(status).toBe(2)
    expect(calls).toContain(lookup)
  })

  it.each(['(unset GH_REPO; gh pr merge 34)', '(unset GH_REPO); gh pr merge 34', '(export -n GH_REPO; gh pr merge 34)'])('refuses %s: a drop in a subshell cannot be scoped while the hook inherited GH_REPO', (command) => {
    const result = { ...run(command, 'a/b') }
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it('names a subshell when it refuses an unscoped drop', () => {
    const result = hook('(unset GH_REPO; gh pr merge 12)')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('inside a subshell')
  })

  it('a drop in a subshell changes nothing when the hook inherited no GH_REPO', () => {
    const { status, calls } = run('(unset GH_REPO; gh pr merge 34)')
    expect(status).toBe(2)
    expect(calls).toContain('pulls/34')
  })

  it('a plain declare of GH_REPO sets nothing when the hook inherited none', () => {
    const { status, calls } = run('declare GH_REPO=x/y; gh pr merge 34')
    expect(status).toBe(2)
    expect(calls).not.toMatch(/repos\/x\/y\//)
  })

  // The hook inherited GH_REPO=a/b and a wrapper may run gh without it: gh merges in origin, the hook cannot tell which (#637).
  const strippers = ['env -i', 'env -u GH_REPO', 'env -u FOO', 'env --un GH_REPO', 'env --un=GH_REPO', 'env -i FOO=1', 'sudo', 'sudo -u x', 'exec -c', 'nice -n 5 env -i',
    '/usr/bin/env -i', '/usr/bin/sudo', '/usr/bin/nice -n 5 /usr/bin/env -i', 'doas', 'doas -u x', '/usr/bin/doas']
  it.each(strippers)('refuses `%s gh pr merge` while the hook inherited GH_REPO, with no lookup', (wrapper) => {
    for (const command of [`${wrapper} gh pr merge 34`, `${wrapper} ${restMerge().replace('repos/o/r', 'repos/{owner}/{repo}').replace('pulls/12', 'pulls/34')}`, `FOO=1 ${wrapper} gh pr merge 34`]) {
      const result = hook(command)
      expect(result.status, command).toBe(2)
      expect(result.stderr, command).toContain('may strip GH_REPO')
    }
    const { status, calls } = run(`${wrapper} gh pr merge 34`, 'a/b')
    expect(status).toBe(2)
    expect(calls).toBe('')
  })

  it.each(['env -S "gh pr merge 34"', 'env --split gh pr merge 34'])('refuses %s while the hook inherited GH_REPO', (command) => {
    const { status, calls } = run(command, 'a/b')
    expect(status).toBe(2)
    expect(calls).toBe('')
  })

  it.each(['GH_REPO=x/y env -u GH_REPO', 'GH_REPO=x/y env -i', 'GH_REPO=x/y sudo', 'GH_REPO=x/y exec -c', 'GH_REPO=x/y /usr/bin/sudo', 'GH_REPO=x/y doas'])('refuses `%s gh pr merge`: the inline value may be stripped, with or without an inherited GH_REPO', (prefix) => {
    for (const inherited of [undefined, 'a/b']) {
      const { status, calls } = run(`${prefix} gh pr merge 34`, inherited)
      expect(status).toBe(2)
      expect(calls).toBe('')
    }
  })

  it.each(strippers)('`%s gh pr merge` is a normal lookup when the hook inherited no GH_REPO', (wrapper) => {
    const { status, calls } = run(`${wrapper} gh pr merge 34`)
    expect(status).toBe(2)
    expect(calls).toContain('pulls/34')
  })

  it.each([
    // the repository is named by the command itself, or the drop is certain
    ['env -i gh pr merge 34 -R x/y', 'repos/x/y/pulls/34'],
    ['sudo gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['/usr/bin/sudo gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['doas gh -R x/y pr merge 34', 'repos/x/y/pulls/34'],
    ['env -i GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['env -u GH_REPO GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['GH_REPO=a/b env -i GH_REPO=x/y gh pr merge 34', 'repos/x/y/pulls/34'],
    ['env -i gh api -X PUT repos/x/y/pulls/34/merge', 'repos/x/y/pulls/34'],
    ['sudo gh api -X PUT repos/x/y/pulls/34/merge', 'repos/x/y/pulls/34'],
    // a certain drop in front: origin, as for #622
    ['unset GH_REPO; env -i gh pr merge 34', 'pulls/34'],
    ['export -n GH_REPO; sudo gh pr merge 34', 'pulls/34'],
    ['GH_REPO= env -u GH_REPO gh pr merge 34', 'pulls/34'],
    // wrappers that keep the environment
    ['nice -n 5 gh pr merge 34', 'repos/a/b/pulls/34'],
    ['timeout 60 gh pr merge 34', 'repos/a/b/pulls/34'],
    ['/usr/bin/timeout 60 gh pr merge 34', 'repos/a/b/pulls/34'],
    ['/usr/bin/nice -n 5 gh pr merge 34', 'repos/a/b/pulls/34'],
    ['env -C dir gh pr merge 34', 'repos/a/b/pulls/34'],
    ['env -- gh pr merge 34', 'repos/a/b/pulls/34'],
    ['env FOO=1 gh pr merge 34', 'repos/a/b/pulls/34'],
    ['GH_REPO=x/y env FOO=1 gh pr merge 34', 'repos/x/y/pulls/34'],
  ])('%s with an inherited GH_REPO=a/b looks up %s', (command, lookup) => {
    const { status, calls } = run(command, 'a/b')
    expect(status).toBe(2)
    expect(calls).toContain(lookup)
    if (!lookup.startsWith('repos/a/b')) expect(calls).not.toContain('repos/a/b/')
  })

  it('names a wrapper, not a subshell, when env -u may have stripped GH_REPO', () => {
    const result = hook('export GH_REPO=x/y; env -u GH_REPO gh pr merge 12')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('wrapper')
    expect(result.stderr).not.toContain('subshell')
  })

  it.each(['gh pr merge 12 -R $R', 'GH_REPO=$R gh pr merge 12', 'export GH_REPO=$R; gh pr merge 12'])('does not name a subshell for the plain variable in %s', (command) => {
    const result = hook(command)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('not a literal repository')
    expect(result.stderr).not.toContain('subshell')
  })

  it.each(['$R', '"$(git remote)"', '`git remote`'])('blocks a merge whose -R value %s is no literal repo, with no lookup', (repo) => {
    const result = run(`gh pr merge 12 -R ${repo}`)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it.each([
    'GH_REPO=$R gh pr merge 12',
    'GH_REPO="$(git remote)" gh pr merge 12',
    'export GH_REPO=$R; gh pr merge 12',
    'GH_REPO="$(git remote)"; gh pr merge 12',
    'export GH_REPO=`git remote`; gh pr merge 12',
    // a change inside a subshell or substitution may or may not reach the merge: refused, not guessed (code review)
    'echo $(export GH_REPO=c/d); gh pr merge 12',
    '(export GH_REPO=x/y; gh pr merge 12)',
    'export GH_REPO=a/b; (unset GH_REPO); gh pr merge 12',
    'export GH_REPO=a/b; (GH_REPO=c/d; true); gh pr merge 12',
    'export GH_REPO=a/b; env - gh pr merge 12',
    'export GH_REPO=a/b; env -C dir - gh pr merge 12',
    // GNU env takes unambiguous prefixes of its long options; -0u is -0 plus -u
    'export GH_REPO=a/b; env --ignore-env gh pr merge 12',
    'export GH_REPO=a/b; env --un=GH_REPO gh pr merge 12',
    'export GH_REPO=a/b; env --unset GH_REPO gh pr merge 12',
    'export GH_REPO=a/b; env --split gh pr merge 12',
    'export GH_REPO=a/b; env -0u GH_REPO gh pr merge 12',
    'export GH_REPO=a/b; env -C dir -u GH_REPO gh pr merge 12',
    // appending to a value the gate does not know, and wrappers that may strip GH_REPO from the environment
    'export GH_REPO=a/b; GH_REPO+=z; gh pr merge 12',
    'export GH_REPO=a/b; env -u GH_REPO gh pr merge 12',
    'export GH_REPO=a/b; env -i gh pr merge 12',
    'export GH_REPO=a/b; sudo gh pr merge 12',
    'export GH_REPO=a/b; exec -c gh pr merge 12',
    'GH_REPO=`git remote` gh pr merge 12',
    'gh api -X PUT repos/$O/r/pulls/12/merge',
    'gh api -X PUT repos/o/$(echo r)/pulls/12/merge',
    'gh api -X PUT repos/o/{repo}/pulls/12/merge',
  ])('blocks a merge whose repository is no literal one (%s), with no lookup', (command) => {
    const result = run(command)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it.each([
    'xargs gh pr merge',
    'echo 5 | xargs gh pr merge',
    'echo 5 | xargs -n1 gh pr merge --squash',
    'echo 5 | xargs -I{} gh pr merge {}',
    'echo 5 | xargs -P 2 -n 1 -- gh pr merge',
    'echo 5 | xargs --max-a 1 gh pr merge',
    'echo 5 | xargs --max-p 2 gh pr merge',
    `echo 5 | xargs ${restMerge().replace('pulls/12', 'pulls/{}')}`,
  ])('blocks %j: the PR comes from stdin, with no lookup', (command) => {
    const result = run(command)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it.each([
    'repos/o/r/pulls/$(echo 5 | cat)/merge',
    'repos/o/r/pulls/$(echo 5; echo 6)/merge',
    'repos/o/r/pulls/$(a && b)/merge',
    'repos/o/r/pulls/$(a $(b | c))/merge',
    'repos/o/r/pulls/`a | b`/merge',
    'repos/$(a | b)/r/pulls/5/merge',
  ])('blocks a REST merge path with a separator inside a substitution (%s), with no lookup', (path) => {
    const result = run(`gh api -X PUT ${path}`)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it('looks up the PR named in a REST merge path', () => {
    const { status, calls } = run(restMerge().replace('pulls/12', 'pulls/34'))
    expect(status).toBe(2)
    expect(calls).toContain('pulls/34')
  })

  it('ignores a redirection and a numbered comment when picking the PR', () => {
    expect(run(`${merge('', 'gh')} --squash > /tmp/out`.replace(' 12 ', ' 34 ')).calls).toContain('pulls/34')
    expect(run(`${merge()} 2>&1 # don't`).calls).toContain('pulls/12')
  })

  it('blocks two merge commands in one call without picking one', () => {
    const result = run(`${merge()} && ${merge()}`)
    expect(result.status).toBe(2)
    expect(result.calls).toBe('')
  })

  it('makes no gh call for a command named only in a quoted string or heredoc', () => {
    expect(run(`git commit -m "x\n${merge()} stays"`)).toEqual({ status: 0, calls: '' })
    expect(run(`cat <<EOF\n${merge()}\nEOF`)).toEqual({ status: 0, calls: '' })
    expect(run(`git commit -m "x\n${restMerge()}"`)).toEqual({ status: 0, calls: '' })
  })

  it.each([merge(), restMerge()])('resolves the PR over REST only and lets a docs-only PR through: %s', (command) => {
    const result = hook(command, restBin)
    expect(result.stderr).toContain('tier=skip')
    expect(result.status).toBe(0)
    const calls = readFileSync(join(restBin, 'gh.log'), 'utf8')
    expect(calls).toContain('api repos/o/r/pulls/12')
    expect(calls).not.toMatch(/^pr /m)
  })

  // The parser is its own file (#640), so an apostrophe in it, even in a comment, cannot end a shell string and break the hook.
  it('keeps working when the parser file contains an apostrophe (#640)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-hook-apostrophe-'))
    copyFileSync(resolve(root, '.claude/hooks/e2e-before-merge.sh'), join(dir, 'e2e-before-merge.sh'))
    copyFileSync(resolve(root, '.claude/hooks/hook-input.sh'), join(dir, 'hook-input.sh'))
    const parser = readFileSync(resolve(root, '.claude/hooks/e2e-merge-parse.pl'), 'utf8')
    writeFileSync(join(dir, 'e2e-merge-parse.pl'), `# it's a comment with an apostrophe, and "a quote"\n${parser}`)
    const run = (command: string) => spawnSync('bash', [join(dir, 'e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root, GH_REPO: 'o/r' },
    })
    const blocked = run(merge())
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('gh-stub-failed')
    expect(blocked.stderr).not.toContain('cannot parse')
    expect(run('echo hello').status).toBe(0)
  })

  // Proves the hook reads the .pl next to it (the old inline-perl hook would ignore this file and parse fine).
  it('reads the parser file next to the hook: a broken one lands in the fail-closed fallback (#640)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-hook-broken-parser-'))
    copyFileSync(resolve(root, '.claude/hooks/e2e-before-merge.sh'), join(dir, 'e2e-before-merge.sh'))
    copyFileSync(resolve(root, '.claude/hooks/hook-input.sh'), join(dir, 'hook-input.sh'))
    writeFileSync(join(dir, 'e2e-merge-parse.pl'), 'this is not perl (\n')
    const run = (command: string) => spawnSync('bash', [join(dir, 'e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root, GH_REPO: 'o/r' },
    })
    const blocked = run(merge())
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('cannot parse')
    expect(run('echo hello').status).toBe(0)
  })

  it('finds the parser next to the hook, whatever the working directory', () => {
    const result = spawnSync('bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
      input: JSON.stringify({ tool_input: { command: merge() } }),
      encoding: 'utf8',
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: root, GH_REPO: 'o/r' },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).not.toContain('cannot parse')
  })
})

// #2: a missing `jq` used to leave the command empty, so the hook saw no merge and let it through unchecked.
describe('e2e-before-merge hook without jq (#2)', () => {
  // A PATH that holds the tools the hook needs but no jq, resolved from the real PATH.
  const noJqBin = (extra: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-hook-nojq-'))
    for (const tool of ['bash', 'sh', 'cat', 'sed', 'tr', 'grep', 'head', 'dirname', 'mktemp', 'rm', 'awk', 'env', 'git', 'date', 'paste', 'perl']) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
      if (found && !(tool in extra)) symlinkSync(found, join(dir, tool))
    }
    for (const [name, body] of Object.entries(extra)) {
      writeFileSync(join(dir, name), body)
      chmodSync(join(dir, name), 0o755)
    }
    return dir
  }
  const run = (path: string, command: string) => spawnSync('/bin/bash', [resolve(root, '.claude/hooks/e2e-before-merge.sh')], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, PATH: path, CLAUDE_PROJECT_DIR: root, GH_REPO: 'o/r' },
  })

  it('the test PATH really has no jq', () => {
    expect(spawnSync('sh', ['-c', 'command -v jq'], { env: { PATH: noJqBin() } }).status).not.toBe(0)
  })

  it('blocks a merge with a message that names jq, and lets other commands through', () => {
    const path = noJqBin({ gh: '#!/bin/sh\nexit 1\n' })
    for (const command of [merge(), restMerge(), 'gh -R o/r pr merge 12', 'E2E_GATE=full gh pr merge 12']) {
      const result = run(path, command)
      expect(result.status, command).toBe(2)
      expect(result.stderr, command).toContain('jq is missing')
    }
    for (const command of ['echo hi', 'gh pr view 12', 'git status', "git commit -m 'gh pr merge notes'"]) {
      const result = run(path, command)
      expect(result.status, command).toBe(0)
    }
  })

  it('blocks a merge too when perl cannot read the input either, and lets unrelated commands through', () => {
    const path = noJqBin({ perl: '#!/bin/sh\nexit 1\n' })
    for (const command of [merge(), restMerge(), '"gh" pr merge 12']) {
      const result = run(path, command)
      expect(result.status, command).toBe(2)
      expect(result.stderr, command).toContain('cannot read the hook input')
    }
    for (const command of ['echo hi', 'gh pr view 12', 'git status']) {
      expect(run(path, command).status, command).toBe(0)
    }
  })
})
