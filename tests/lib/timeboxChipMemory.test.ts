import { describe, it, expect, beforeEach } from 'vitest'
import {
  CHIP_BOOT_WINDOW_MS,
  rememberInJetzt,
  resetTimeboxChipMemory,
  startsExpanded,
  wasInJetzt,
} from '~/lib/timeboxChipMemory'

beforeEach(() => resetTimeboxChipMemory())

describe('timeboxChipMemory (#388)', () => {
  it('knows nothing about a task the page never rendered', () => {
    expect(wasInJetzt('a')).toBeUndefined()
  })

  it('remembers the last state per task, false included', () => {
    rememberInJetzt('a', true)
    rememberInJetzt('b', false)
    expect(wasInJetzt('a')).toBe(true)
    expect(wasInJetzt('b')).toBe(false)
    rememberInJetzt('a', false)
    expect(wasInJetzt('a')).toBe(false)
  })

  it('resets completely', () => {
    rememberInJetzt('b', true)
    resetTimeboxChipMemory()
    expect(wasInJetzt('b')).toBeUndefined()
  })

  describe('startsExpanded', () => {
    it('continues from the remembered state, not from the current one (the grow plays after the mount)', () => {
      rememberInJetzt('a', false)
      expect(startsExpanded('a', true)).toBe(false)
      rememberInJetzt('b', true)
      expect(startsExpanded('b', false)).toBe(true)
    })

    it('A -> B -> A: Offen, Jetzt, Offen', () => {
      rememberInJetzt('a', false)
      expect(startsExpanded('a', true)).toBe(false) // lands in Jetzt: collapsed, then grows
      rememberInJetzt('a', true)
      expect(startsExpanded('a', false)).toBe(true) // drag preview: bar, then shrinks
      rememberInJetzt('a', false)
      expect(startsExpanded('a', false)).toBe(false) // lands in the column already collapsed
    })

    it('starts a card in Jetzt expanded while the page loads, a card elsewhere collapsed', () => {
      expect(startsExpanded('now', true, () => 1000)).toBe(true)
      expect(startsExpanded('other', false, () => 1000)).toBe(false)
    })

    it('starts an unknown Jetzt card collapsed once the page load is over (add-and-start)', () => {
      expect(startsExpanded('first', true, () => 1000)).toBe(true)
      expect(startsExpanded('created-later', true, () => 1000 + CHIP_BOOT_WINDOW_MS + 1)).toBe(false)
    })
  })
})
