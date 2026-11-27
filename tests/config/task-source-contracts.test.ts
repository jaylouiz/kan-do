import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Cross-file contracts of the task source layer (ADR 015) that no single file shows. Each used to be a "never do
// X elsewhere" line in `.claude/rules/task-sources.md`; the mechanism behind each is documented at the code named in
// the allowlist. A new writer or caller fails here: route it through the named path, or widen the list on purpose.

const root = resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'src-tauri', 'tests', 'docs', 'release-notes', 'public', 'scripts', '__tests__', 'types'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name) ? [path] : []
  })
}

/** Comments removed, so a doc comment that names a call or a field does not count. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const files = sourceFiles(root).map(path => ({ file: relative(root, path), code: withoutComments(readFileSync(path, 'utf8')) }))

/** The files whose code matches `pattern`. */
const filesMatching = (pattern: RegExp) => files.filter(({ code }) => pattern.test(code)).map(({ file }) => file).sort()

describe('task source contracts (ADR 015)', () => {
  it('a Notion page is created only through NotionSource.create (#528: the create-doubt lookup lives there)', () => {
    // The HTTP request, the client method's one caller, and the integration's one caller.
    expect(filesMatching(/'POST',\s*'\/pages'/)).toEqual(['integrations/NotionClientAPI.ts'])
    expect(filesMatching(/\.createPage\(/)).toEqual(['integrations/NotionIntegration.ts'])
    expect(filesMatching(/\.createTask\(/).every(file => file.startsWith('integrations/sources/'))).toBe(true)
  })

  it('task.sourceNotPlanned is written only by the planning paths (#357)', () => {
    const writes = /sourceNotPlanned\s*:(?!\s*_)|\.sourceNotPlanned\s*=[^=]|delete\s+[\w.]+\.sourceNotPlanned/
    expect(filesMatching(writes)).toEqual([
      'composables/useTaskSync.ts',
      'integrations/NotionIntegration.ts',
      'integrations/sources/RemindersSource.ts',
      'store/tasks.ts',
    ])
  })

  it('mergeTasks has one production caller and it passes fetchStartedAt and pushing (#357, #390)', () => {
    const callers = files.filter(({ code }) => /\bmergeTasks\(/.test(code) && !/function mergeTasks\(/.test(code))
    expect(callers.map(({ file }) => file)).toEqual(['composables/useIntegrationManager.ts'])
    for (const { code } of callers) {
      const args = code.slice(code.indexOf('mergeTasks('), code.indexOf('});', code.indexOf('mergeTasks(')))
      expect(args).toMatch(/\bfetchStartedAt\b/)
      expect(args).toMatch(/\bpushing\b/)
    }
  })

  it('boardConfig (and with it boardConfig.sources) is written only inside the board store', () => {
    // A local `const boardConfig = …` (the import migrations) is a declaration, not a write.
    expect(filesMatching(/(?<!(?:const|let|var)\s+)\bboardConfig(\.value)?(\.sources)?\s*=[^=>]/).filter(file => file !== 'store/board.ts')).toEqual([])
  })
})
