import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, ref } from 'vue'

import { placeOfPath, thirdItemOfPath, useAppNav } from '~/composables/useAppNav'

const route = reactive<{ path: string; meta: Record<string, unknown> }>({ path: '/tasks', meta: {} })
// The bar reads the live router route (#507); Nuxt's lagging `useRoute()` is a trap and throws here
vi.mock('nuxt/app', () => ({
  useRouter: () => ({ currentRoute: ref(route) }),
  useRoute: () => { throw new Error('useAppNav must read router.currentRoute, not the lagging useRoute()') },
  navigateTo: vi.fn(),
}))

describe('placeOfPath: route -> place', () => {
  it.each([
    ['/tasks', 'board'],
    ['/tasks/add', 'board'],
    ['/tasks/x', 'board'],
    ['/statistics', 'statistics'],
    ['/statistics/test-task-1', 'statistics'], // a task opened from the statistics page (kd#179)
    ['/trash', 'more'],
    ['/settings', 'more'],
    ['/settings/topics', 'more'],
    ['/settings/updates', 'more'],
    ['/welcome', null],
    ['/', null],
    ['/tasksfoo', null],
    ['/settingsx', null],
    ['/unknown', null],
  ])('%s -> %s', (path, expected) => {
    expect(placeOfPath(path)).toBe(expected)
  })
})

describe('thirdItemOfPath: route -> third segment of the pill (#583)', () => {
  it.each([
    ['/trash', '/trash', 'nav.trash'],
    ['/settings', '/settings', 'nav.settings'],
    ['/settings/topics', '/settings?tab=manage', 'nav.settings'],
    ['/settings/updates', '/settings?tab=manage', 'nav.settings'],
    ['/settings/notion', '/settings?tab=sources', 'nav.settings'],
  ])('%s -> link %s, label %s', (path, to, labelKey) => {
    expect(thirdItemOfPath(path)).toEqual({ to, labelKey })
  })

  it.each(['/tasks', '/tasks/add', '/statistics', '/welcome', '/', '/settingsx', '/trashed', '/unknown'])('%s -> none', (path) => {
    expect(thirdItemOfPath(path)).toBeNull()
  })
})

describe('useAppNav', () => {
  beforeEach(() => {
    route.path = '/tasks'
    route.meta = {}
  })

  it('selects the place of the route and flags the board', () => {
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(true)
    expect(nav.currentPlace.value).toBe('board')
    expect(nav.onBoard.value).toBe(true)

    route.path = '/statistics'
    expect(nav.currentPlace.value).toBe('statistics')
    expect(nav.onBoard.value).toBe(false)

    route.path = '/settings/topics'
    expect(nav.currentPlace.value).toBe('more')
  })

  it('has no bar and no place on a route with appNav: false, whatever its path', () => {
    route.path = '/tasks'
    route.meta = { appNav: false }
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(false)
    expect(nav.currentPlace.value).toBeNull()
  })

  it('has a bar but no place on an unknown route', () => {
    route.path = '/somewhere'
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(true)
    expect(nav.currentPlace.value).toBeNull()
  })

  it('follows a Heute -> Statistik -> Heute -> Papierkorb sequence', () => {
    const nav = useAppNav()
    const seen: Array<string | null> = []
    for (const path of ['/tasks', '/statistics', '/tasks', '/trash', '/settings', '/settings/topics', '/tasks']) {
      route.path = path
      seen.push(nav.currentPlace.value)
    }
    expect(seen).toEqual(['board', 'statistics', 'board', 'more', 'more', 'more', 'board'])
  })

  it('shows a third segment only on a page behind ⋯, and none without a bar', () => {
    const nav = useAppNav()
    const seen: Array<string | undefined> = []
    for (const path of ['/tasks', '/settings', '/trash', '/statistics', '/settings/updates']) {
      route.path = path
      seen.push(nav.thirdItem.value?.labelKey)
    }
    expect(seen).toEqual([undefined, 'nav.settings', 'nav.trash', undefined, 'nav.settings'])

    route.path = '/settings'
    route.meta = { appNav: false }
    expect(nav.thirdItem.value).toBeNull()
  })
})
