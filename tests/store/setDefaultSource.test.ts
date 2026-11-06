/** #324: the default source is changed in place on the connected sources (sequences, not single calls). */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'

describe('setDefaultSource', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('moves the default between Local and a connected integration and leaves the connections alone', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'local' })

    expect(board.setDefaultSource('notion')).toBe(true)
    expect(board.defaultSource).toBe('notion')
    expect(board.setDefaultSource('local')).toBe(true)
    expect(board.defaultSource).toBe('local')
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
  })

  it('rejects an unconnected integration and a board that never onboarded', () => {
    const board = useBoardStore()
    expect(board.setDefaultSource('local')).toBe(false)
    expect(board.boardConfig.sources).toBeNull()

    board.setSingleSource('local')
    expect(board.setDefaultSource('notion')).toBe(false)
    expect(board.setDefaultSource('todoist')).toBe(false)
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
  })

  it('setting the current default is a no-op', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    expect(board.setDefaultSource('notion')).toBe(false)
  })

  it('a pending source switch survives a new integration default and ends when Local becomes the default', () => {
    const board = useBoardStore()
    useTasksStore().beginSourceSwitch('notion')
    expect(board.isSourceSwitchPending).toBe(true)

    board.setDefaultSource('local')
    expect(board.isSourceSwitchPending).toBe(false)
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
  })

  it('after the default is disconnected it can be set again once Notion is connected anew', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    board.disconnectIntegration('notion')
    expect(board.defaultSource).toBe('local')
    expect(board.setDefaultSource('notion')).toBe(false)
    board.connectIntegration('notion')
    expect(board.setDefaultSource('notion')).toBe(true)
  })
})
