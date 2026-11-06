import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EDGE_HOLD_DWELL_MS } from '../e2e/helpers/constants'

describe('E2E edge-hold dwell', () => {
  it('stays above the product EDGE_HOLD_MS in Board.vue (not exported, so read from source)', () => {
    const source = readFileSync('components/board/Board.vue', 'utf8')
    const match = /const EDGE_HOLD_MS = (\d+)/.exec(source)
    expect(match).not.toBeNull()
    expect(EDGE_HOLD_DWELL_MS).toBeGreaterThan(Number(match![1]))
  })
})
