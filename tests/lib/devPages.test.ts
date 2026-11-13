import { describe, expect, it } from 'vitest'
import { isDevInstance, removeDevPages, shouldShipDevPages, type PageRecord } from '../../lib/devPages'

// #65: `/ui` and `/error-test` ship only in dev and in the E2E build (flag), never in a plain production build.
describe('shouldShipDevPages', () => {
  it('ships whenever NODE_ENV is not production (dev, tests)', () => {
    expect(shouldShipDevPages({})).toBe(true)
    expect(shouldShipDevPages({ NODE_ENV: 'development' })).toBe(true)
    expect(shouldShipDevPages({ NODE_ENV: 'test' })).toBe(true)
  })

  it('drops them from a production build', () => {
    expect(shouldShipDevPages({ NODE_ENV: 'production' })).toBe(false)
  })

  it('keeps them in a production build only for KANDO_UI_CATALOG=1', () => {
    expect(shouldShipDevPages({ NODE_ENV: 'production', KANDO_UI_CATALOG: '1' })).toBe(true)
    for (const other of ['0', 'true', '', undefined]) expect(shouldShipDevPages({ NODE_ENV: 'production', KANDO_UI_CATALOG: other })).toBe(false)
  })
})

// #246: the dev instance is a Vercel preview of the `dev` branch (or KANDO_DEV_INSTANCE=1): it carries /ui and the copy editor.
describe('isDevInstance', () => {
  it('is on for KANDO_DEV_INSTANCE=1 only', () => {
    expect(isDevInstance({ KANDO_DEV_INSTANCE: '1' })).toBe(true)
    for (const other of ['0', 'true', '', undefined]) expect(isDevInstance({ KANDO_DEV_INSTANCE: other })).toBe(false)
  })

  it('is on for the Vercel preview of the dev branch', () => {
    expect(isDevInstance({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dev' })).toBe(true)
  })

  it('is off for production, other branches and prototypes', () => {
    expect(isDevInstance({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })).toBe(false)
    expect(isDevInstance({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'dev' })).toBe(false)
    expect(isDevInstance({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'proto/12-x' })).toBe(false)
    expect(isDevInstance({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dev-2' })).toBe(false)
    expect(isDevInstance({})).toBe(false)
  })

  it('makes a production build ship the dev pages', () => {
    expect(shouldShipDevPages({ NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dev' })).toBe(true)
    expect(shouldShipDevPages({ NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'proto/1-a' })).toBe(false)
  })
})

describe('removeDevPages', () => {
  const pages = (): PageRecord[] => [
    { file: '/repo/pages/tasks.vue', children: [{ file: '/repo/pages/tasks/[id].vue' }] },
    { file: '/repo/pages/ui.vue' },
    { file: '/repo/pages/error-test.vue' },
    { file: '/repo/pages/settings/ui.vue' },
    { file: '/repo/pages/welcome.vue' },
  ]

  it('removes the dev-only pages in place from a production build and returns them', () => {
    const list = pages()
    const removed = removeDevPages(list, { NODE_ENV: 'production' })
    expect(removed.map(p => p.file)).toEqual(['/repo/pages/error-test.vue', '/repo/pages/ui.vue'])
    // a page of the same basename in another folder stays
    expect(list.map(p => p.file)).toEqual(['/repo/pages/tasks.vue', '/repo/pages/settings/ui.vue', '/repo/pages/welcome.vue'])
  })

  it('removes a dev-only page that is nested as a child route', () => {
    const list: PageRecord[] = [{ file: '/repo/pages/a.vue', children: [{ file: '/repo/pages/ui.vue' }, { file: '/repo/pages/b.vue' }] }]
    removeDevPages(list, { NODE_ENV: 'production' })
    expect(list[0]!.children!.map(p => p.file)).toEqual(['/repo/pages/b.vue'])
  })

  it('handles Windows separators', () => {
    const list: PageRecord[] = [{ file: 'C:\\repo\\pages\\ui.vue' }]
    removeDevPages(list, { NODE_ENV: 'production' })
    expect(list).toEqual([])
  })

  it('leaves every page alone when they ship', () => {
    const list = pages()
    expect(removeDevPages(list, { NODE_ENV: 'production', KANDO_UI_CATALOG: '1' })).toEqual([])
    expect(removeDevPages(list, {})).toEqual([])
    expect(list).toHaveLength(5)
  })
})
