import { beforeEach, describe, expect, it } from 'vitest'
import { arrivedFromAnotherPage, noteNavigation, resetRouteArrival } from '~/lib/routeArrival'

// kd#133: a cold load is not an arrival; leaving any real page is, and stays one
describe('routeArrival', () => {
  beforeEach(resetRouteArrival)

  it('a cold load is no arrival: the start location, the redirect page / and a navigation on the same path do not count', () => {
    expect(arrivedFromAnotherPage()).toBe(false)
    noteNavigation(null, '/tasks')
    noteNavigation('/', '/tasks')
    noteNavigation('/tasks', '/tasks')
    expect(arrivedFromAnotherPage()).toBe(false)
  })

  it('leaving a real page for another counts, and keeps counting for later navigations', () => {
    noteNavigation(null, '/tasks')
    noteNavigation('/tasks', '/statistics')
    expect(arrivedFromAnotherPage()).toBe(true)
    noteNavigation('/statistics', '/statistics')
    expect(arrivedFromAnotherPage()).toBe(true)
  })
})
