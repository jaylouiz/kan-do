import { describe, expect, it } from 'vitest'
import { dotWeight, pageProgress } from '~/lib/pageDots'

describe('pageProgress', () => {
  it('is the settled page without a swipe', () => {
    expect(pageProgress(1, 0, 390)).toBe(1)
  })
  it('moves towards the next page on a swipe left and back on a swipe right', () => {
    expect(pageProgress(1, -195, 390)).toBe(1.5)
    expect(pageProgress(1, 195, 390)).toBe(0.5)
  })
  it('clamps past the first and last page', () => {
    expect(pageProgress(0, 80, 390)).toBe(0)
    expect(pageProgress(2, -80, 390)).toBe(2)
  })
  it('falls back to the settled page without a viewport width', () => {
    expect(pageProgress(2, -50, 0)).toBe(2)
  })
})

describe('dotWeight', () => {
  it('is 1 on the active dot and 0 two pages away', () => {
    expect(dotWeight(1, 1)).toBe(1)
    expect(dotWeight(0, 2)).toBe(0)
  })
  it('splits between neighbours mid-swipe', () => {
    expect(dotWeight(0, 0.5)).toBe(0.5)
    expect(dotWeight(1, 0.5)).toBe(0.5)
  })
})
