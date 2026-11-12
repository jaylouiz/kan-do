import { describe, it, expect, vi } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { buildCommandGroups, type PaletteActions } from '~/composables/useCommandPalette'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))

const t = (key: string, ...args: unknown[]) => `${key}${args.length ? JSON.stringify(args[0]) : ''}`
const actions = (): PaletteActions => ({
  addTask: vi.fn(), openToday: vi.fn(), openStatistics: vi.fn(), openTrash: vi.fn(), openSettings: vi.fn(), openDayClose: vi.fn(), openDetails: vi.fn(),
  moveTo: vi.fn(), setTimebox: vi.fn(), setPriority: vi.fn(), deleteTask: vi.fn(), moveToSource: vi.fn(),
})
const task = { id: 'a', title: 'Alpha', status: TaskStatus.Open, priority: 1, timeBoxSeconds: null } as unknown as Task
const allow = () => ({ allowed: true as const })

const items = (groups: ReturnType<typeof buildCommandGroups>) => groups.flatMap(g => g.items ?? [])

describe('buildCommandGroups', () => {
  it('without a focused card only global commands exist', () => {
    const groups = buildCommandGroups({ t, task: null, canMove: allow, actions: actions() })
    expect(groups.map(g => g.id)).toEqual(['global'])
    expect(items(groups).map(i => (i as { id: string }).id)).toEqual(['add', 'today', 'statistics', 'trash', 'settings', 'day-close'])
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

  it('lists the update commands only when the desktop actions exist, after the data folder', () => {
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
    expect(ids(desktop).slice(-3)).toEqual(['data-folder', 'check-updates', 'updates'])
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
    expect(groups.map(g => g.id)).toEqual(['card-move', 'global', 'card'])
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
    expect(groups.map(g => g.id)).toEqual(['card-move', 'global', 'card'])
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
      expect(groups.map(g => g.id)).toEqual(['card-move', 'card-source', 'global', 'card'])
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
      expect(buildCommandGroups({ t, task: null, canMove: allow, moveTargets: [notion], actions: actions() }).map(g => g.id)).toEqual(['global'])
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
