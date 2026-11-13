import { describe, it, expect, vi } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { buildCommandGroups, type PaletteActions } from '~/composables/useCommandPalette'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))

const t = (key: string, ...args: unknown[]) => `${key}${args.length ? JSON.stringify(args[0]) : ''}`
const actions = (): PaletteActions => ({
  addTask: vi.fn(), openToday: vi.fn(), openStatistics: vi.fn(), openTrash: vi.fn(), openSettings: vi.fn(), openDayClose: vi.fn(), resetApp: vi.fn(), openDetails: vi.fn(),
  moveTo: vi.fn(), setTimebox: vi.fn(), setPriority: vi.fn(), deleteTask: vi.fn(), moveToSource: vi.fn(),
})
const task = { id: 'a', title: 'Alpha', status: TaskStatus.Open, priority: 1, timeBoxSeconds: null } as unknown as Task
const allow = () => ({ allowed: true as const })

const desktopActions = (): PaletteActions => ({
  ...actions(),
  openGithubSettings: vi.fn(), openDataFolder: vi.fn(), checkForUpdates: vi.fn(), openUpdates: vi.fn(), sendFeedback: vi.fn(), openWhatsNew: vi.fn(),
})
const desktopOnly = ['github-access', 'data-folder', 'check-updates', 'updates', 'send-feedback', 'whats-new']

const items = (groups: ReturnType<typeof buildCommandGroups>) => groups.flatMap(g => g.items ?? [])
const rowIdsOf = (groups: ReturnType<typeof buildCommandGroups>) => items(groups).map(i => (i as { id: string }).id)
const rowIds = (groups: ReturnType<typeof buildCommandGroups>, groupId: string) =>
  (groups.find(g => g.id === groupId)?.items ?? []).map(i => (i as { id: string }).id)

describe('buildCommandGroups', () => {
  it('without a focused card only the global groups exist (web: no App group)', () => {
    const groups = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    expect(groups.map(g => g.id)).toEqual(['global-actions', 'global-places', 'global-data'])
    expect(groups.map(g => g.label)).toEqual(['commandPalette.groupActions', 'commandPalette.groupPlaces', 'commandPalette.groupData'])
    expect(rowIds(groups, 'global-actions')).toEqual(['add', 'day-close'])
    expect(rowIds(groups, 'global-places')).toEqual(['today', 'statistics', 'trash', 'settings'])
    expect(rowIds(groups, 'global-data')).toEqual(['reset-app'])
  })

  it('desktop: data rows and a fourth group "App" with the update, feedback and what-is-new rows', () => {
    const groups = buildCommandGroups({ t, task: null, canMove: allow, actions: desktopActions() })
    expect(groups.map(g => g.id)).toEqual(['global-actions', 'global-places', 'global-data', 'global-app'])
    expect(groups.at(-1)!.label).toBe('commandPalette.groupApp')
    expect(rowIds(groups, 'global-data')).toEqual(['github-access', 'data-folder', 'reset-app'])
    expect(rowIds(groups, 'global-app')).toEqual(['check-updates', 'updates', 'send-feedback', 'whats-new'])
  })

  it('web: the export/import row sits in the data group before the reset row', () => {
    const groups = buildCommandGroups({ t, task: null, canMove: allow, actions: { ...actions(), openDataTransfer: vi.fn() } })
    expect(rowIds(groups, 'global-data')).toEqual(['data-transfer', 'reset-app'])
  })

  describe('hides the row of the current page', () => {
    const hiddenOn: Array<[string, string, boolean]> = [
      ['/tasks', 'today', false],
      ['/statistics', 'statistics', false],
      ['/trash', 'trash', false],
      ['/settings', 'settings', false],
      ['/settings/github', 'github-access', true],
      ['/settings/data', 'data-folder', true],
      ['/settings/updates', 'updates', true],
    ]
    it.each(hiddenOn)('on %s the row "%s" is not offered, all others stay', (path, hidden, desktop) => {
      const all = rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: null, actions: desktopActions() }))
      const groups = buildCommandGroups({ t, task: null, canMove: allow, currentPath: path, actions: desktop ? desktopActions() : actions() })
      const ids = rowIdsOf(groups)
      expect(ids).not.toContain(hidden)
      const expected = desktop ? all.filter(id => id !== hidden) : all.filter(id => id !== hidden && !desktopOnly.includes(id))
      expect(ids).toEqual(expected)
    })

    it('on /settings/data the web export/import row is the one hidden', () => {
      const groups = buildCommandGroups({ t, task: null, canMove: allow, currentPath: '/settings/data', actions: { ...actions(), openDataTransfer: vi.fn() } })
      expect(rowIdsOf(groups)).not.toContain('data-transfer')
      expect(rowIdsOf(groups)).toContain('reset-app')
    })

    it('a trailing slash and a query are ignored', () => {
      for (const path of ['/statistics/', '/statistics?range=week', '/statistics/?x=1#top']) {
        expect(rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: path, actions: actions() }))).not.toContain('statistics')
      }
    })

    it('a similar path hides nothing (/settings/notion, /tasks/seed-1, /statisticsx)', () => {
      const all = rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: null, actions: desktopActions() }))
      for (const path of ['/settings/notion', '/tasks/seed-1', '/statisticsx', '/']) {
        expect(rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: path, actions: desktopActions() }))).toEqual(all)
      }
    })

    it('currentPath null (or omitted) hides nothing', () => {
      const all = rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, actions: desktopActions() }))
      expect(rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: null, actions: desktopActions() }))).toEqual(all)
      expect(all).toHaveLength(13)
    })

    it('rows that start something are never hidden, whatever the page', () => {
      const starters = ['add', 'day-close', 'reset-app', 'check-updates', 'send-feedback', 'whats-new']
      for (const path of ['/tasks', '/statistics', '/trash', '/settings', '/settings/github', '/settings/data', '/settings/updates']) {
        const ids = rowIdsOf(buildCommandGroups({ t, task: null, canMove: allow, currentPath: path, actions: desktopActions() }))
        for (const id of starters) expect(ids).toContain(id)
      }
    })

    it('a group without rows is not added (web has no App group, on any page)', () => {
      for (const path of ['/tasks', '/settings/updates', null]) {
        expect(buildCommandGroups({ t, task: null, canMove: allow, currentPath: path, actions: actions() }).map(g => g.id)).not.toContain('global-app')
      }
    })

    it('the hidden row does not touch card groups or their place', () => {
      const groups = buildCommandGroups({ t, task, canMove: allow, currentPath: '/tasks', actions: actions() })
      expect(groups.map(g => g.id)).toEqual(['card-move', 'global-actions', 'global-places', 'global-data', 'card'])
      expect(rowIds(groups, 'global-places')).toEqual(['statistics', 'trash', 'settings'])
    })
  })

  it('lists "GitHub-Zugriff" only when the desktop action exists', () => {
    const web = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    expect(items(web).some(i => (i as { id: string }).id === 'github-access')).toBe(false)

    const openGithubSettings = vi.fn()
    const desktop = buildCommandGroups({ t, task: null, canMove: allow, actions: { ...actions(), openGithubSettings } })
    const item = items(desktop).find(i => (i as { id: string }).id === 'github-access')!
    expect(item.label).toBe('commandPalette.openGithubAccess')
    expect(item.icon).toBe('i-ph-key')
    ;(item as { onSelect: () => void }).onSelect()
    expect(openGithubSettings).toHaveBeenCalledOnce()
  })

  it('lists "Datenordner öffnen" only when the desktop action exists', () => {
    const web = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    expect(items(web).some(i => (i as { id: string }).id === 'data-folder')).toBe(false)

    const openDataTransfer = vi.fn()
    const withTransfer = buildCommandGroups({ t, task: null, canMove: allow, actions: { ...actions(), openDataTransfer } })
    const transfer = items(withTransfer).find(i => (i as { id: string }).id === 'data-transfer')!
    expect(transfer.label).toBe('commandPalette.openDataTransfer')
    ;(transfer as { onSelect: () => void }).onSelect()
    expect(openDataTransfer).toHaveBeenCalledOnce()

    const openDataFolder = vi.fn()
    const desktop = buildCommandGroups({ t, task: null, canMove: allow, actions: { ...actions(), openDataFolder } })
    const item = items(desktop).find(i => (i as { id: string }).id === 'data-folder')!
    expect(item.label).toBe('commandPalette.openDataFolder')
    expect(item.icon).toBe('i-ph-folder-open')
    ;(item as { onSelect: () => void }).onSelect()
    expect(openDataFolder).toHaveBeenCalledOnce()
  })

  it('lists the update commands only when the desktop actions exist, in the App group after the data group', () => {
    const web = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    const ids = (g: ReturnType<typeof buildCommandGroups>) => items(g).map(i => (i as { id: string }).id)
    expect(ids(web)).not.toContain('check-updates')
    expect(ids(web)).not.toContain('updates')

    const checkForUpdates = vi.fn()
    const openUpdates = vi.fn()
    const desktop = buildCommandGroups({
      t, task: null, canMove: allow,
      actions: { ...actions(), openDataFolder: vi.fn(), checkForUpdates, openUpdates },
    })
    expect(ids(desktop)).toEqual(['add', 'day-close', 'today', 'statistics', 'trash', 'settings', 'data-folder', 'reset-app', 'check-updates', 'updates'])
    const check = items(desktop).find(i => (i as { id: string }).id === 'check-updates')!
    expect(check.label).toBe('commandPalette.checkForUpdates')
    expect(check.kbds).toBeUndefined()
    ;(check.onSelect as () => void)()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    const page = items(desktop).find(i => (i as { id: string }).id === 'updates')!
    expect(page.label).toBe('commandPalette.openUpdates')
    ;(page.onSelect as () => void)()
    expect(openUpdates).toHaveBeenCalledOnce()
  })

  it('lists "Was ist neu" only when the desktop action exists, without a shortcut hint', () => {
    const web = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    expect(items(web).some(i => (i as { id: string }).id === 'whats-new')).toBe(false)

    const openWhatsNew = vi.fn()
    const desktop = buildCommandGroups({ t, task: null, canMove: allow, actions: { ...actions(), openWhatsNew } })
    const item = items(desktop).find(i => (i as { id: string }).id === 'whats-new')!
    expect(item.label).toBe('commandPalette.openWhatsNew')
    expect(item.kbds).toBeUndefined()
    ;(item.onSelect as () => void)()
    expect(openWhatsNew).toHaveBeenCalledOnce()
  })

  it('offers "close the day" as a global command without a shortcut hint', () => {
    const a = actions()
    const groups = buildCommandGroups({ t, task: null, canMove: allow, actions: a })
    const item = items(groups).find(i => (i as { id: string }).id === 'day-close')!
    expect(item.label).toBe('commandPalette.dayClose')
    expect(item.icon).toBe('i-ph-sun-horizon')
    expect(item.kbds).toBeUndefined()
    ;(item.onSelect as () => void)()
    expect(a.openDayClose).toHaveBeenCalledOnce()
  })

  it('with a focused card adds move and card groups acting on that card', () => {
    const a = actions()
    const groups = buildCommandGroups({ t, task, canMove: allow, actions: a })
    expect(groups.map(g => g.id)).toEqual(['card-move', 'global-actions', 'global-places', 'global-data', 'card'])
    const del = items(groups).find(i => (i as { id: string }).id === 'delete')!
    ;(del.onSelect as () => void)()
    expect(a.deleteTask).toHaveBeenCalledWith('a')
  })

  it('disables Jetzt with a visible reason when the guard refuses', () => {
    const groups = buildCommandGroups({
      t, task, actions: actions(),
      canMove: (_id, status) => status === TaskStatus.Progress ? { allowed: false, reason: 'progressFull' } : { allowed: true },
    })
    const jetzt = items(groups).find(i => (i as { id: string }).id === `move-${TaskStatus.Progress}`) as { disabled: boolean, suffix: string }
    expect(jetzt.disabled).toBe(true)
    expect(jetzt.suffix).toBe('commandPalette.progressFull')
    // blocked rows go last in the move group so the first row is runnable
    const moves = groups.find(g => g.id === 'card-move')!.items as { id: string, disabled?: boolean }[]
    expect(moves.at(-1)!.id).toBe(`move-${TaskStatus.Progress}`)
    expect(moves[0]!.disabled).toBeFalsy()
  })

  it('does not offer a move to the current column and lists global commands before the long card list', () => {
    const groups = buildCommandGroups({ t, task, canMove: allow, actions: actions() })
    const moves = groups.find(g => g.id === 'card-move')!.items as { id: string }[]
    expect(moves.map(m => m.id)).not.toContain(`move-${TaskStatus.Open}`)
    expect(groups.map(g => g.id)).toEqual(['card-move', 'global-actions', 'global-places', 'global-data', 'card'])
  })

  it('advertises no shortcut that does not exist (Enter inside the palette runs the highlighted row)', () => {
    const withKbds = items(buildCommandGroups({ t, task, canMove: allow, actions: actions() })).filter(i => i.kbds)
    expect(withKbds).toEqual([])
  })

  describe('"Verbindung" group (#322)', () => {
    const notion: MoveTarget = { source: 'notion', name: 'Notion', icon: 'i-simple-icons-notion', hint: '2 Felder gehen verloren', disabled: false }
    const local: MoveTarget = { source: 'local', name: 'Lokal', icon: 'i-ph-desktop', hint: '', disabled: false }

    it('sits directly under the column moves, one flat row per target, hint as muted suffix', () => {
      const a = actions()
      const groups = buildCommandGroups({ t, task, canMove: allow, moveTargets: [notion, local], actions: a })
      expect(groups.map(g => g.id)).toEqual(['card-move', 'card-source', 'global-actions', 'global-places', 'global-data', 'card'])
      const group = groups.find(g => g.id === 'card-source')!
      expect(group.label).toBe('commandPalette.groupSource')
      const rows = group.items as Array<{ id: string, label: string, suffix?: string, icon: string, onSelect: () => void }>
      expect(rows.map(r => r.id)).toEqual(['move-source-notion', 'move-source-local'])
      expect(rows[0]!.label).toBe('commandPalette.moveToSource{"source":"Notion"}')
      expect(rows[0]!.suffix).toBe('2 Felder gehen verloren')
      expect(rows[0]!.icon).toBe('i-simple-icons-notion')
      expect(rows[1]).not.toHaveProperty('suffix')
      rows[0]!.onSelect()
      expect(a.moveToSource).toHaveBeenCalledWith('a', 'notion')
    })

    it('has no group without a focused card or without a target (one source connected)', () => {
      expect(buildCommandGroups({ t, task: null, canMove: allow, moveTargets: [notion], actions: actions() }).map(g => g.id)).toEqual(['global-actions', 'global-places', 'global-data'])
      expect(buildCommandGroups({ t, task, canMove: allow, moveTargets: [], actions: actions() }).map(g => g.id)).not.toContain('card-source')
      expect(buildCommandGroups({ t, task, canMove: allow, actions: actions() }).map(g => g.id)).not.toContain('card-source')
    })

    it('a task with an outstanding move shows disabled rows', () => {
      const groups = buildCommandGroups({ t, task, canMove: allow, moveTargets: [{ ...notion, hint: 'Wird gespeichert', disabled: true }], actions: actions() })
      const row = groups.find(g => g.id === 'card-source')!.items![0] as { disabled: boolean, suffix: string }
      expect(row.disabled).toBe(true)
      expect(row.suffix).toBe('Wird gespeichert')
    })
  })
})
