import { describe, it, expect } from 'vitest'
import { nextRadioIndex } from '~/utils/radioArrowKeys'

describe('nextRadioIndex (#431)', () => {
  it('moves by one and wraps in a row', () => {
    expect(nextRadioIndex('ArrowRight', 9, 10)).toBe(0)
    expect(nextRadioIndex('ArrowLeft', 0, 10)).toBe(9)
    expect(nextRadioIndex('ArrowDown', 2, 10)).toBe(3)
    expect(nextRadioIndex('ArrowUp', 0, 10)).toBe(9)
  })

  it('moves by a row in a grid and clamps at the ends', () => {
    expect(nextRadioIndex('ArrowDown', 1, 25, 5)).toBe(6)
    expect(nextRadioIndex('ArrowDown', 22, 25, 5)).toBe(24)
    expect(nextRadioIndex('ArrowUp', 3, 25, 5)).toBe(0)
  })

  it('jumps with Home / End and ignores other keys', () => {
    expect(nextRadioIndex('Home', 4, 10)).toBe(0)
    expect(nextRadioIndex('End', 4, 10)).toBe(9)
    expect(nextRadioIndex('a', 4, 10)).toBeNull()
    expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
