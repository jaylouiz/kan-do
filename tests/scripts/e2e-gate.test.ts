import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'
import GateProgressReporter from '../../scripts/e2e-gate-reporter.mjs'
import {
  bodySpecNames, fastReleaseSpecs, changedTextStrings, isStyleOnlyVue, listCataloguedComponents, listSpecs, localeStrings, parseProgress, parsePr, readE2eSources, resumeArgs, selectE2e, specsImportingHelpers,
  specsMentioning, testIdStrings, vueStyleJudge,
} from '../../scripts/e2e-gate.mjs'
import {
  dirtyOutside, e2eArgs, e2eRefusal, findFreePort, parseSummary, satisfyingStamps, stampKey, stampPath,
} from '../../scripts/release/e2e.mjs'

// The pre-merge gate (#355): pure tier selection, stamp keys, the run arguments and a guard that keeps the
// checked-in rules in step with the tree.

const root = resolve(__dirname, '../..')
interface Config { smoke: string[], design?: { paths: string[], specs: string[] }, catalog?: { paths: string[], components: string, specs: string[] }, visual?: { paths: string[], specs: string[] }, map: { paths: string[], specs: string[], risk?: boolean, fast?: string[] }[] }
const config = JSON.parse(readFileSync(resolve(root, '.claude/hooks/e2e-gate.json'), 'utf8')) as Config
const existingSpecs = listSpecs(root)
/** One file per glob of the former `full` list (#446): none of them selects the whole suite any more. */
const FORMER_FULL_FILES = [
  'store/tasks.ts', 'composables/useTaskSync.ts', 'composables/useBoardDndKit.ts', 'composables/useColumnSortable.ts', 'composables/useStackExpansion.ts',
  'components/board/SortableTaskWrapper.vue', 'components/board/ColumnDropZone.vue', 'components/task/TaskStack.vue', 'integrations/NotionIntegration.ts',
  'server/api/notion/tasks.get.ts', 'lib/dataStorage.ts', 'lib/taskSources.ts', 'lib/taskDates.ts', 'lib/secrets.ts', 'utils/dataFile/exportImport.ts',
  'src-tauri/src/data_file.rs', 'tests/e2e/snapshots/visual-regression.spec.ts/board.png', 'tests/e2e/helpers/seed.ts', 'tests/e2e/playwright.config.ts',
  'tests/e2e/global-setup.ts', 'app.config.ts', 'assets/css/board.css', 'nuxt.config.ts', 'package.json', 'package-lock.json',
  'plugins/00.data-storage.client.ts', 'plugins/pinia.ts', 'plugins/e2e-seed.client.ts', 'plugins/secrets.client.ts', 'types/dataFile.ts', 'types/store/x.ts',
  'types/task.ts', 'types/taskSource.ts', 'types/taskPosition.ts', 'types/state.ts', 'types/pendingTimeUpdate.ts', 'utils/mapHelpers.ts', 'lib/dataBackendTauri.ts',
  'lib/dataStatus.ts', 'lib/secretsBootstrap.ts', 'lib/integrationHealth.ts',
]

/** The specs that assert a button's height or size (#456, `rg` audit of tests/e2e): a change to the button theme in app.config.ts must select all of them. */
const BUTTON_HEIGHT_SPECS = ['source-connections', 'day-close', 'ui-catalog', 'add-task-slot', 'add-task-visible', 'sources-settings', 'archive-feature', 'new-day-recap', 'app-nav']

const e2eSources = readE2eSources(root)
/** The screenshot spec a style change on a UI path, or a changed baseline, adds (`visual` in e2e-gate.json, #684). */
const VISUAL = config.visual!.specs
/** The rendered design scan a file adds (`design` in e2e-gate.json). */
const designFor = (file: string) => (config.design?.paths ?? []).some(glob => matchesGlob(file, glob)) ? config.design!.specs : []

const select = (input: { files?: string[] | null, body?: string, env?: Record<string, string>, styleOnlyVue?: string[] }) =>
  selectE2e({
    files: input.files === undefined ? ['components/settings/DataBackupList.vue'] : input.files,
    body: input.body,
    env: input.env,
    config,
    existingSpecs,
    isStyleOnlyVueFile: file => ({ styleOnly: (input.styleOnlyVue ?? []).includes(file), failed: false }),
    specsImportingHelper: helpers => specsImportingHelpers(helpers, e2eSources),
  })

describe('selectE2e', () => {
  it('skips a PR whose files are all docs-only', () => {
    const result = select({ files: ['docs/release.md', 'README.md', '.claude/hooks/verify.sh'] })
    expect(result).toMatchObject({ tier: 'skip', specs: [] })
  })

  it('does not skip a docs-only list when it is empty or unresolved', () => {
    expect(select({ files: [] }).tier).toBe('full')
    expect(select({ files: null })).toMatchObject({ tier: 'full', reason: 'file list unresolved' })
  })

  it('runs the full suite for E2E_GATE=full in the environment', () => {
    const result = select({ files: ['utils/middleEllipsis.ts'], env: { E2E_GATE: 'full' } })
    expect(result).toMatchObject({ tier: 'full', reason: 'E2E_GATE=full', key: 'full' })
    expect(result.specs).toEqual(existingSpecs)
  })

  it('has no automatic full tier: no label and no glob selects the whole suite (#446)', () => {
    expect(config).not.toHaveProperty('full')
    // the former full globs, and a label that no longer exists, all stay targeted
    for (const file of FORMER_FULL_FILES) expect(select({ files: [file, 'tests/store/tasks.test.ts'] }).tier, file).toBe('targeted')
    expect(select({ files: ['store/tasks.ts'], body: 'label e2e-full' }).tier).toBe('targeted')
  })

  it('treats a full page of files from gh as a possibly truncated list', () => {
    const files = Array.from({ length: 100 }, (_, i) => `components/ui/File${i}.vue`)
    expect(select({ files }).tier).toBe('full')
  })

  // One file per former full glob and the specs (beyond smoke) its area must run.
  it.each([
    ['store/tasks.ts', ['drag-sync', 'pending-sync', 'done-drop', 'carry-over', 'trash']],
    ['store/topicStyles.ts', ['topic-management']],
    ['composables/useTaskSync.ts', ['drag-sync', 'pending-sync', 'task-move-source']],
    ['composables/useBoardDndKit.ts', ['done-drop', 'stack-dnd', 'jetzt-drag-back', 'grouped-dnd', 'mobile-swipe']],
    ['composables/useColumnSortable.ts', ['sorting', 'dnd-open-column-gap']],
    ['composables/useStackExpansion.ts', ['stack-motion', 'stack-sole-drag']],
    ['components/board/SortableTaskWrapper.vue', ['stack-dnd', 'visual-regression']],
    ['components/board/ColumnDropZone.vue', ['done-drop', 'visual-regression']],
    ['components/task/TaskStack.vue', ['stack-a11y', 'stack-pill-title', 'visual-regression']],
    ['integrations/NotionIntegration.ts', ['notion-pagination', 'notion-native-status', 'pending-sync']],
    ['server/api/notion/tasks.get.ts', ['notion-pagination', 'source-connections']],
    ['lib/dataStorage.ts', ['data-settings', 'web-data-transfer']],
    ['lib/taskSources.ts', ['mixed-board', 'task-move-source']],
    ['lib/taskDates.ts', ['carry-over', 'new-day-recap']],
    ['lib/secrets.ts', ['github-settings', 'feedback']],
    ['utils/dataFile/exportImport.ts', ['data-settings', 'web-data-transfer']],
    ['plugins/pinia.ts', ['data-settings', 'web-data-transfer']],
    ['plugins/e2e-seed.client.ts', ['mixed-board', 'new-day-recap', 'sorting']],
    ['types/dataFile.ts', ['data-settings', 'web-data-transfer']],
    ['types/task.ts', ['drag-sync', 'done-drop']],
    ['src-tauri/src/data_file.rs', ['data-settings', 'desktop-pages-shots']],
    ['assets/css/board.css', ['visual-regression', 'a11y']],
    // timers, recap, trash, topics, timebox, focus overlay, delete/undo, settings pages (review of #447, M1 and M2)
    ['lib/taskTimers.ts', ['timer-lifecycle', 'focus-overlay']],
    ['composables/useTaskTimerDriver.ts', ['timer-lifecycle', 'focus-overlay']],
    // app.vue is part of the app shell rule, deliberately broad: see 'app shell and archive mappings (#493)'
    ['composables/useFocusOverlay.ts', ['focus-overlay', 'jetzt-current-card']],
    ['components/recap/NewDayRecap.vue', ['new-day-recap', 'day-close']],
    ['composables/useNewDayRecap.ts', ['new-day-recap', 'archive-feature']],
    ['components/trash/TrashEntryRow.vue', ['trash', 'stack-delete-gap']],
    ['lib/trash.ts', ['trash']],
    ['pages/trash.vue', ['trash']],
    ['composables/useDeleteHold.ts', ['stack-delete-gap', 'completion-undo']],
    ['composables/useUndoWindow.ts', ['trash', 'completion-undo']],
    ['components/topic/TopicEditor.vue', ['topic-management']],
    ['lib/topicStyles.ts', ['topic-management']],
    ['pages/settings/topics.vue', ['topic-management']],
    ['lib/timeboxChipMemory.ts', ['timebox-nudge', 'timebox-progress-chip', 'timebox-presets']],
    ['composables/useTimeboxSuggestion.ts', ['timebox-nudge', 'timebox-progress-chip', 'timebox-presets']],
    ['types/timeboxSuggestion.ts', ['timebox-nudge', 'timebox-progress-chip']],
    ['pages/settings/sources.vue', ['sources-settings', 'source-connections']],
    ['components/settings/SourceRow.vue', ['sources-settings']],
    ['pages/settings/updates.vue', ['updates', 'whats-new']],
    ['components/settings/GithubTokenRow.vue', ['github-settings']],
    ['types/notion.ts', ['notion-pagination', 'notion-setup-stepper']],
    ['types/todoistTask.ts', ['mixed-board-features', 'sources-settings']],
  ])('maps the former risk-area file %s to its related specs, not the whole suite', (file, expected) => {
    const result = select({ files: [file, 'tests/store/tasks.test.ts'] }) // a unit test keeps a css or snapshot file out of the style tier
    expect(result.tier).toBe('targeted')
    expect(result.unmapped).toEqual([])
    expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, ...expected]))
    expect(result.specs.length).toBeLessThan(existingSpecs.length / 2)
  })

  it.each([
    'package.json', 'package-lock.json', 'nuxt.config.ts',
  ])('runs smoke + visual-regression + the server error page spec when the dependency or build config %s changes (#541)', (file) => {
    const result = select({ files: [file] })
    expect(result).toMatchObject({ tier: 'targeted', unmapped: [] })
    expect(result.specs).toEqual([...new Set([...config.smoke, ...designFor(file), 'visual-regression', 'server-error-page', 'overlay-scrim'])].sort())
  })

  // #541: the spec proves server/error-handler.ts still wraps Nuxt's handler (nuxt.config.ts wires it, a Nuxt/Nitro bump can break it)
  it('runs the server error page spec when the error handler changes, next to the source specs of server/** (#541)', () => {
    const result = select({ files: ['server/error-handler.ts'] })
    expect(result).toMatchObject({ tier: 'targeted', unmapped: [] })
    expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, 'server-error-page', 'notion-stub-sync']))
  })

  // #456: app.config.ts is also the button theme (#424): visual-regression plus the specs that assert a button's height
  it('runs visual-regression and the button-height specs when app.config.ts changes', () => {
    const result = select({ files: ['app.config.ts'] })
    expect(result).toMatchObject({ tier: 'targeted', unmapped: [] })
    expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, ...designFor('app.config.ts'), 'visual-regression', ...BUTTON_HEIGHT_SPECS]))
  })

  it('runs smoke + a documented set when playwright.config.ts or global-setup.ts changes', () => {
    for (const file of ['tests/e2e/playwright.config.ts', 'tests/e2e/global-setup.ts']) {
      const result = select({ files: [file] })
      expect(result.tier).toBe('targeted')
      expect(result.unmapped).toEqual([])
      expect(result.specs).toEqual([...new Set([...config.smoke, 'visual-regression', 'i18n', 'notion-pagination', 'board-wide-layout'])].sort())
    }
  })

  describe('helper changes run the specs that import the helper (#446)', () => {
    it('adds the importers of a changed helper to smoke, derived from the imports', () => {
      const result = select({ files: ['tests/e2e/helpers/notionWizard.ts'] })
      expect(result.tier).toBe('targeted')
      expect(result.unmapped).toEqual([])
      expect(result.specs).toEqual([...new Set([...config.smoke, 'sources-settings', 'welcome-setup', 'motion-guard'])].sort())
    })

    it('follows imports between helpers: a constants.ts change reaches the importers of seed.ts and dnd.ts', () => {
      const result = select({ files: ['tests/e2e/helpers/constants.ts'] })
      expect(result.specs).toEqual(expect.arrayContaining(['notion-pagination', 'stack-mobile', 'timebox-nudge', 'done-drop', 'a11y', 'visual-regression']))
    })

    it('reads the specs of every helper from the tree, none is left out', () => {
      const helpers = Object.keys(e2eSources).filter(path => path.startsWith('tests/e2e/helpers/'))
      expect(helpers.length).toBeGreaterThan(0)
      for (const helper of helpers) expect(select({ files: [helper] }).unmapped, helper).toEqual([])
    })

    it('resolves relative imports of a synthetic tree, with and without extension, and ignores unrelated specs', () => {
      const sources = {
        'tests/e2e/helpers/a.ts': 'export const a = 1',
        'tests/e2e/helpers/b.ts': "import { a } from './a'\nexport const b = a",
        'tests/e2e/x.spec.ts': "import { b } from './helpers/b'",
        'tests/e2e/y.spec.ts': "import { a } from './helpers/a.ts'",
        'tests/e2e/z.spec.ts': "import { c } from './helpers/c'",
      }
      expect(specsImportingHelpers(['tests/e2e/helpers/a.ts'], sources)).toEqual(['x', 'y'])
      expect(specsImportingHelpers(['tests/e2e/helpers/b.ts'], sources)).toEqual(['x'])
      expect(specsImportingHelpers([], sources)).toEqual([])
    })
  })

  describe('tests/ files and the gate\'s own files (review of #447, L3 to L5)', () => {
    it('reports a changed helper that no spec imports as unmapped, and runs smoke only for it', () => {
      const lonely = { 'tests/e2e/helpers/lonely.ts': 'export const a = 1', 'tests/e2e/x.spec.ts': 'test("x")' }
      const result = selectE2e({
        files: ['tests/e2e/helpers/lonely.ts'], config, existingSpecs, specsImportingHelper: helpers => specsImportingHelpers(helpers, lonely),
      })
      expect(result).toMatchObject({ tier: 'targeted', unmapped: ['tests/e2e/helpers/lonely.ts'] })
      expect(result.specs).toEqual([...config.smoke].sort())
    })

    it('finds the importers of a helper in a subdirectory, and reads such helpers from the tree', () => {
      const sources = {
        'tests/e2e/helpers/sub/deep.ts': 'export const d = 1',
        'tests/e2e/helpers/top.ts': "import { d } from './sub/deep'\nexport const t = d",
        'tests/e2e/x.spec.ts': "import { t } from './helpers/top'",
        'tests/e2e/y.spec.ts': "import { d } from './helpers/sub/deep.ts'",
      }
      expect(specsImportingHelpers(['tests/e2e/helpers/sub/deep.ts'], sources)).toEqual(['x', 'y'])
      const dir = mkdtempSync(join(tmpdir(), 'kando-gate-src-'))
      mkdirSync(join(dir, 'tests/e2e/helpers/sub'), { recursive: true })
      writeFileSync(join(dir, 'tests/e2e/helpers/sub/deep.ts'), 'export const d = 1')
      writeFileSync(join(dir, 'tests/e2e/helpers/top.ts'), 'export const t = 1')
      writeFileSync(join(dir, 'tests/e2e/x.spec.ts'), '')
      expect(Object.keys(readE2eSources(dir)).sort()).toEqual(['tests/e2e/helpers/sub/deep.ts', 'tests/e2e/helpers/top.ts', 'tests/e2e/x.spec.ts'])
      rmSync(join(dir, 'tests/e2e/helpers'), { recursive: true })
      expect(Object.keys(readE2eSources(dir))).toEqual(['tests/e2e/x.spec.ts']) // a missing helpers directory never throws
      rmSync(dir, { recursive: true, force: true })
    })

    it('maps the Notion stub fixtures to the specs that read them', () => {
      const result = select({ files: ['tests/fixtures/notion/tasks.json'] })
      expect(result.unmapped).toEqual([])
      expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, 'notion-native-status', 'carry-over', 'drag-sync']))
    })

    it('exempts only unit-test files, their helpers and unit fixtures from unmapped', () => {
      expect(select({ files: ['tests/store/tasks.test.ts', 'tests/components/task/TaskCard.open.spec.ts', 'tests/helpers/i18n.ts', 'tests/setup/i18n.ts', 'tests/fixtures/todoist/x.json'] }).unmapped).toEqual([])
      expect(select({ files: ['tests/e2e/notes.json', 'tests/fixtures/notion/new-file.json'] }).unmapped).toEqual(['tests/e2e/notes.json'])
    })

    it.each([
      '.claude/hooks/e2e-gate.json', '.claude/hooks/e2e-before-merge.sh', '.claude/hooks/e2e-merge-parse.pl', 'scripts/e2e-gate.mjs',
    ])('does not treat the gate file %s as docs-only: smoke plus its own spot-check set', (file) => {
      const result = select({ files: [file, 'docs/a.md'] })
      expect(result).toMatchObject({ tier: 'targeted', unmapped: [] })
      expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, 'drag-sync', 'data-settings', 'timer-lifecycle']))
      expect(result.specs.length).toBeLessThan(existingSpecs.length / 2)
      expect(select({ files: [file] }).tier).toBe('targeted')
    })

    it.each(['docs/copy/terms.json', 'docs/copy/terms.lock.json'])('does not treat the term registry %s as docs-only and runs the copy-editor spec (#486)', (file) => {
      const result = select({ files: [file] })
      expect(result.tier).toBe('targeted')
      expect(result.specs).toEqual(expect.arrayContaining([...config.smoke, 'copy-editor']))
      expect(select({ files: ['docs/copy/voice.md'] }).tier).toBe('skip')
    })

    it('skips docs plus unit-test files, but not E2E inputs (#902)', () => {
      expect(select({ files: ['.claude/rules/task-sources.md', 'tests/config/x.test.ts'] })).toMatchObject({ tier: 'skip', reason: 'docs-only' })
      expect(select({ files: ['docs/a.md', 'tests/e2e/helpers/seed.ts'] }).tier).not.toBe('skip')
      expect(select({ files: ['docs/a.md', 'tests/fixtures/notion/page.json'] }).tier).not.toBe('skip')
    })

    it('treats the Impeccable design sidecar as docs, next to DESIGN.md (#494)', () => {
      expect(select({ files: ['DESIGN.md', '.impeccable/design.json'] })).toMatchObject({ tier: 'skip', reason: 'docs-only' })
      expect(select({ files: ['.impeccable/design.json'] }).unmapped ?? []).toEqual([])
    })

    it('does not skip the sidecar together with code, nor other .impeccable files (#494)', () => {
      expect(select({ files: ['.impeccable/design.json', 'lib/icons.ts'] }).tier).not.toBe('skip')
      expect(select({ files: ['.impeccable/config.json'] }).tier).not.toBe('skip')
    })

    it('keeps the rest of .claude/ docs-only', () => {
      expect(select({ files: ['.claude/hooks/verify.sh', '.claude/rules/e2e.md', '.claude/issue-workflow.md'] }).tier).toBe('skip')
    })
  })

  describe('style tier (#375)', () => {
    it('runs only the design scan when every file is a stylesheet, a snapshot or docs, even in a risk area', () => {
      const result = select({ files: ['assets/css/dnd.css', 'components/task/TaskStack.css', 'tests/e2e/snapshots/visual-regression.spec.ts/board.png', 'docs/design/backlog.md'] })
      expect(result).toMatchObject({ tier: 'targeted', reason: 'style-only + design scan + visual baselines + baseline specs', specs: [...config.design!.specs, ...VISUAL].toSorted() })
    })

    it('runs the design scan and the screenshots for a .vue file whose changed lines all lie in <style>, even in a risk area', () => {
      const result = select({ files: ['components/task/TaskStack.vue', 'docs/a.md'], styleOnlyVue: ['components/task/TaskStack.vue'] })
      expect(result).toMatchObject({ tier: 'targeted', specs: [...config.design!.specs, ...VISUAL].toSorted() })
    })

    it('runs the screenshots for a PR that only re-records baselines (#684: PR 683 ran no E2E), and the owning spec of any other baseline', () => {
      expect(select({ files: ['tests/e2e/snapshots/visual-regression.spec.ts/board.png', 'docs/design/backlog.md'] })).toMatchObject({ tier: 'targeted', specs: VISUAL })
      expect(select({ files: ['tests/e2e/snapshots/state-structure.spec.ts/x.aria.yml'] })).toMatchObject({ tier: 'targeted', specs: ['state-structure'] })
      expect(select({ files: ['tests/e2e/snapshots/ui-catalog/Board.json'] })).toMatchObject({ tier: 'style', specs: [] }) // a folder that names no spec
      expect(select({ files: ['tests/e2e/snapshots/gone.spec.ts/x.png'] })).toMatchObject({ tier: 'style', specs: [] }) // a spec that no longer exists is never run
    })

    it('selects the owning spec of a baseline that comes with code, in every tier', () => {
      expect(select({ files: ['store/tasks.ts', 'tests/e2e/snapshots/state-structure.spec.ts/x.aria.yml'] }).specs).toContain('state-structure')
    })

    it('keeps tier style for a stylesheet outside the UI paths', () => {
      expect(select({ files: ['scripts/report.css', 'docs/a.md'] })).toMatchObject({ tier: 'style', specs: [] })
    })

    it('adds the specs of the E2E-specs line to the style tier and reports an unknown name (#684)', () => {
      const result = select({ files: ['tests/e2e/snapshots/ui-catalog/Board.json'], body: 'E2E-specs: a11y no-such-spec' })
      expect(result).toMatchObject({ tier: 'targeted', specs: ['a11y'], unknown: ['no-such-spec'], reason: 'style-only + E2E-specs line' })
      expect(select({ files: ['tests/e2e/snapshots/ui-catalog/Board.json'], body: 'E2E-specs: none, the baselines are checked by hand' })).toMatchObject({ tier: 'style', specs: [] })
      expect(select({ files: ['tests/e2e/snapshots/ui-catalog/Board.json'], body: 'E2E-specs: nope' })).toMatchObject({ tier: 'style', specs: [], unknown: ['nope'] })
    })

    it('keeps a .vue file with a <template> or <script> change in its tier', () => {
      expect(select({ files: ['components/task/TaskStack.vue', 'assets/css/dnd.css'] })).toMatchObject({ tier: 'targeted', reason: 'smoke + mapped + touched specs' })
      expect(select({ files: ['components/settings/DataBackupList.vue', 'components/ui/tokens.css'] }).tier).toBe('targeted')
    })

    it('does not run the style tier when a store file comes with the css', () => {
      expect(select({ files: ['assets/css/dnd.css', 'store/tasks.ts'] }).tier).toBe('targeted')
      expect(select({ files: ['components/ui/tokens.css', 'utils/middleEllipsis.ts'] }).tier).toBe('targeted')
    })

    it('runs the touched specs and the named ones when the PR also changes tests/e2e specs, not the smoke set', () => {
      const result = select({ files: ['assets/css/dnd.css', 'tests/e2e/a11y.spec.ts', 'tests/e2e/gone-spec.spec.ts', 'tests/e2e/snapshots/a11y.spec.ts/x.png'], body: 'E2E-specs: timebox-presets' })
      // the E2E-specs line counts in the style tier too (#684)
      expect(result).toMatchObject({ tier: 'targeted', specs: ['a11y', 'timebox-presets', ...config.design!.specs, ...VISUAL].toSorted() })
    })

    it('leaves a docs plus spec PR in the targeted tier with its smoke set', () => {
      expect(select({ files: ['docs/a.md', 'tests/e2e/a11y.spec.ts'] }).specs).toEqual(expect.arrayContaining([...config.smoke, 'a11y']))
    })

    it('leaves a docs-only PR as skip, and forced runs stay full', () => {
      expect(select({ files: ['docs/a.md'] })).toMatchObject({ tier: 'skip', reason: 'docs-only' })
      expect(select({ files: ['assets/css/dnd.css'], env: { E2E_GATE: 'full' } })).toMatchObject({ tier: 'full', reason: 'E2E_GATE=full' })
    })

    it('never judges a possibly truncated list as style-only', () => {
      const files = Array.from({ length: 100 }, (_, i) => `assets/css/part-${i}.css`)
      expect(select({ files }).tier).toBe('full')
    })
  })

  it('runs the scroll bar specs for a task sheet shell change, also in fast mode (#719: #705 went red on main)', () => {
    for (const file of ['components/task/TaskMorphShell.vue', 'utils/sheetPlacement.ts']) {
      for (const mode of ['quality', 'fast']) {
        const result = select({ files: [file], env: { KANDO_TESTING_MODE: mode } })
        expect(result.specs, `${file} ${mode}`).toEqual(expect.arrayContaining(['scrollbar-shift', 'scrollbar-gutter']))
      }
    }
  })

  it('runs the Reminders read-only and topic picker specs for a task sheet content change, also in fast mode (#868: #867 went red on main)', () => {
    for (const file of ['components/task/TaskDetailContent.vue', 'components/task/TaskDetailNotes.vue', 'components/task/TaskSheetMenu.vue', 'components/task/TaskPropertyRow.vue', 'components/task/TaskMorphShell.vue']) {
      for (const mode of ['quality', 'fast']) {
        const result = select({ files: [file], env: { KANDO_TESTING_MODE: mode } })
        expect(result.specs, `${file} ${mode}`).toEqual(expect.arrayContaining(['reminders-source', 'topic-management']))
      }
    }
  })

  it('keeps the phone hit areas and the motion guard in fast mode for task, settings and intro hint files (#822, #823: #818 and #820 went red on main)', () => {
    for (const [file, spec] of [['components/task/TaskDetailMetadata.vue', 'phone-hit-areas'], ['components/board/IntroHintOverlay.vue', 'motion-guard'], ['components/settings/IntroHintsSheet.vue', 'motion-guard']] as const) {
      const result = select({ files: [file], env: { KANDO_TESTING_MODE: 'fast' } })
      expect(result.specs, file).toContain(spec)
    }
  })

  it('selects smoke + mapped specs for a data settings component', () => {
    const result = select({ files: ['components/settings/DataBackupList.vue'] })
    expect(result.tier).toBe('targeted')
    expect(result.specs).toEqual([...new Set([...config.smoke, ...config.design!.specs, 'data-settings', 'web-data-transfer'])].sort())
    expect(result.unmapped).toEqual([])
  })

  it('runs the day close and task sheet focus specs for a change to the responsive overlay shell (#555)', () => {
    for (const file of ['components/ui/ResponsiveOverlay.vue', 'composables/useIsDesktop.ts']) {
      const result = select({ files: [file] })
      expect(result.specs).toEqual(expect.arrayContaining(['day-close', 'task-detail-focus', 'task-detail', 'a11y', 'visual-regression']))
    }
  })

  it('unions smoke, the map of every changed file, touched specs and the PR body line', () => {
    const result = select({
      files: ['components/notion/NotionSetup.vue', 'composables/useFeedback.ts', 'tests/e2e/a11y.spec.ts', 'docs/x.md'],
      body: 'Summary\n\nE2E-specs: timebox-presets, text-zoom\nmore text',
    })
    expect(result.tier).toBe('targeted')
    expect(result.specs).toEqual([...new Set([
      ...config.smoke, ...config.design!.specs, 'notion-setup-stepper', 'notion-pagination', 'notion-native-status', 'hover-answer', 'phone-hit-areas', 'feedback', 'feedback-screenshot', 'a11y', 'timebox-presets', 'text-zoom',
    ])].sort())
  })

  it('names an unknown spec of the PR body instead of running it', () => {
    const result = select({ body: 'E2E-specs: data-settings no-such-spec' })
    expect(result.unknown).toEqual(['no-such-spec'])
    expect(result.specs).not.toContain('no-such-spec')
    expect(result.specs).toContain('data-settings')
  })

  it('drops a deleted spec: a touched file whose spec no longer exists runs nothing for it', () => {
    const result = select({ files: ['tests/e2e/gone-spec.spec.ts', 'tests/e2e/a11y.spec.ts'] })
    expect(result.specs).toContain('a11y')
    expect(result.specs).not.toContain('gone-spec')
    expect(result.unmapped).toEqual([])
  })

  it('does not skip a docs-only PR when E2E_GATE=full is set', () => {
    expect(select({ files: ['docs/a.md'], env: { E2E_GATE: 'full' } })).toMatchObject({ tier: 'full', reason: 'E2E_GATE=full' })
  })

  it('never treats a possibly truncated file list as docs-only', () => {
    const docs = Array.from({ length: 100 }, (_, i) => `docs/page-${i}.md`)
    expect(select({ files: docs }).tier).toBe('full')
    expect(select({ files: docs.slice(0, 99) }).tier).toBe('skip')
  })

  it('reports a changed file that matches no map rule, and runs smoke only', () => {
    const result = select({ files: ['utils/not-in-any-rule.ts', 'tests/utils/not-in-any-rule.test.ts'] })
    expect(result.tier).toBe('targeted')
    expect(result.unmapped).toEqual(['utils/not-in-any-rule.ts'])
    expect(result.specs).toEqual([...config.smoke].sort())
  })

  it('does not count unit tests or docs as unmapped', () => {
    expect(select({ files: ['tests/store/tasks.test.ts', 'docs/a.md', 'components/board/Board.vue'] }).unmapped).toEqual([])
  })

  it('gives the same targeted key regardless of file order', () => {
    const files = ['components/notion/NotionSetup.vue', 'composables/useFeedback.ts']
    expect(select({ files }).key).toBe(select({ files: [...files].reverse() }).key)
  })
})

const sfc = (template: string, script: string, style: string) =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n\n<style scoped>\n${style}\n</style>\n`

describe('specs that broke on main without the gate selecting them (#317)', () => {
  const pick = (files: string[]) =>
    selectE2e({
      files, body: '', env: {}, mode: 'quality', config, existingSpecs,
      isStyleOnlyVueFile: () => ({ styleOnly: false, failed: false }),
      specsImportingHelper: helpers => specsImportingHelpers(helpers, e2eSources),
      changedStrings: () => ({ strings: [], failed: [] }),
      specsMentioning: () => [],
      cataloguedComponents: () => listCataloguedComponents(root),
    }).specs

  it.each([
    // #312: the timer's 10 s checkpoint (#286) moved what a card has stored; add-task-slot reads it after a save
    ['composables/useTaskTimerDriver.ts', 'add-task-slot'],
    ['lib/liveTime.ts', 'add-task-slot'],
    // #290: the task sheet re-centres the app bar; scrollbar-shift watches every element for horizontal moves
    ['assets/css/board-focus-overlay.css', 'scrollbar-shift'],
    ['components/nav/AppNav.vue', 'scrollbar-shift'],
  ])('%s selects %s', (file, spec) => {
    expect(pick([file, 'tests/store/tasks.test.ts'])).toContain(spec)
  })
})

describe('selectE2e in fast testing mode (#693)', () => {
  const fast = (input: { files: string[], body?: string, env?: Record<string, string>, styleOnlyVue?: string[], mode?: string }) =>
    selectE2e({
      files: input.files,
      body: input.body,
      env: input.env,
      mode: 'mode' in input ? input.mode : 'fast',
      config,
      existingSpecs,
      isStyleOnlyVueFile: file => ({ styleOnly: (input.styleOnlyVue ?? []).includes(file), failed: false }),
      specsImportingHelper: helpers => specsImportingHelpers(helpers, e2eSources),
      changedStrings: () => ({ strings: ['Offen'], failed: [] }),
      specsMentioning: strings => specsMentioning(strings, e2eSources),
      cataloguedComponents: () => listCataloguedComponents(root),
    })

  it('keeps the server error page spec in the fast tier for the error handler and the Nuxt config (#541)', () => {
    for (const file of ['server/error-handler.ts', 'nuxt.config.ts', 'package.json']) {
      expect(fast({ files: [file] }).specs).toContain('server-error-page')
    }
  })

  it('runs smoke only for a non-risk, uncatalogued file: no design specs, no label/testid match', () => {
    const result = fast({ files: ['utils/middleEllipsis.ts'] })
    expect(result).toMatchObject({ tier: 'fast', specs: [...config.smoke].sort(), byText: [] })
    expect(result.specs).not.toContain('design-detect')
    expect(fast({ files: ['components/settings/DataBackupList.vue'], mode: 'quality' }).specs).toEqual(expect.arrayContaining(config.design!.specs))
  })

  // kd#230: PR 228 changed `--shadow-task` and the style of TaskCard, BoardPageDots and PageSheet; fast mode ran 37 specs, not ui-catalog
  describe('the style fingerprint (kd#230)', () => {
    const fingerprint = config.catalog!.specs
    const withFingerprint = [...config.smoke, ...fingerprint].sort()

    it('adds ui-catalog, and no other design spec, for a changed catalogued component', () => {
      const result = fast({ files: ['components/settings/DataBackupList.vue'] })
      expect(result).toMatchObject({ tier: 'fast', specs: withFingerprint })
      expect(result.specs).not.toContain('design-detect')
      expect(fast({ files: ['components/task/TaskCard.vue', 'components/board/BoardPageDots.vue'] }).specs).toContain('ui-catalog')
    })

    it('reads no catalog folder for a file that cannot match, and nothing from a missing one', () => {
      let reads = 0
      const run = (files: string[]) => selectE2e({ files, config, existingSpecs, mode: 'fast', cataloguedComponents: () => { reads += 1; return new Set(['TaskCard']) } })
      expect(run(['server/api/x.ts', 'components/a/Other.vue', 'docs/a.md']).specs).not.toContain('ui-catalog')
      expect(reads).toBe(1) // only the .vue file asked
      reads = 0
      expect(run(['components/a/TaskCard.vue', 'components/a/Other.vue']).specs).toContain('ui-catalog')
      expect(reads).toBe(1)
      expect(run(['components/a/Other.vue', 'components/a/Another.vue']).specs).not.toContain('ui-catalog') // one read per selection, however many files
      expect(reads).toBe(2)
      reads = 0
      run(['server/api/x.ts', 'assets/css/main.css'])
      expect(reads).toBe(0)
      const empty = mkdtempSync(join(tmpdir(), 'kando-gate-nocatalog-'))
      expect(listCataloguedComponents(empty).size).toBe(0)
      rmSync(empty, { recursive: true })
    })

    it('adds it for a token sheet or the theme config, and for a style-only PR that the gate used to skip', () => {
      expect(fast({ files: ['assets/css/main.css'] })).toMatchObject({ tier: 'targeted', reason: 'style-only + style fingerprint + visual baselines', specs: [...fingerprint, ...VISUAL].sort() })
      expect(fast({ files: ['app.config.ts'] }).specs).toContain('ui-catalog')
      expect(fast({ files: ['assets/img/desk.svg'] }).specs).not.toContain('ui-catalog')
      expect(fast({ files: ['components/task/TaskCard.vue'], styleOnlyVue: ['components/task/TaskCard.vue'] })).toMatchObject({ tier: 'targeted', specs: [...fingerprint, ...VISUAL].sort() })
      // a changed spec still runs next to it
      expect(fast({ files: ['assets/css/dnd.css', 'tests/e2e/a11y.spec.ts'] }).specs).toEqual(['a11y', ...fingerprint, ...VISUAL].sort())
    })

    it('does not add it for a component without a catalog entry, a composable, a lib file or docs', () => {
      expect(listCataloguedComponents(root).has('Board')).toBe(true)
      expect(listCataloguedComponents(root).has('NoSuchComponent')).toBe(false)
      expect(fast({ files: ['components/a/NoSuchComponent.vue'], styleOnlyVue: ['components/a/NoSuchComponent.vue'] })).toMatchObject({ tier: 'targeted', specs: VISUAL }) // no fingerprint, the screenshots only
      expect(fast({ files: ['composables/useFeedback.ts', 'lib/taskDates.ts'] }).specs).not.toContain('ui-catalog')
      expect(fast({ files: ['docs/design/backlog.md'] }).tier).toBe('skip')
    })

    it('leaves quality mode as it was: the design set carries the fingerprint', () => {
      expect(fast({ files: ['assets/css/main.css'], mode: 'quality' })).toMatchObject({ reason: 'style-only + design scan + visual baselines', specs: [...config.design!.specs, ...VISUAL].toSorted() })
    })
  })

  it('still runs the mapped specs of a risk-area file', () => {
    const result = fast({ files: ['composables/useBoardDndKit.ts'] })
    expect(result.tier).toBe('fast')
    expect(result.specs).toEqual(expect.arrayContaining(['drag-and-drop', 'stack-motion', ...config.smoke]))
    expect(result.specs).not.toContain('design-detect')
  })

  // #456: the One Height Rule (#424) changed the button theme in app.config.ts; the fast gate ran visual-regression and the catalog fingerprint
  // only, and main went red on the specs that assert a button's height
  it('runs the specs that assert button heights for a change to app.config.ts, in fast mode', () => {
    const result = fast({ files: ['app.config.ts'] })
    expect(result.tier).toBe('fast')
    expect(result.specs).toEqual(expect.arrayContaining([...BUTTON_HEIGHT_SPECS, 'visual-regression', ...config.smoke]))
    expect(result.specs).not.toContain('design-detect')
  })

  // #399: PR 397 added the navigation wait bar to app.vue; its fast gate ran 19 specs and missed scrollbar-shift, which reads the bar as a moved element
  it('runs the layout-shift spec for the navigation wait bar files', () => {
    for (const file of ['app.vue', 'plugins/route-preload.client.ts']) {
      expect(fast({ files: [file] }).specs, file).toEqual(expect.arrayContaining(['scrollbar-shift', 'route-preload', 'statistics-page']))
    }
  })

  it('adds the touched specs, the helper importers and the E2E-specs line, and still flags unknown names', () => {
    const result = fast({ files: ['utils/middleEllipsis.ts', 'tests/e2e/a11y.spec.ts', 'tests/e2e/helpers/notionWizard.ts'], body: 'E2E-specs: trash nope' })
    expect(result.specs).toEqual(expect.arrayContaining(['a11y', 'trash', 'sources-settings', 'welcome-setup']))
    expect(result.unknown).toEqual(['nope'])
  })

  it('reports an unmapped file the same way quality does', () => {
    expect(fast({ files: ['utils/middleEllipsis.ts'] }).unmapped).toEqual(select({ files: ['utils/middleEllipsis.ts'] }).unmapped)
  })

  it('runs the fingerprint and the screenshots for a style-only PR, not the design scan (kd#230, #684)', () => {
    expect(fast({ files: ['assets/css/dnd.css'] }).specs).toEqual(['ui-catalog', ...VISUAL].sort())
    expect(fast({ files: ['components/a/B.vue'], styleOnlyVue: ['components/a/B.vue'] })).toMatchObject({ tier: 'targeted', specs: VISUAL })
    expect(fast({ files: ['tests/e2e/snapshots/visual-regression.spec.ts/board.png'] })).toMatchObject({ tier: 'targeted', specs: VISUAL })
    expect(fast({ files: ['components/a/B.vue', 'tests/e2e/a11y.spec.ts'], styleOnlyVue: ['components/a/B.vue'] }).specs).toEqual(['a11y', ...VISUAL].sort())
    expect(fast({ files: ['scripts/report.css'] })).toMatchObject({ tier: 'style', specs: [] })
    expect(fast({ files: ['tests/e2e/snapshots/ui-catalog/Board.json'], body: 'E2E-specs: a11y' })).toMatchObject({ tier: 'targeted', specs: ['a11y'] })
  })

  // #684: the fast tier dropped every non-risk rule, so board and task UI merged with stale baselines (#676, #682)
  describe('the screenshots in fast mode (#684)', () => {
    it('keeps visual-regression, and nothing else of a non-risk rule, for board, task, ui, layout, timer and css files', () => {
      for (const file of ['components/board/BoardColumn.vue', 'components/task/TaskCard.vue', 'components/ui/ResponsiveOverlay.vue', 'layouts/default.vue', 'pages/tasks.vue', 'lib/taskTimers.ts', 'app.vue', 'components/AppShell.vue', 'composables/useBoardPages.ts']) {
        const result = fast({ files: [file, 'tests/store/x.test.ts'] })
        expect(result.specs, file).toContain('visual-regression')
        expect(result.specs, file).not.toContain('done-drop') // the rest of the rule stays dropped
      }
      expect(fast({ files: ['utils/middleEllipsis.ts'] }).specs).not.toContain('visual-regression')
    })

    it('has the screenshots in the quality tier of the same files, as before', () => {
      expect(fast({ files: ['components/board/BoardColumn.vue'], mode: 'quality' }).specs).toContain('visual-regression')
    })

    it('flags every non-risk map rule that lists visual-regression with fast, so a new rule cannot drop it again', () => {
      const rules = config.map.filter(rule => rule.specs.includes('visual-regression') && !rule.risk)
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) expect(rule.fast, rule.paths.join(' ')).toContain('visual-regression')
      for (const rule of config.map) for (const name of rule.fast ?? []) expect(rule.specs, rule.paths.join(' ')).toContain(name)
    })
  })

  it('keeps docs-only skip, E2E_GATE=full and the unresolved-list fallback', () => {
    expect(fast({ files: ['docs/a.md'] }).tier).toBe('skip')
    expect(fast({ files: ['utils/middleEllipsis.ts'], env: { E2E_GATE: 'full' } }).tier).toBe('full')
    expect(selectE2e({ files: null, config, existingSpecs, mode: 'fast' }).tier).toBe('full')
  })

  it('reads a missing or unknown mode as quality', () => {
    for (const mode of [undefined, '', 'Fast', 'turbo']) {
      expect(fast({ files: ['components/settings/DataBackupList.vue'], mode }).tier, String(mode)).toBe('targeted')
    }
  })

  it('treats the gate\'s own files as a risk area, so a gate change keeps its mapped specs', () => {
    expect(fast({ files: ['scripts/e2e-gate.mjs'] }).specs).toEqual(expect.arrayContaining(['drag-sync', 'data-settings', 'timer-lifecycle']))
  })

  it('builds the release fast tier from smoke and the risk-area rules', () => {
    const specs = fastReleaseSpecs(config, existingSpecs)
    expect(specs).toEqual(expect.arrayContaining([...config.smoke, 'drag-sync', 'visual-regression']))
    expect(specs).not.toContain('design-detect')
    expect(specs.length).toBeLessThan(existingSpecs.length)
    expect(specs).toEqual([...specs].sort())
    expect(fastReleaseSpecs({ smoke: ['a'], map: [{ specs: ['b'], risk: true }, { specs: ['c'] }] }, ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })
})

describe('risk flags in e2e-gate.json (#693)', () => {
  const flagged = (config.map as { risk?: boolean, paths: string[] }[]).filter(rule => rule.risk)
  const covers = (file: string) => flagged.some(rule => rule.paths.some(glob => matchesGlob(file, glob)))

  it('flags the profile risk areas: stores, sync, integrations, server routes, drag-and-drop, persistence, snapshots, the gate', () => {
    for (const file of [
      'store/tasks.ts', 'composables/useTaskSync.ts', 'integrations/NotionIntegration.ts', 'server/api/notion/tasks.get.ts', 'composables/useBoardDndKit.ts',
      'lib/dataStorage.ts', 'src-tauri/src/data_file.rs', 'tests/e2e/snapshots/x.png', 'scripts/e2e-gate.mjs', '.claude/hooks/e2e-gate.json',
    ]) expect(covers(file), file).toBe(true)
  })

  it('leaves page and component areas unflagged', () => {
    for (const file of ['components/trash/TrashList.vue', 'composables/useTopicEditor.ts', 'pages/settings/index.vue']) expect(covers(file), file).toBe(false)
  })
})

describe('isStyleOnlyVue', () => {
  const base = sfc('  <div class="a">x</div>', 'const n = 1', '.a { color: red; }')

  it('accepts changes inside the <style> block, including a new rule and a changed tag', () => {
    expect(isStyleOnlyVue(base, sfc('  <div class="a">x</div>', 'const n = 1', '.a { color: blue; }\n.b { margin: 0; }'))).toBe(true)
    expect(isStyleOnlyVue(base, base.replace('<style scoped>', '<style scoped lang="scss">'))).toBe(true)
  })

  it('rejects a comment-only edit in <script> or <template> (accepted false negative)', () => {
    expect(isStyleOnlyVue(base, base.replace('const n = 1', '// note\nconst n = 1'))).toBe(false)
    expect(isStyleOnlyVue(base, base.replace('const n = 1', '/* note */\nconst n = 1'))).toBe(false)
    expect(isStyleOnlyVue(base, base.replace('<div class="a">', '<!-- note -->\n  <div class="a">'))).toBe(false)
  })

  it('rejects a <template> change', () => {
    expect(isStyleOnlyVue(base, sfc('  <div class="a b">x</div>', 'const n = 1', '.a { color: red; }'))).toBe(false)
  })

  it('rejects a <script> change, also next to a style change', () => {
    expect(isStyleOnlyVue(base, sfc('  <div class="a">x</div>', 'const n = 2', '.a { color: blue; }'))).toBe(false)
  })

  it('rejects a comment that shares its line with code, and code turned into a comment', () => {
    expect(isStyleOnlyVue(base, base.replace('const n = 1', 'const n = 1 // now two'))).toBe(false)
    expect(isStyleOnlyVue(base, base.replace('const n = 1', '// const n = 1'))).toBe(false)
  })

  it('does not hide template-literal lines behind a block comment or an odd backtick', () => {
    const script = (body: string) => sfc('  <div>x</div>', `${body}\nconst z = \``, '')
    expect(isStyleOnlyVue(script('/* x */ const s = `\n// a\n`'), script('/* x */ const s = `\n// b\n`'))).toBe(false)
    expect(isStyleOnlyVue(script('const q = \'`\'\nconst s = `\n// a\n`'), script('const q = \'`\'\nconst s = `\n// b\n`'))).toBe(false)
  })

  it('falls back to not style-only when a style or script tag does not start its line', () => {
    const inline = (css: string) => `<template><style>${css}</style></template>\n<script setup>const n = 1</script>\n`
    expect(isStyleOnlyVue(inline('.a{}'), inline('.b{}'))).toBe(false)
    const oneLine = (n: number) => `<template><div>x</div></template><script setup lang="ts">const n = ${n}</script>\n<style>.a{}</style>\n`
    expect(isStyleOnlyVue(oneLine(1), oneLine(2))).toBe(false)
    const openTail = (n: number) => `<style>.a { color: red; }\n</style>\n<template><b>${n}</b></template>\n`
    expect(isStyleOnlyVue(openTail(1), openTail(2))).toBe(false)
    const tail = (n: number) => `<style>\n.a {}\n</style><template><b>${n}</b></template>\n`
    expect(isStyleOnlyVue(tail(1), tail(2))).toBe(false)
    const sameLine = (n: number) => `<style>.a {}</style><template><b>${n}</b></template>\n`
    expect(isStyleOnlyVue(sameLine(1), sameLine(2))).toBe(false)
  })

  it('rejects an added file with markup and accepts an added file with a style block only', () => {
    expect(isStyleOnlyVue('', base)).toBe(false)
    expect(isStyleOnlyVue('', '<style>\n.a {}\n</style>\n')).toBe(true)
  })
})

describe('vueStyleJudge (diff against the merge base)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kando-gate-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()
  const base = sfc('  <div>x</div>', 'const n = 1', '.a { color: red; }')
  const commit = (file: string, text: string, message: string) => {
    mkdirSync(join(dir, 'components'), { recursive: true })
    writeFileSync(join(dir, file), text)
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  it('compares the head with the merge base, not with the tip of the base branch', () => {
    git('init', '-q', '-b', 'main')
    commit('components/A.vue', base, 'base')
    commit('components/B.vue', base, 'b')
    git('checkout', '-q', '-b', 'pr', 'HEAD~1')
    commit('components/A.vue', base.replace('red', 'blue'), 'style')
    const styleHead = git('rev-parse', 'HEAD')
    commit('components/B.vue', base.replace('const n = 1', 'const n = 2'), 'script')
    const scriptHead = git('rev-parse', 'HEAD')
    git('checkout', '-q', 'main')
    commit('components/C.vue', base, 'main moves on') // not part of the PR

    const atStyle = vueStyleJudge('main', styleHead, dir)
    expect(atStyle('components/A.vue').styleOnly).toBe(true)
    const atScript = vueStyleJudge('main', scriptHead, dir)
    expect(atScript('components/A.vue').styleOnly).toBe(true)
    expect(atScript('components/B.vue').styleOnly).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers "not style-only" and failed when git cannot tell', () => {
    expect(vueStyleJudge('no-such-branch', 'HEAD', root)('components/Board.vue')).toEqual({ styleOnly: false, failed: true })
    expect(vueStyleJudge('HEAD', '0123456789012345678901234567890123456789', root)('components/Board.vue')).toEqual({ styleOnly: false, failed: true })
  })

  it('does not call an absent file a failure', () => {
    expect(vueStyleJudge('HEAD', 'HEAD', root)('components/NoSuchFile.vue')).toEqual({ styleOnly: true, failed: false })
  })
})

describe('selectE2e with an unreadable .vue side (#380)', () => {
  const judge = (file: string) => ({ styleOnly: false, failed: file === 'components/Board.vue' })
  const input = { config, existingSpecs, isStyleOnlyVueFile: judge }

  it('names the file whose judgement failed and keeps the tier non-style', () => {
    const result = selectE2e({ ...input, files: ['components/Board.vue'] })
    expect(result.tier).not.toBe('style')
    expect(result.reason).toContain('style judge failed: components/Board.vue')
  })

  it('does not blame the judge for a tier caused by something else', () => {
    expect(selectE2e({ ...input, files: ['components/settings/DataBackupList.vue'] }).reason).toBe('smoke + mapped + touched specs')
    expect(selectE2e({ ...input, files: ['components/task/TaskStack.vue'] }).reason).toBe('smoke + mapped + touched specs')
  })
})

describe('bodySpecNames and parsePr', () => {
  it('reads basenames from E2E-specs lines, tolerating commas, backticks and paths', () => {
    expect(bodySpecNames('x\nE2E-specs: a, `b` tests/e2e/c.spec.ts\n  e2e-specs: d')).toEqual(['a', 'b', 'c', 'd'])
    expect(bodySpecNames('no line here')).toEqual([])
    expect(bodySpecNames(undefined)).toEqual([])
  })

  it('reads a line that starts with the literal none as naming no spec', () => {
    expect(bodySpecNames('E2E-specs: none')).toEqual([])
    expect(bodySpecNames('E2E-specs: None (infrastructure only; gate unit tests)')).toEqual([])
    expect(bodySpecNames('E2E-specs: none\nE2E-specs: a b')).toEqual(['a', 'b'])
    expect(bodySpecNames('E2E-specs: a none')).toEqual(['a', 'none']) // only a leading none is the empty marker
    expect(select({ body: 'E2E-specs: none (nothing at risk)' }).unknown).toEqual([])
  })

  it('normalises the gh JSON and treats a missing file list as unresolved', () => {
    expect(parsePr({ files: [{ path: 'a.ts' }], body: 'b', baseRefName: 'dev', headRefOid: 'abc' }))
      .toEqual({ files: ['a.ts'], body: 'b', baseRefName: 'dev', headRefOid: 'abc' })
    expect(parsePr({})).toEqual({ files: null, body: '', baseRefName: 'main', headRefOid: 'HEAD' })
    expect(parsePr(undefined).files).toBeNull()
  })
})

describe('stamps and run arguments', () => {
  it('derives an order-independent 12 hex key', () => {
    expect(stampKey(['b', 'a', 'c'])).toBe(stampKey(['c', 'a', 'b']))
    expect(stampKey(['a', 'b'])).not.toBe(stampKey(['a', 'b', 'c']))
    expect(stampKey(['a'])).toMatch(/^[0-9a-f]{12}$/)
  })

  it('lets a full stamp satisfy any tier and a targeted stamp only its own list', () => {
    const full = stampPath('/repo/.git', 'abc', 'full')
    expect(full).toBe('/repo/.git/kando-e2e-pass/abc.full')
    expect(satisfyingStamps('/repo/.git', 'abc', 'full')).toEqual([full])
    expect(satisfyingStamps('/repo/.git', 'abc', 'deadbeef0000')).toEqual([full, '/repo/.git/kando-e2e-pass/abc.deadbeef0000'])
  })

  it('retries once and halves the workers only under load', () => {
    expect(e2eArgs()).toEqual(['--reporter=line', '--retries=1'])
    expect(e2eArgs({ files: ['tests/e2e/a.spec.ts'], load: 4, cpus: 10 })).toEqual(['--reporter=line', '--retries=1', 'tests/e2e/a.spec.ts'])
    expect(e2eArgs({ load: 12, cpus: 10 })).toEqual(['--reporter=line', '--retries=1', '--workers=2'])
  })

  it('reads the failing and flaky counts of a line reporter log', () => {
    const log = [
      'Running 5 tests using 2 workers',
      '  1) [chromium] › tests/e2e/a.spec.ts:10:3 › breaks',
      '  1 failed',
      '    [chromium] › tests/e2e/a.spec.ts:10:3 › breaks',
      '  1 flaky',
      '    [chromium] › tests/e2e/b.spec.ts:5:3 › sometimes',
      '  3 passed (10.0s)',
    ].join('\n')
    expect(parseSummary(log)).toEqual({ failed: 1, flaky: ['[chromium] › tests/e2e/b.spec.ts:5:3 › sometimes'] })
    expect(parseSummary('  5 passed (3s)')).toEqual({ failed: 0, flaky: [] })
  })

  it('lets the version files be dirty after the release E2E run but nothing else', () => {
    const files = ['package.json', 'src-tauri/Cargo.toml']
    expect(dirtyOutside(' M package.json\n M src-tauri/Cargo.toml\n', files)).toEqual([])
    expect(dirtyOutside(' M package.json\n?? tests/e2e/test-results/x\n', files)).toEqual(['?? tests/e2e/test-results/x'])
    expect(dirtyOutside('', files)).toEqual([])
  })

  it('words the release refusal with the failing count', () => {
    expect(e2eRefusal({ failed: 3, code: 1 })).toBe('Release refused: the full E2E suite failed (3 failing); nothing was committed, pushed or uploaded')
    expect(e2eRefusal({ failed: 0, code: 137 })).toContain('exit 137')
  })

  it('asks the OS for a free port', async () => {
    expect(await findFreePort()).toBeGreaterThan(0)
  })
})

describe('progress of a gate run (#830)', () => {
  const begin = (counts: Record<string, number>) => JSON.stringify({ begin: counts })
  const ok = (spec: string, id: string) => JSON.stringify({ ok: spec, id })

  it('counts a spec file as passed only when every test of it ended as expected', () => {
    const text = [begin({ a: 2, b: 1, c: 1 }), ok('a', 'a1'), ok('b', 'b1'), ok('a', 'a1')].join('\n')
    expect(parseProgress(text)).toEqual(['b']) // a: the same test twice is still one of two
    expect(parseProgress(`${text}\n${ok('a', 'a2')}\n`)).toEqual(['a', 'b'])
  })

  it('ignores a line cut off by a killed run, other shapes, and specs without a count', () => {
    const text = [begin({ a: 1 }), ok('a', 'a1'), ok('x', 'x1'), '{"ok":"b","id":', 'not json', '{"begin":{"z":0}}', ok('z', 'z1'), '{"ok":1,"id":2}'].join('\n')
    expect(parseProgress(text)).toEqual(['a'])
    expect(parseProgress('')).toEqual([])
  })

  it('keeps the counts of an earlier run when a resumed run begins with the rest only', () => {
    const text = [begin({ a: 1, b: 2 }), ok('a', 'a1'), ok('b', 'b1'), begin({ b: 2 }), ok('b', 'b2')].join('\n')
    expect(parseProgress(text)).toEqual(['a', 'b'])
  })

  const decision = { specs: ['a', 'b', 'c'], args: ['--reporter=line', '--retries=1', '--workers=2', 'tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts', 'tests/e2e/c.spec.ts'] }

  it('runs only the spec files that have not passed, with the decision\'s flags and the progress reporter', () => {
    expect(resumeArgs(decision, ['b', 'zz'], '/r/rep.mjs')).toEqual({
      done: ['b'],
      rest: ['a', 'c'],
      args: ['--reporter=line,/r/rep.mjs', '--retries=1', '--workers=2', 'tests/e2e/a.spec.ts', 'tests/e2e/c.spec.ts'],
    })
  })

  it('keeps the decision\'s own args without progress, also the whole suite of a full tier', () => {
    expect(resumeArgs(decision, [], '/r/rep.mjs').args).toEqual(['--reporter=line,/r/rep.mjs', ...decision.args.slice(1)])
    expect(resumeArgs(decision, []).args).toEqual(decision.args)
    const full = { specs: ['a', 'b'], args: ['--reporter=line', '--retries=1'] }
    expect(resumeArgs(full, []).args).toEqual(['--reporter=line', '--retries=1'])
    expect(resumeArgs(full, ['a']).args).toEqual(['--reporter=line', '--retries=1', 'tests/e2e/b.spec.ts'])
  })

  it('leaves nothing to run when every spec file passed (the hook must not start the whole suite then)', () => {
    expect(resumeArgs(decision, ['a', 'b', 'c'])).toMatchObject({ done: ['a', 'b', 'c'], rest: [] })
  })

  it('CLI: reads the decision from stdin and a missing progress file as none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-gate-progress-'))
    const cli = (file: string) => JSON.parse(execFileSync('node', [resolve(root, 'scripts/e2e-gate.mjs'), 'run-args', file, '/r/rep.mjs'], { input: JSON.stringify(decision), encoding: 'utf8' }))
    expect(cli(join(dir, 'none.progress'))).toMatchObject({ done: [], rest: ['a', 'b', 'c'] })
    writeFileSync(join(dir, 'x.progress'), [begin({ a: 1, b: 1 }), ok('a', 'a1')].join('\n'))
    expect(cli(join(dir, 'x.progress'))).toMatchObject({ done: ['a'], rest: ['b', 'c'] })
    rmSync(dir, { recursive: true })
  })

  describe('the reporter', () => {
    const test = (file: string, expectedStatus = 'passed') => ({ id: `${file}-1`, location: { file }, expectedStatus })
    const record = (events: (r: InstanceType<typeof GateProgressReporter>) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'kando-gate-reporter-'))
      const out = join(dir, 'p.progress')
      process.env.E2E_GATE_PROGRESS = out
      try {
        events(new GateProgressReporter())
      } finally {
        delete process.env.E2E_GATE_PROGRESS
      }
      const text = (() => {
        try {
          return readFileSync(out, 'utf8')
        } catch {
          return ''
        }
      })()
      rmSync(dir, { recursive: true })
      return text
    }

    it('writes the counts per spec file and each attempt that ended as expected', () => {
      const text = record((r) => {
        r.onBegin({}, { allTests: () => [test('/w/tests/e2e/a.spec.ts'), test('/w/tests/e2e/a.spec.ts'), test('/w/tests/e2e/b.spec.ts')] })
        r.onTestEnd(test('/w/tests/e2e/a.spec.ts'), { status: 'failed' }) // a retry follows
        r.onTestEnd(test('/w/tests/e2e/a.spec.ts'), { status: 'passed' })
        r.onTestEnd(test('/w/tests/e2e/b.spec.ts'), { status: 'interrupted' }) // killed by the watchdog
        r.onTestEnd(test('/w/tests/e2e/b.spec.ts'), { status: 'skipped' }) // did not run after a serial failure
        r.onTestEnd(test('/w/tests/e2e/b.spec.ts', 'skipped'), { status: 'skipped' }) // test.skip()
        r.onTestEnd(test('/w/tests/e2e/b.spec.ts', 'failed'), { status: 'failed' }) // test.fail()
      })
      expect(text.trim().split('\n').map(line => JSON.parse(line))).toEqual([
        { begin: { a: 2, b: 1 } },
        { ok: 'a', id: '/w/tests/e2e/a.spec.ts-1' },
        { ok: 'b', id: '/w/tests/e2e/b.spec.ts-1' },
        { ok: 'b', id: '/w/tests/e2e/b.spec.ts-1' },
      ])
    })

    it('records nothing without E2E_GATE_PROGRESS and prints nothing', () => {
      const r = new GateProgressReporter()
      expect(r.printsToStdio()).toBe(false)
      expect(() => r.onBegin({}, { allTests: () => [test('/w/a.spec.ts')] })).not.toThrow()
    })
  })
})

describe('gate CLI', () => {
  const run = (input: unknown, mode = 'quality') => JSON.parse(
    execFileSync('node', [resolve(root, 'scripts/e2e-gate.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, E2E_GATE: '', KANDO_TESTING_MODE: mode } }),
  ) as { tier: string, args: string[], specs: string[], byText: string[], reason: string, mode: string }

  it('takes the gh JSON on stdin and prints the decision with the Playwright arguments', () => {
    const targeted = run({ files: [{ path: 'composables/useDataFolder.ts' }], body: '' })
    expect(targeted.tier).toBe('targeted')
    expect(targeted.args.slice(0, 2)).toEqual(['--reporter=line', '--retries=1'])
    expect(targeted.args).toContain('tests/e2e/data-settings.spec.ts')
  })

  it('runs the mapped spec files for a risk area, not the whole suite, and nothing for docs', () => {
    const risk = run({ files: [{ path: 'store/tasks.ts' }], body: '' })
    expect(risk.tier).toBe('targeted')
    const specFiles = risk.args.filter(arg => arg.endsWith('.spec.ts'))
    expect(specFiles).toContain('tests/e2e/drag-sync.spec.ts')
    expect(specFiles.length).toBeGreaterThan(0)
    expect(specFiles.length).toBeLessThan(existingSpecs.length)
    expect(run({ files: [{ path: 'docs/a.md' }], body: '' })).toMatchObject({ tier: 'skip', args: [] })
  })

  it('runs the importers of a changed helper, read from the checkout', () => {
    const result = run({ files: [{ path: 'tests/e2e/helpers/notionWizard.ts' }], body: '' })
    expect(result.args).toEqual(expect.arrayContaining(['tests/e2e/sources-settings.spec.ts', 'tests/e2e/welcome-setup.spec.ts']))
  })

  it('runs the whole suite (no spec files) only for E2E_GATE=full', () => {
    const full = JSON.parse(
      execFileSync('node', [resolve(root, 'scripts/e2e-gate.mjs')], { input: JSON.stringify({ files: [{ path: 'utils/middleEllipsis.ts' }] }), encoding: 'utf8', env: { ...process.env, E2E_GATE: 'full', KANDO_TESTING_MODE: 'fast' } }),
    ) as { tier: string, args: string[], specs: string[] }
    expect(full.tier).toBe('full')
    expect(full.args.filter(arg => arg.endsWith('.spec.ts'))).toEqual([])
    expect(full.specs).toEqual(existingSpecs)
  })

  it('runs only the design scan and the screenshots for a stylesheet-only PR, whatever the risk area says', () => {
    const specs = [...config.design!.specs, ...VISUAL].toSorted()
    const result = run({ files: [{ path: 'assets/css/dnd.css' }], body: '' })
    expect(result).toMatchObject({ tier: 'targeted', specs })
    expect(result.args.filter(arg => arg.endsWith('.spec.ts'))).toEqual(specs.map(name => `tests/e2e/${name}.spec.ts`))
  })

  it('runs only the touched specs for css plus a spec', () => {
    const result = run({ files: [{ path: 'assets/css/dnd.css' }, { path: 'tests/e2e/a11y.spec.ts' }], body: '' })
    expect(result.tier).toBe('targeted')
    expect(result.args.filter(arg => arg.endsWith('.spec.ts'))).toEqual(['a11y', ...config.design!.specs, ...VISUAL].toSorted().map(name => `tests/e2e/${name}.spec.ts`))
  })

  it('falls back to the full suite when gh gave nothing usable', () => {
    expect(run({}).tier).toBe('full')
  })

  it('reports the testing mode and tier fast in the decision (#693)', () => {
    const fast = run({ files: [{ path: 'composables/useBoardDndKit.ts' }], body: '' }, 'fast')
    expect(fast).toMatchObject({ tier: 'fast', mode: 'fast' })
    expect(fast.args.filter(arg => arg.endsWith('.spec.ts'))).toContain('tests/e2e/drag-and-drop.spec.ts')
    expect(run({ files: [{ path: 'composables/useBoardDndKit.ts' }], body: '' }, 'quality')).toMatchObject({ tier: 'targeted', mode: 'quality' })
    expect(run({ files: [{ path: 'composables/useBoardDndKit.ts' }], body: '' }, 'typo')).toMatchObject({ tier: 'targeted', mode: 'quality' })
    expect(run({ files: [{ path: 'docs/a.md' }] }, 'fast').tier).toBe('skip')
    expect(run({}, 'fast').tier).toBe('full')
  })

  // Wiring of the git reads (#525), replayed on the commit that caused the escape (#508). The spec text is today's,
  // so this proves the CLI reads the locale diff, not the historical miss (the unit test above does).
  const hasEvidenceCommit = (() => {
    try {
      execFileSync('git', ['cat-file', '-e', '3d7085b7479af1e6e1ee5fca68711356272631ee^{commit}'], { cwd: root, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hasEvidenceCommit)('selects the specs that name a changed label, read from the git diff of the PR head', () => {
    const result = run({ files: [{ path: 'i18n/locales/de.json' }], body: '', baseRefName: '3d7085b7479af1e6e1ee5fca68711356272631ee~1', headRefOid: '3d7085b7479af1e6e1ee5fca68711356272631ee' })
    expect(result.byText).toContain('source-icon-footer')
    expect(result.reason).toContain('label/testid match')
  }, 30_000)
})

describe('config guard', () => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)

  it('names only specs that exist in tests/e2e', () => {
    const named = [...config.smoke, ...config.map.flatMap(rule => rule.specs)]
    expect(named.filter(name => !existingSpecs.includes(name)), 'a renamed or deleted spec is still named in .claude/hooks/e2e-gate.json: rename or remove it in "smoke" and in every "specs" list').toEqual([])
  })

  it('has no duplicate smoke entry and the agreed seven', () => {
    expect(config.smoke).toEqual(['smoke', 'drag-and-drop', 'task-detail', 'notion-stub-sync', 'data-safety', 'completion-undo', 'source-failure'])
  })

  // Matches every map glob against every tracked file: past the 5 s default under parallel-worker load (#520).
  it('has no full list and a tracked file behind every map glob', () => {
    expect(config).not.toHaveProperty('full')
    const globs = config.map.flatMap(rule => rule.paths)
    expect(globs.filter(glob => !tracked.some(file => matchesGlob(file, glob)))).toEqual([])
  }, 30_000)

  it('maps every file of the former full areas to at least one rule (an unmapped file would run smoke only)', () => {
    const isTest = (file: string) => file.endsWith('.md') || /(^|\/)(__tests__|tests)\//.test(file) || /\.(test|spec)\.ts$/.test(file) || file.endsWith('tests_cloud.rs') || file.endsWith('tests_safety.rs')
    const areas = tracked.filter(file => !isTest(file) && /^(store\/|integrations\/|server\/(api|middleware|utils)\/|utils\/dataFile\/|src-tauri\/src\/|types\/(store\/|(dataFile|task|taskSource|taskPosition|state|pendingTimeUpdate)\.ts)|lib\/(dataStorage|dataBackendTauri|dataStatus|secrets|taskSources|taskDates|integrationHealth)|plugins\/(00\.data-storage|pinia|e2e-seed|secrets))/.test(file))
    expect(areas.length).toBeGreaterThan(40)
    expect(areas.filter(file => !config.map.some(rule => rule.paths.some(glob => matchesGlob(file, glob))))).toEqual([])
  })
})

describe('mapping coverage guard (review of #447, M2)', () => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
  const smoke = new Set(config.smoke)
  /** Files that deliberately map to no spec beyond smoke, each with its reason. */
  const NO_SPEC: Record<string, string> = {
    'types/globals.d.ts': 'ambient declarations, typecheck is the check',
    'types/pinia-persist.d.ts': 'ambient declarations, typecheck is the check',
  }
  const sourceFiles = tracked.filter(file => /^(components|composables|lib|pages|utils|plugins|layouts|types)\//.test(file) && !/\.sw[a-p]$/.test(file))
  const specsBeyondSmoke = (file: string) => config.map.filter(rule => rule.paths.some(glob => matchesGlob(file, glob))).flatMap(rule => rule.specs).filter(name => !smoke.has(name))

  it('finds the source files to guard', () => {
    expect(sourceFiles.length).toBeGreaterThan(250)
  })

  it('maps every source file of components/, composables/, lib/, pages/, utils/, plugins/, layouts/ and types/ to a spec beyond smoke', () => {
    const unmapped = sourceFiles.filter(file => !(file in NO_SPEC) && specsBeyondSmoke(file).length === 0)
    expect(unmapped, 'new source files need a map rule in .claude/hooks/e2e-gate.json (the area and the specs that exercise them)').toEqual([])
  })

  it('keeps the allow-list short and live: every entry exists and really maps to nothing', () => {
    expect(Object.keys(NO_SPEC).length).toBeLessThanOrEqual(5)
    for (const file of Object.keys(NO_SPEC)) {
      expect(sourceFiles, file).toContain(file)
      expect(specsBeyondSmoke(file), file).toEqual([])
    }
  })

  it('has at least one importing spec for every helper below tests/e2e/helpers', () => {
    const helpers = Object.keys(e2eSources).filter(path => path.startsWith('tests/e2e/helpers/'))
    expect(helpers.length).toBeGreaterThan(0)
    for (const helper of helpers) expect(specsImportingHelpers([helper], e2eSources), helper).not.toEqual([])
  })
})

// #493: the app shell (app bar, Mehr panel, layouts, app.vue) sets the geometry every phone-width and drag spec depends on.
// Two specs only failed in an E2E_GATE=full run of #489 because the shell files mapped to a narrow set, and #475 changed
// useArchiveDoneTasks.ts without running the spec that clicked its old undo.
describe('app shell and archive mappings (#493)', () => {
  const smoke = new Set(config.smoke)
  const specsFor = (file: string) => new Set(select({ files: [file, 'tests/store/tasks.test.ts'] }).specs)
  const SHELL_FILES = ['app.vue', 'layouts/sub-page.vue', 'components/nav/AppNav.vue', 'components/nav/MorePanel.vue', 'composables/useNavIndicator.ts', 'lib/navSpring.ts', 'assets/css/app-nav.css']
  /** Specs that mention a 390px viewport but never assert shell geometry: `desktop-pages-shots` self-skips without DESKTOP_SHOTS_DIR; `ui-shell` (#65) and `ui-catalog` (#66) drive the dev-only `/ui` page, which has no app bar. */
  // reminders-setup: its 390px case asserts the setup's own progress bar and 44px targets, not the app shell (the welcome page has no bar)
  const NO_PHONE_ASSERTIONS = new Set(['desktop-pages-shots', 'ui-shell', 'ui-catalog', 'reminders-setup'])
  const phoneSpecs = existingSpecs.filter(name => /\b390\b/.test(e2eSources[`tests/e2e/${name}.spec.ts`] ?? '') && !NO_PHONE_ASSERTIONS.has(name))
  const dndSpecs = config.map.find(rule => rule.paths.includes('composables/useBoardDndKit.ts'))?.specs ?? []
  /** The failure names the fix (kd#215): `.claude/rules/e2e.md` loads only once a file under tests/e2e is read, which is after a new spec was written. */
  const SHELL_FIX = 'a spec that names a 390 viewport (or belongs to the DnD spec set) must run when the app shell changes: add its name to the "specs" of the app-shell rule in .claude/hooks/e2e-gate.json (the rule whose "paths" hold app.vue and components/nav/**), or move the test into a spec that rule already lists; a spec that mentions 390 without asserting shell geometry goes into NO_PHONE_ASSERTIONS in this file with its reason'

  it('finds the specs to guard', () => {
    expect(phoneSpecs).toEqual(expect.arrayContaining(['archive-feature', 'mobile-app-bar', 'stack-mobile']))
    expect(dndSpecs).toEqual(expect.arrayContaining(['dnd-open-column-gap', 'stack-dnd']))
  })

  it.each(SHELL_FILES)('runs every spec with a 390px viewport and the whole DnD spec set when %s changes', (file) => {
    const specs = specsFor(file)
    expect([...phoneSpecs, ...dndSpecs].filter(name => !specs.has(name)), SHELL_FIX).toEqual([])
    for (const name of ['archive-feature', 'dnd-open-column-gap']) expect(specs.has(name), name).toBe(true)
  })

  it('names the reason in the area of the shell rule', () => {
    const rule = config.map.find(entry => entry.paths.includes('app.vue') && entry.paths.includes('components/nav/**')) as { area?: string } | undefined
    expect(rule?.area).toMatch(/390px/)
    expect(rule?.area).toMatch(/drag/i)
  })

  it('maps useArchiveDoneTasks.ts to archive-feature and mixed-board-features', () => {
    const specs = specsFor('composables/useArchiveDoneTasks.ts')
    for (const name of ['archive-feature', 'mixed-board-features', 'day-close', 'new-day-recap']) expect(specs.has(name), name).toBe(true)
    // the shell set is not dragged in by it
    expect(specs.has('app-nav')).toBe(false)
    expect(smoke.has('mixed-board-features')).toBe(false)
  })
})

describe('persisted-data coverage guard', () => {
  // Every file that hydrates or persists state must run E2E: at least a mapped spec set.
  const persistedApi = /appStorage|PERSISTED_KEYS|afterHydrate|\bpersist\b|localStorage/
  const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'lib', 'plugins', 'utils', 'types'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(file => /\.(ts|mjs|vue)$/.test(file) && !/\.d\.m?ts$/.test(file))
  const users = sources.filter(file => persistedApi.test(readFileSync(resolve(root, file), 'utf8')))

  it('finds the persistence users to guard', () => {
    expect(users).toEqual(expect.arrayContaining(['lib/dataStorage.ts', 'plugins/pinia.ts', 'plugins/e2e-seed.client.ts']))
  })

  it('maps every lib/, plugins/, utils/ and types/ file using the persistence APIs to a spec set', () => {
    const unguarded = users.filter((file) => {
      return select({ files: [file] }).unmapped.length > 0
    })
    expect(unguarded).toEqual([])
  })

  it.each([
    'types/task.ts', 'types/state.ts', 'types/taskSource.ts', 'types/pendingTimeUpdate.ts', 'lib/dataBackendTauri.ts', 'lib/dataStatus.ts',
    'plugins/00.data-storage.client.ts', 'plugins/e2e-seed.client.ts', 'utils/mapHelpers.ts', 'lib/secrets.ts', 'lib/taskSources.ts', 'lib/taskDates.ts',
  ])('maps %s to related specs beyond smoke', (file) => {
    const result = select({ files: [file] })
    expect(result.tier).toBe('targeted')
    expect(result.specs.length).toBeGreaterThan(config.smoke.length)
  })

  it('runs board specs for pages/tasks.vue', () => {
    const result = select({ files: ['pages/tasks.vue'] })
    expect(result.unmapped).toEqual([])
    expect(result.specs).toContain('sorting')
  })
})

describe('label and testid selection (#525)', () => {
  // The spec text of source-icon-footer as it stood when #508 broke it (before #521): it names the group by its
  // label, two option labels and a button count, but not the new "Aktivität" option.
  const SOURCES: Record<string, string> = {
    'tests/e2e/source-icon-footer.spec.ts': [
      "import { openMore } from './helpers/appNav'",
      "const options = (await openMore(page)).getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')",
      "await expect(options.nth(0)).toHaveText('Thema')",
      "await expect(options.nth(1)).toHaveText('Priorität')",
      "await expect(panel.getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')).toHaveCount(3)",
    ].join('\n'),
    'tests/e2e/other.spec.ts': "await page.getByTestId('source-row-notion').click()\nawait expect(page.getByText('Etwas anderes')).toBeVisible()",
    'tests/e2e/helperuser.spec.ts': "import { chip } from './helpers/chips'\nawait chip(page)",
    'tests/e2e/helpers/chips.ts': "export const chip = (page) => page.getByTestId('timebox-chip-value')",
    'tests/e2e/unrelated.spec.ts': "await page.getByText('Ganz anderer Text').click()",
  }

  describe('localeStrings', () => {
    it('adds the sibling values of an added key (the #508 diff)', () => {
      const before = { nav: { grouping: { priority: 'Priorität', topic: 'Thema' }, groupBy: 'Gruppieren nach' } }
      const after = { nav: { grouping: { activity: 'Aktivität', priority: 'Priorität', topic: 'Thema' }, groupBy: 'Gruppieren nach' } }
      expect(localeStrings(before, after)).toEqual(['Priorität', 'Thema'])
    })

    it('contributes the old value of a changed key, not its siblings', () => {
      expect(localeStrings({ a: { x: 'Alt', y: 'Nachbar' } }, { a: { x: 'Neu', y: 'Nachbar' } })).toEqual(['Alt'])
    })

    it('contributes the old value and the siblings of a removed key, and every value of a removed object', () => {
      expect(localeStrings({ a: { x: 'Weg', y: 'Nachbar' } }, { a: { y: 'Nachbar' } })).toEqual(['Nachbar', 'Weg'])
      expect(localeStrings({ a: { b: { x: 'Eins', y: 'Zwei' } } }, { a: {} })).toEqual(['Eins', 'Zwei'])
    })

    it('treats an absent file as empty and ignores identical files', () => {
      expect(localeStrings({}, { a: { x: 'Neu' } })).toEqual([])
      expect(localeStrings({ a: { x: 'Gleich' } }, { a: { x: 'Gleich' } })).toEqual([])
    })

    it('splits placeholders and plural bars and drops fragments shorter than 3 characters', () => {
      expect(localeStrings({ a: { x: '{source}-Verbindung reparieren', y: 'Ja | Nein, danke', z: '{n}' } }, {})).toEqual(['-Verbindung reparieren', 'Nein, danke']) // still a substring of "Notion-Verbindung reparieren"
    })
  })

  describe('testIdStrings', () => {
    it('reads added and removed static ids, template literals by their prefix, and object keys', () => {
      const diff = [
        'diff --git a/components/X.vue b/components/X.vue', '--- a/components/X.vue', '+++ b/components/X.vue', '@@ -1,2 +1,2 @@',
        '-  <p data-testid="data-folder-target">x</p>',
        '+  <p data-testid="data-folder-chosen">x</p>',
        '+  <li :data-testid="`source-row-${row.id}`">',
        "+  const attrs = { 'data-testid': 'chip-value' }",
        '+  <i data-testid="abc">',
        '   <b data-testid="context-line">',
      ].join('\n')
      expect(testIdStrings(diff)).toEqual(['chip-value', 'data-folder-chosen', 'data-folder-target', 'source-row-'])
    })

    it('ignores diff headers, an id that is fully dynamic and a bound variable', () => {
      expect(testIdStrings('+++ b/data-testid="header-only"\n+  <i :data-testid="`${id}`">')).toEqual([])
      expect(testIdStrings('+  <i :data-testid="testId">\n+  <i :data-testid="props.testId">')).toEqual([])
      expect(testIdStrings('+  <i :data-testid="\'chip-\' + id">')).toEqual(['chip-'])
      expect(testIdStrings('+  <i :data-testid="state === \'rejected\' ? \'github-token-rejected\' : \'github-token-empty\'">')).toEqual(['github-token-empty', 'github-token-rejected', 'rejected']) // a compared literal is taken too: over-selecting is the safe side
      expect(testIdStrings('+  <i :data-testid="testId ?? \'default-id\'">')).toEqual(['default-id'])
      expect(testIdStrings('+  <i :data-testid="open ? `chip-${id}` : \'chip-done\'">')).toEqual(['chip-', 'chip-done'])
    })
  })

  describe('specsMentioning', () => {
    it('finds the specs that contain a string, directly or through an imported helper', () => {
      expect(specsMentioning(['Thema'], SOURCES)).toEqual(['source-icon-footer'])
      expect(specsMentioning(['source-row-'], SOURCES)).toEqual(['other'])
      expect(specsMentioning(['timebox-chip-value'], SOURCES)).toEqual(['helperuser'])
    })

    it('finds nothing for an unknown string or an empty list', () => {
      expect(specsMentioning(['Aktivität'], SOURCES)).toEqual([])
      expect(specsMentioning([], SOURCES)).toEqual([])
    })
  })

  describe('selectE2e', () => {
    // No rule names utils/groupingOptions.ts: the mapping #521 added by hand is exactly what must not be needed.
    const bareConfig = { smoke: ['smoke'], map: [] }
    const specsByText = ['smoke', 'source-icon-footer', 'other', 'helperuser', 'unrelated']
    const decide = (files: string[], strings: string[], failed: string[] = [], extra: object = {}) => selectE2e({
      files, config: bareConfig, existingSpecs: specsByText,
      changedStrings: () => ({ strings, failed }),
      specsMentioning: found => specsMentioning(found, SOURCES),
      ...extra,
    })

    it('selects source-icon-footer for the #508 diff without any path rule for the changed file', () => {
      const strings = localeStrings(
        { nav: { grouping: { priority: 'Priorität', topic: 'Thema' } } },
        { nav: { grouping: { activity: 'Aktivität', priority: 'Priorität', topic: 'Thema' } } },
      )
      const result = decide(['utils/groupingOptions.ts', 'i18n/locales/de.json', 'tests/utils/groupingOptions.test.ts'], strings)
      expect(result.specs).toContain('source-icon-footer')
      expect(result.byText).toEqual(['source-icon-footer'])
      expect(result.reason).toBe('smoke + mapped + touched specs + label/testid match')
    })

    it('selects nothing extra when no spec names the changed strings', () => {
      const result = decide(['i18n/locales/de.json'], ['Kein Treffer'])
      expect(result).toMatchObject({ specs: ['smoke'], byText: [], reason: 'smoke + mapped + touched specs' })
    })

    it('does not pick a spec that only contains an unrelated value', () => {
      expect(decide(['i18n/locales/de.json'], ['Thema']).specs).not.toContain('unrelated')
    })

    it('names a file whose diff git could not read and adds nothing for it', () => {
      const result = decide(['i18n/locales/de.json'], [], ['i18n/locales/de.json'])
      expect(result.specs).toEqual(['smoke'])
      expect(result.reason).toContain('text judge failed: i18n/locales/de.json')
    })

    it('keeps a style-only PR at tier style and E2E_GATE=full at the whole suite, whatever the strings are', () => {
      expect(decide(['assets/css/board.css'], ['Thema']).tier).toBe('style')
      expect(decide(['components/A.vue'], ['Thema'], [], { isStyleOnlyVueFile: () => ({ styleOnly: true, failed: false }) })).toMatchObject({ tier: 'style', specs: [] })
      expect(decide(['i18n/locales/de.json'], ['Thema'], [], { env: { E2E_GATE: 'full' } })).toMatchObject({ tier: 'full', specs: specsByText.toSorted() })
    })

    it('leaves the selection of the checked-in rules untouched when no string changed', () => {
      const files = ['components/settings/DataBackupList.vue']
      const withText = selectE2e({ files, config, existingSpecs, changedStrings: () => ({ strings: [], failed: [] }), specsMentioning: found => specsMentioning(found, e2eSources) })
      expect(withText.specs).toEqual(select({ files }).specs)
    })
  })

  describe('changedTextStrings (diff against the merge base)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kando-gate-text-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()
    const write = (file: string, text: string) => {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), text)
    }
    const commit = (message: string) => {
      git('add', '-A')
      git('commit', '-q', '-m', message)
      return git('rev-parse', 'HEAD')
    }

    it('reads changed locale values and testids from the PR head, not from the moved base', () => {
      git('init', '-q', '-b', 'main')
      write('i18n/locales/de.json', JSON.stringify({ g: { topic: 'Thema', priority: 'Priorität' } }))
      write('components/A.vue', '<template><p data-testid="chip-value">x</p></template>\n')
      write('tests/x.test.ts', 'data-testid="never-read"\n')
      commit('base')
      git('checkout', '-q', '-b', 'pr')
      write('i18n/locales/de.json', JSON.stringify({ g: { activity: 'Aktivität', topic: 'Thema', priority: 'Priorität' } }))
      write('components/A.vue', '<template><p data-testid="chip-total">x</p></template>\n')
      write('tests/x.test.ts', 'data-testid="never-read-either"\n')
      write('i18n/locales/en.json', JSON.stringify({ g: { activity: 'Activity' } }))
      const head = commit('pr')
      git('checkout', '-q', 'main')
      write('i18n/locales/de.json', JSON.stringify({ g: { topic: 'Anderes' } }))
      commit('main moves on')

      const files = ['i18n/locales/de.json', 'i18n/locales/en.json', 'components/A.vue', 'tests/x.test.ts', 'docs/a.md']
      expect(changedTextStrings('main', head, dir)(files)).toEqual({ strings: ['Priorität', 'Thema', 'chip-total', 'chip-value'], failed: [] })
      rmSync(dir, { recursive: true, force: true })
    }, 30_000)

    it('names a file it cannot judge', () => {
      expect(changedTextStrings('no-such-branch', 'HEAD', root)(['i18n/locales/de.json'])).toEqual({ strings: [], failed: ['i18n/locales/de.json'] })
      // a sha, not the name `HEAD`: `origin/HEAD` exists in a clone and would make this a diff against origin/main
      const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      expect(changedTextStrings(sha, sha, root)(['i18n/locales/de.json'])).toEqual({ strings: [], failed: [] })
    })
  })
})
