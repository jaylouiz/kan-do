import { describe, expect, it } from 'vitest'
import { compositeOver, contrastRatio, relativeLuminance, worstContrast } from '../e2e/helpers/contrast'

// #632: the math behind tests/e2e/helpers/contrast.ts (the page-side sampling is covered by a11y.spec.ts).

describe('contrast math', () => {
  it('relativeLuminance spans 0 (black) to 1 (white)', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
  })

  it('contrastRatio: black on white is 21:1, order does not matter', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1)
  })

  it('contrastRatio: #767676 on white is the 4.54:1 AA boundary', () => {
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2)
  })

  it('compositeOver paints alpha onto the background', () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 1 }, [200, 100, 50])).toEqual([0, 0, 0])
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0 }, [200, 100, 50])).toEqual([200, 100, 50])
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, [200, 100, 50])).toEqual([100, 50, 25])
  })

  it('worstContrast returns the pixel with the lowest ratio, with the label alpha composited per pixel', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 }
    const worst = worstContrast(black, [[255, 255, 255], [120, 120, 120], [255, 0, 0]])
    expect(worst.background).toEqual([120, 120, 120])
    expect(worst.ratio).toBeCloseTo(contrastRatio([0, 0, 0], [120, 120, 120]), 5)
    // half-transparent black over white composites to mid grey: well below 21:1
    expect(worstContrast({ ...black, a: 0.5 }, [[255, 255, 255]]).ratio).toBeLessThan(5)
    expect(() => worstContrast(black, [])).toThrow()
  })
})
