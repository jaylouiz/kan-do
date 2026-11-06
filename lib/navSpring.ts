/**
 * @module navSpring
 * @description The "rubber segment" of the app bar's indicator (#583): two edges, each an underdamped spring that
 * chases one side of the selected segment's box. The edge in the direction of travel is stiffer and overshoots
 * slightly, the trailing edge lags, so the shape stretches and snaps back. Pure maths, no DOM: the rAF loop and the
 * measuring live in `composables/useNavIndicator.ts`.
 */

/** One edge: position and velocity in px (and px/s) */
export interface Edge {
  x: number
  v: number
}

/** The indicator: the left and right edge of the chip */
export interface Rubber {
  left: Edge
  right: Edge
}

/** Target box of the selected segment, relative to the pill */
export interface Box {
  l: number
  r: number
}

/** Stiffness `k` and damping ratio `zeta` of the leading and the trailing edge */
export const RUBBER = {
  lead: { k: 330, zeta: 0.5 },
  trail: { k: 150, zeta: 0.85 },
} as const

/** Longest step the loop integrates in one go (a background tab must not fling the chip) */
export const MAX_DT = 0.05

/** One underdamped spring step (semi-implicit Euler, sub-stepped for stability). Mutates `edge`. */
export function springStep(edge: Edge, target: number, k: number, zeta: number, dt: number): void {
  const c = 2 * zeta * Math.sqrt(k)
  const n = Math.max(1, Math.ceil(dt / 0.004))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    edge.v += (-k * (edge.x - target) - c * edge.v) * h
    edge.x += edge.v * h
  }
}

/** Advance both edges towards `target`; `dir` is the direction of travel (1 = right, -1 = left). Mutates `state`. */
export function rubberStep(state: Rubber, target: Box, dir: 1 | -1, dt: number): void {
  const [leadEdge, leadTarget, trailEdge, trailTarget] = dir >= 0
    ? [state.right, target.r, state.left, target.l]
    : [state.left, target.l, state.right, target.r]
  springStep(leadEdge, leadTarget, RUBBER.lead.k, RUBBER.lead.zeta, dt)
  springStep(trailEdge, trailTarget, RUBBER.trail.k, RUBBER.trail.zeta, dt)
}

/** Both edges within `pos` px of the target and slower than `vel` px/s */
export function isSettled(state: Rubber, target: Box, pos = 0.15, vel = 1): boolean {
  return Math.abs(state.left.x - target.l) < pos
    && Math.abs(state.right.x - target.r) < pos
    && Math.abs(state.left.v) < vel
    && Math.abs(state.right.v) < vel
}

/** Put both edges on the target, at rest */
export function snapTo(state: Rubber, target: Box): void {
  state.left = { x: target.l, v: 0 }
  state.right = { x: target.r, v: 0 }
}

/** +1 when the target's centre is right of the chip's centre, else -1 */
export function directionOf(state: Rubber, target: Box): 1 | -1 {
  return (target.l + target.r) / 2 >= (state.left.x + state.right.x) / 2 ? 1 : -1
}

/**
 * A CSS `<time>` custom property value in ms, or NaN when it is none. The production CSS minifier rewrites
 * `420ms` to `.42s`, and `parseFloat('.42s')` is 0.42: read as ms every move ran for under a millisecond.
 */
export function cssTimeMs(value: string): number {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ms|s)\s*$/i.exec(value)
  if (!match) return Number.NaN
  return Number.parseFloat(match[1]!) * (match[2]!.toLowerCase() === 's' ? 1000 : 1)
}
