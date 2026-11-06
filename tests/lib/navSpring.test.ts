import { describe, it, expect } from 'vitest'
import { cssTimeMs, directionOf, isSettled, rubberStep, snapTo, springStep, type Rubber } from '~/lib/navSpring'

const at = (l: number, r: number): Rubber => ({ left: { x: l, v: 0 }, right: { x: r, v: 0 } })

/** Runs the step at 60 fps and records the edges per frame */
function run(state: Rubber, target: { l: number, r: number }, dir: 1 | -1, frames = 240) {
  const trace: Array<{ l: number, r: number }> = []
  for (let i = 0; i < frames; i++) {
    rubberStep(state, target, dir, 1 / 60)
    trace.push({ l: state.left.x, r: state.right.x })
  }
  return trace
}

describe('navSpring: the rubber segment (#583)', () => {
  it('converges to the target box and settles', () => {
    const state = at(10, 70)
    const target = { l: 80, r: 170 }
    run(state, target, 1)
    expect(isSettled(state, target)).toBe(true)
  })

  it('the leading edge overshoots, the trailing edge does not (travelling right)', () => {
    const state = at(10, 70)
    const target = { l: 80, r: 170 }
    const trace = run(state, target, 1)
    expect(Math.max(...trace.map(f => f.r))).toBeGreaterThan(target.r)
    expect(Math.max(...trace.map(f => f.l))).toBeLessThanOrEqual(target.l + 0.5)
  })

  it('the trailing edge lags: the chip stretches wider than both boxes mid-move', () => {
    const state = at(10, 70)
    const target = { l: 80, r: 170 }
    const trace = run(state, target, 1, 12)
    const widest = Math.max(...trace.map(f => f.r - f.l))
    expect(widest).toBeGreaterThan(Math.max(70 - 10, 170 - 80))
  })

  it('mirrors when travelling left', () => {
    const state = at(80, 170)
    const target = { l: 10, r: 70 }
    const trace = run(state, target, -1)
    expect(Math.min(...trace.map(f => f.l))).toBeLessThan(target.l)
    expect(isSettled(state, target)).toBe(true)
  })

  it('follows a target that moves while it runs (a growing layout) and still settles', () => {
    const state = at(10, 70)
    let target = { l: 80, r: 170 }
    for (let i = 0; i < 40; i++) {
      target = { l: 80 + i, r: 170 + i * 2 }
      rubberStep(state, target, 1, 1 / 60)
    }
    run(state, target, 1)
    expect(isSettled(state, target)).toBe(true)
  })

  it('is stable on a long step (a background tab resumes with dt capped by the caller)', () => {
    const edge = { x: 0, v: 0 }
    springStep(edge, 100, 330, 0.5, 0.05)
    expect(Number.isFinite(edge.x)).toBe(true)
    expect(Math.abs(edge.x)).toBeLessThan(200)
  })

  it('directionOf compares centres; snapTo rests on the target', () => {
    const state = at(10, 70)
    expect(directionOf(state, { l: 80, r: 170 })).toBe(1)
    expect(directionOf(state, { l: -50, r: -10 })).toBe(-1)
    snapTo(state, { l: 5, r: 25 })
    expect(state.left).toEqual({ x: 5, v: 0 })
    expect(state.right).toEqual({ x: 25, v: 0 })
  })
})

describe('cssTimeMs', () => {
  it('reads ms and s, also the minified forms the production build ships', () => {
    expect(cssTimeMs('420ms')).toBe(420)
    expect(cssTimeMs(' .42s')).toBeCloseTo(420)
    expect(cssTimeMs('0.42s')).toBeCloseTo(420)
    expect(cssTimeMs('0ms')).toBe(0)
    expect(cssTimeMs('0s')).toBe(0)
    expect(cssTimeMs('1.5s')).toBe(1500)
  })

  it('is NaN for anything that is not a time, so the caller falls back', () => {
    expect(cssTimeMs('')).toBeNaN()
    expect(cssTimeMs('420')).toBeNaN()
    expect(cssTimeMs('fast')).toBeNaN()
  })
})
