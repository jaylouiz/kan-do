import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataLoadResult } from '~/types/dataFile'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const { createTauriBackend } = await import('~/lib/dataBackendTauri')
const { emptyDataStatus } = await import('~/lib/dataStatus')

const loadResult = (generation: number): DataLoadResult => ({
  ...emptyDataStatus({ folder: '/data', filePath: '/data/kan-do-data.json', schemaVersion: 1, deviceId: 'device', appVersion: '0.1.0' }),
  envelope: null,
  needsInit: false,
  generation,
})

function setCalls() {
  return invoke.mock.calls.filter(([command]) => command === 'data_set').map(([, args]) => args as { key: string, generation: number, seq: number })
}

beforeEach(() => {
  invoke.mockReset()
})

describe('createTauriBackend data_set ordering stamp', () => {
  it('sends the generation of the last load and a rising seq, assigned in call order', async () => {
    invoke.mockImplementation(async (command: string) => (command === 'data_load' ? loadResult(7) : null))
    const backend = createTauriBackend()
    await backend.load()

    // Fired without awaiting, like appStorage.setItem does; the first invoke is held back so a later call
    // overtakes it on the wire, which is the reordering Rust has to survive.
    let releaseFirst: () => void = () => undefined
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve })
    let heldOnce = false
    invoke.mockImplementation(async (command: string, args?: { seq?: number }) => {
      if (command === 'data_set' && args?.seq === 1 && !heldOnce) {
        heldOnce = true
        await firstHeld
      }
      return null
    })
    const pending: Promise<void>[] = []
    for (const [key, n] of [['tasks-store', 1], ['tasks-store', 2], ['board-store', 3]] as const) {
      pending.push(backend.set(key, { n }))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    releaseFirst()
    await Promise.all(pending)

    // The stamps follow the call order although the first invoke was still in flight when the others left.
    expect(setCalls().map(({ key, generation, seq }) => [key, generation, seq])).toEqual([
      ['tasks-store', 7, 1],
      ['tasks-store', 7, 2],
      ['board-store', 7, 3],
    ])
  })

  it('restarts the sequence and adopts the new generation on every load', async () => {
    let generation = 1
    invoke.mockImplementation(async (command: string) => (command === 'data_load' ? loadResult(generation++) : null))
    const backend = createTauriBackend()
    await backend.load()
    await backend.set('tasks-store', 1)
    await backend.load()
    await backend.set('tasks-store', 2)

    expect(setCalls().map(({ generation: g, seq }) => [g, seq])).toEqual([[1, 1], [2, 1]])
  })

  it('does not adopt the generation a use-switch returns, so the old page stays locked out until it reloads', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'data_load') return loadResult(3)
      if (command === 'data_set_location') return loadResult(4)
      return null
    })
    const backend = createTauriBackend()
    await backend.load()
    await backend.setLocation('/cloud', 'use')
    await backend.set('tasks-store', { stale: true })

    expect(setCalls()[0]?.generation).toBe(3)
  })
})
