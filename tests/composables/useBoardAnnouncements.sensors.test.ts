/**
 * Pointer activation of a collapsed stack (#150): its control is a drag handle, which dnd-kit would
 * start dragging at once for a mouse. A click must still expand, so a stack asks for what dnd-kit asks
 * for a drag off the handle; everything else stays exactly on dnd-kit's defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PointerSensor } from '@dnd-kit/dom'
import { useBoardAnnouncements } from '~/composables/useBoardAnnouncements'

type Constraints = ((event: PointerEvent, source: unknown) => unknown) | undefined

const activationConstraints = (): Constraints => {
  const configured = useBoardAnnouncements().sensors([PointerSensor] as never) as unknown as Array<{
    options?: { activationConstraints?: Constraints }
  }>
  return configured[0]?.options?.activationConstraints
}

const defaults = (event: PointerEvent, source: unknown) =>
  (PointerSensor.defaults.activationConstraints as (e: PointerEvent, s: unknown) => unknown)(event, source)

const handle = document.createElement('span')
const stackSource = { handle, element: document.createElement('div'), data: { stack: { key: 'S', label: 'S', taskIds: ['a', 'b'] } } }
const cardSource = { handle, element: document.createElement('div'), data: {} }
const pointer = (pointerType: string, target: EventTarget | null = handle) =>
  ({ pointerType, target, defaultPrevented: false }) as unknown as PointerEvent

const describeAll = (constraints: unknown) => JSON.stringify(constraints, (_key, value) => (typeof value === 'function' ? undefined : value))

describe('useBoardAnnouncements: pointer sensor', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a mouse press on a stack control needs a delay and a distance, as a drag off the handle does', () => {
    const configured = activationConstraints()!
    const result = configured(pointer('mouse'), stackSource)

    expect(defaults(pointer('mouse'), stackSource)).toBeUndefined() // dnd-kit alone would start at once
    expect(result).toBeDefined()
    expect(describeAll(result)).toBe(describeAll(defaults(pointer('mouse', null), stackSource)))
  })

  it('a pen press keeps what dnd-kit gives it, for a stack as for a card', () => {
    const configured = activationConstraints()!
    const stackResult = configured(pointer('pen'), stackSource)
    expect(stackResult).toBeDefined()
    expect(describeAll(stackResult)).toBe(describeAll(defaults(pointer('pen'), stackSource)))
  })

  it('touch is untouched', () => {
    const configured = activationConstraints()!
    expect(describeAll(configured(pointer('touch'), stackSource))).toBe(describeAll(defaults(pointer('touch'), stackSource)))
  })

  it('a card keeps dnd-kit\'s defaults, a mouse press on its handle included', () => {
    const configured = activationConstraints()!
    expect(configured(pointer('mouse'), cardSource)).toBeUndefined()
    expect(describeAll(configured(pointer('touch'), cardSource))).toBe(describeAll(defaults(pointer('touch'), cardSource)))
  })
})
