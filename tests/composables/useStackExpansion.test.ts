import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { TaskStatus } from '~/types/taskStatus'

/**
 * The post-expand sheet guard (#154): armed by a pointer expand, it blocks only the later clicks of
 * the same sequence (detail >= 2) and is released by events, never by a timer.
 */

const stacks = useStackExpansion()
const click = (detail: number) => ({ detail }) as MouseEvent
const mousedown = (detail: number) => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail }))

beforeEach(() => stacks.reset())
afterEach(() => stacks.reset())

describe('useStackExpansion: shouldBlockModal(event)', () => {
  it('blocks the second click of a double-click after a pointer expand, however slow it is', async () => {
    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(stacks.shouldBlockModal(click(2))).toBe(true)
  })

  it('does not block a single click, nor a synthetic dblclick (detail 0)', () => {
    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    expect(stacks.shouldBlockModal(click(1))).toBe(false)
    expect(stacks.shouldBlockModal(click(0))).toBe(false)
  })

  it('never arms for a keyboard expand', () => {
    stacks.expand(TaskStatus.Open, 'Design', 'keyboard')
    expect(stacks.shouldBlockModal(click(2))).toBe(false)
  })

  it('is released by a new click sequence (mousedown with detail 1) but not by the second mousedown', () => {
    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    mousedown(2)
    expect(stacks.shouldBlockModal(click(2))).toBe(true)
    mousedown(1)
    expect(stacks.shouldBlockModal(click(2))).toBe(false)
  })

  it('is released by collapse, collapseAll and reset', () => {
    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    stacks.collapse(TaskStatus.Open, 'Design')
    expect(stacks.shouldBlockModal(click(2))).toBe(false)

    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    stacks.collapseAll(TaskStatus.Open)
    expect(stacks.shouldBlockModal(click(2))).toBe(false)

    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    stacks.reset()
    expect(stacks.shouldBlockModal(click(2))).toBe(false)
  })

  it('keeps an expansion across what a mobile tab switch does: nothing', () => {
    stacks.expand(TaskStatus.Open, 'Design', 'pointer')
    // the tab is Board state; useStackExpansion is module-level and has no tab input
    expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual(['Design'])
  })
})
