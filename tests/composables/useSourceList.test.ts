/** #324: the rows of the Verbindungen page, derived from the sources config and the per-source health. */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSourceList, minutesSince } from '~/composables/useSourceList'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { setTestLocale } from '../helpers/i18n'

const minutesAgo = (n: number) => Date.now() - n * 60_000

describe('useSourceList (#324)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('Local only: Lokal carries the badge and offers nothing; Notion is connectable, Todoist is "soon"', () => {
    useBoardStore().setSingleSource('local')
    const { connected, more } = useSourceList()

    expect(connected.value).toEqual([
      expect.objectContaining({
        id: 'local', name: 'Lokal', isDefault: true, statusText: 'Auf diesem Gerät gespeichert', statusTone: 'muted',
        canSetDefault: false, canRepair: false, repairNeedsCredentials: false, canConfigure: false,
      }),
    ])
    expect(more.value.map((row) => [row.id, row.state])).toEqual([['notion', 'connectable'], ['todoist', 'soon']])
  })

  it('Notion connected and healthy: relative last-sync line, default moves with setDefaultSource, Notion leaves "Weitere Verbindungen"', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion', minutesAgo(5))
    const { connected, more } = useSourceList()

    const [local, notion] = connected.value
    expect(local).toMatchObject({ id: 'local', isDefault: false, canSetDefault: true, canConfigure: false })
    expect(notion).toMatchObject({
      id: 'notion', isDefault: true, statusText: 'Synchronisiert · vor 5 Min.', statusTone: 'muted',
      canSetDefault: false, canRepair: false, canConfigure: true,
    })
    expect(more.value.map((row) => row.id)).toEqual(['todoist'])

    board.setDefaultSource('local')
    expect(connected.value.map((row) => [row.id, row.isDefault, row.canSetDefault])).toEqual([['local', true, false], ['notion', false, true]])
  })

  it.each(['broken', 'degraded'] as const)('%s: warning "Verbindung prüfen" with the repair, no matter how old the last sync is', (status) => {
    const health = useIntegrationHealthStore()
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    health.recordSuccessfulSync('notion', minutesAgo(3))
    if (status === 'broken') health.markBroken('notion', 'Unauthorized')
    else health.markDegraded('notion', 'Server error')

    const notion = useSourceList().connected.value[1]
    // Only a broken connection starts its repair at the credentials; a degraded one keeps the settings mode
    expect(notion).toMatchObject({ statusText: 'Verbindung prüfen', statusTone: 'warning', canRepair: true, repairNeedsCredentials: status === 'broken' })
  })

  it('merely offline keeps the last-sync line and offers no repair', () => {
    const health = useIntegrationHealthStore()
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    health.recordSuccessfulSync('notion', minutesAgo(12))
    health.markOffline('notion', 'Network error')

    expect(useSourceList().connected.value[1]).toMatchObject({ statusText: 'Synchronisiert · vor 12 Min.', statusTone: 'muted', canRepair: false })
  })

  it('before a first successful sync the status is the neutral "Wird geprüft…"', () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    expect(useSourceList().connected.value[1]).toMatchObject({ statusText: 'Wird geprüft…', statusTone: 'muted', canRepair: false })
  })

  it('the sync line counts up through hours and days, and says "gerade eben" within a minute', () => {
    const health = useIntegrationHealthStore()
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    const { connected } = useSourceList()
    const line = () => connected.value[1]?.statusText
    health.recordSuccessfulSync('notion', Date.now() - 10_000)
    expect(line()).toBe('Synchronisiert · gerade eben')
    health.recordSuccessfulSync('notion', minutesAgo(125))
    expect(line()).toBe('Synchronisiert · vor 2 Std.')
    health.recordSuccessfulSync('notion', minutesAgo(60 * 24 * 3 + 1))
    expect(line()).toBe('Synchronisiert · vor 3 T.')
  })

  it('English wording', () => {
    setTestLocale('en')
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion', minutesAgo(5))
    const { connected } = useSourceList()
    expect(connected.value[0]?.statusText).toBe('Stored on this device')
    expect(connected.value[1]?.statusText).toBe('Synced · 5 min ago')
  })

  it('a disconnect sequence: the default falls back to Local and Notion is offered again', () => {
    const board = useBoardStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    const { connected, more } = useSourceList()
    expect(connected.value).toHaveLength(2)

    board.disconnectIntegration('notion')
    expect(connected.value.map((row) => [row.id, row.isDefault])).toEqual([['local', true]])
    expect(more.value.map((row) => row.id)).toEqual(['notion', 'todoist'])
  })
})

describe('minutesSince', () => {
  it('floors to whole minutes and never goes negative', () => {
    expect(minutesSince(0, 119_999)).toBe(1)
    expect(minutesSince(5_000, 0)).toBe(0)
  })
})
