import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIORITY,
  HIGH,
  LOW,
  REGULAR,
  normalizePriority,
  normalizePriorityMapping,
  notionNameToPriority,
  priorityToNotionName,
  priorityToTodoist,
  samePriorityMapping,
  todoistToPriority,
} from '~/lib/priority'

describe('normalizePriority (#617)', () => {
  it('keeps 1, 2 and 3', () => {
    expect([1, 2, 3].map(normalizePriority)).toEqual([LOW, REGULAR, HIGH])
  })
  it('reads the former 4th level (urgent) and anything above as High', () => {
    expect(normalizePriority(4)).toBe(HIGH)
    expect(normalizePriority(99)).toBe(HIGH)
    expect(normalizePriority('4')).toBe(HIGH)
  })
  it('reads no priority (a stored 0, missing, null, empty or invalid) as Normal (#653)', () => {
    expect([0, undefined, null, '', 'x', NaN, -1].map(normalizePriority)).toEqual(Array(7).fill(REGULAR))
    expect(DEFAULT_PRIORITY).toBe(REGULAR)
  })
})

describe('normalizePriorityMapping', () => {
  it('passes the new shape through (trimmed, de-duplicated)', () => {
    expect(normalizePriorityMapping({ high: ['Hoch', 'Dringend', 'Hoch'], regular: ['Mittel'], low: [] }))
      .toEqual({ high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: [] })
  })
  it('reads the legacy { urgent, high, medium, low } shape, High first', () => {
    expect(normalizePriorityMapping({ urgent: 'Dringend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }))
      .toEqual({ high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: ['Niedrig'] })
    expect(normalizePriorityMapping({ urgent: 'U', high: 'H', medium: null, low: null }))
      .toEqual({ high: ['H', 'U'], regular: [], low: [] })
  })
  it('returns undefined for nothing usable', () => {
    expect(normalizePriorityMapping(undefined)).toBeUndefined()
    expect(normalizePriorityMapping(null)).toBeUndefined()
    expect(normalizePriorityMapping('x')).toBeUndefined()
    expect(normalizePriorityMapping([])).toBeUndefined()
  })
})

describe('notionNameToPriority', () => {
  const mapping = { high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: ['Niedrig'] }
  it('maps every listed option to its level, case-insensitive', () => {
    expect(notionNameToPriority('dringend', mapping)).toBe(HIGH)
    expect(notionNameToPriority('HOCH', mapping)).toBe(HIGH)
    expect(notionNameToPriority('mittel', mapping)).toBe(REGULAR)
    expect(notionNameToPriority('Niedrig', mapping)).toBe(LOW)
  })
  it('resolves an option listed under two levels to the higher one', () => {
    expect(notionNameToPriority('X', { high: ['X'], regular: ['X'], low: [] })).toBe(HIGH)
  })
  it('falls back to name defaults for an unlisted option, else Low', () => {
    expect(notionNameToPriority('Urgent', mapping)).toBe(HIGH)
    expect(notionNameToPriority('Medium', mapping)).toBe(REGULAR)
    expect(notionNameToPriority('normal', undefined)).toBe(REGULAR)
    expect(notionNameToPriority('Sehr Wichtig', mapping)).toBe(LOW)
  })
  it('reads an empty select as Normal (#653), with or without a mapping', () => {
    for (const empty of [null, undefined, '', '  ']) {
      expect(notionNameToPriority(empty, mapping)).toBe(REGULAR)
      expect(notionNameToPriority(empty, undefined)).toBe(REGULAR)
    }
  })
})

describe('priorityToNotionName', () => {
  it('writes the first option of the level', () => {
    const mapping = { high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: ['Niedrig'] }
    expect(priorityToNotionName(HIGH, mapping)).toBe('Hoch')
    expect(priorityToNotionName(4, mapping)).toBe('Hoch')
    expect(priorityToNotionName(REGULAR, mapping)).toBe('Mittel')
    expect(priorityToNotionName(LOW, mapping)).toBe('Niedrig')
  })
  it('falls back regular → low → high and low → regular → high when a list is empty', () => {
    expect(priorityToNotionName(REGULAR, { high: ['H'], regular: [], low: ['L'] })).toBe('L')
    expect(priorityToNotionName(REGULAR, { high: ['H'], regular: [], low: [] })).toBe('H')
    expect(priorityToNotionName(LOW, { high: ['H'], regular: ['R'], low: [] })).toBe('R')
    expect(priorityToNotionName(LOW, { high: ['H'], regular: [], low: [] })).toBe('H')
  })
  it('without a mapping writes the English defaults', () => {
    expect([HIGH, REGULAR, LOW].map((p) => priorityToNotionName(p, undefined))).toEqual(['High', 'Medium', 'Low'])
  })
})

describe('Todoist table', () => {
  it('reads API 1/2/3/4 as low/regular/high/high', () => {
    expect([1, 2, 3, 4].map(todoistToPriority)).toEqual([LOW, REGULAR, HIGH, HIGH])
  })
  it('reads a missing priority as Normal (#653), anything else invalid as low', () => {
    expect([null, undefined].map(todoistToPriority)).toEqual([REGULAR, REGULAR])
    expect([0, 7].map(todoistToPriority)).toEqual([LOW, LOW])
  })
  it('writes low/regular/high as 1/2/4 and no priority as Normal (2)', () => {
    expect([LOW, REGULAR, HIGH, 4].map(priorityToTodoist)).toEqual([1, 2, 4, 4])
    expect([0, -1, NaN].map(priorityToTodoist)).toEqual([2, 2, 2])
  })
})

describe('samePriorityMapping', () => {
  const base = { high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: [] }
  it('is true for equal lists, an unset mapping equals an empty one', () => {
    expect(samePriorityMapping(base, { ...base, high: [...base.high] })).toBe(true)
    expect(samePriorityMapping(undefined, { high: [], regular: [], low: [] })).toBe(true)
  })
  it('is false when an option is added or removed, or the order changes (the first one is written back)', () => {
    expect(samePriorityMapping(base, { ...base, low: ['Niedrig'] })).toBe(false)
    expect(samePriorityMapping(base, { ...base, high: ['Hoch'] })).toBe(false)
    expect(samePriorityMapping(base, { ...base, high: ['Dringend', 'Hoch'] })).toBe(false)
  })
})
