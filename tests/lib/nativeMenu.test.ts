import { describe, expect, it, vi } from 'vitest'
import { buildMenuLabels, isMenuActionId, MENU_ACTION_IDS, menuActionHandlers, type MenuDeps } from '~/lib/nativeMenu'

function deps(over: Partial<MenuDeps> = {}) {
  const calls: string[] = []
  const d: MenuDeps = {
    navigate: vi.fn(async (path: string) => { calls.push(`navigate ${path}`) }),
    afterRender: vi.fn(async () => { calls.push('render') }),
    checkForUpdates: vi.fn(() => { calls.push('check-updates') }),
    openDayClose: vi.fn(() => { calls.push('day-close') }),
    openFeedback: vi.fn(() => { calls.push('feedback') }),
    openWhatsNew: vi.fn(() => { calls.push('whats-new') }),
    dialogOpen: () => false,
    ...over,
  }
  return { d, calls }
}

describe('menuActionHandlers', () => {
  it('has a handler for every id', () => {
    expect(Object.keys(menuActionHandlers(deps().d)).sort()).toEqual([...MENU_ACTION_IDS].sort())
  })

  it.each([
    ['app.settings', '/settings'],
    ['app.go-today', '/tasks'],
    ['app.go-statistics', '/statistics'],
    ['app.go-trash', '/trash'],
  ] as const)('%s navigates to %s', async (id, path) => {
    const { d, calls } = deps()
    await menuActionHandlers(d)[id]()
    expect(calls).toEqual([`navigate ${path}`])
  })

  it('app.new-task opens the add sheet when no dialog is open', async () => {
    const { d, calls } = deps()
    await menuActionHandlers(d)['app.new-task']()
    expect(calls).toEqual(['navigate /tasks/add'])
  })

  it('navigates even while a dialog is open (the target replaces it)', async () => {
    const { d, calls } = deps({ dialogOpen: () => true })
    await menuActionHandlers(d)['app.settings']()
    expect(calls).toEqual(['navigate /settings'])
  })

  it('opens the day-close and feedback dialogs on the board, after it rendered', async () => {
    const { d, calls } = deps()
    const handlers = menuActionHandlers(d)
    await handlers['app.day-close']()
    await handlers['app.feedback']()
    expect(calls).toEqual(['navigate /tasks', 'render', 'day-close', 'navigate /tasks', 'render', 'feedback'])
  })

  it('runs the update check and What\'s new without navigating', async () => {
    const { d, calls } = deps()
    const handlers = menuActionHandlers(d)
    await handlers['app.check-updates']()
    await handlers['app.whats-new']()
    expect(calls).toEqual(['check-updates', 'whats-new'])
  })

  it.each(['app.new-task', 'app.check-updates', 'app.day-close', 'app.feedback', 'app.whats-new'] as const)(
    '%s does nothing while another dialog is open',
    async (id) => {
      const { d, calls } = deps({ dialogOpen: () => true })
      await menuActionHandlers(d)[id]()
      expect(calls).toEqual([])
    },
  )
})

describe('isMenuActionId', () => {
  it('accepts listed ids only', () => {
    expect(isMenuActionId('app.settings')).toBe(true)
    expect(isMenuActionId('app.unknown')).toBe(false)
    expect(isMenuActionId('quit')).toBe(false)
    expect(isMenuActionId(undefined)).toBe(false)
    expect(isMenuActionId({ id: 'app.settings' })).toBe(false)
  })
})

describe('buildMenuLabels', () => {
  it('translates every label key through menu.*', () => {
    const labels = buildMenuLabels(key => `<${key}>`)
    expect(labels.settings).toBe('<menu.settings>')
    expect(Object.keys(labels)).toHaveLength(31)
  })
})
