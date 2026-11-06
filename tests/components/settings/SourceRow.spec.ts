import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceRow from '~/components/settings/SourceRow.vue'
import type { ConnectedSourceRow } from '~/composables/useSourceList'

const row = (overrides: Partial<ConnectedSourceRow> = {}): ConnectedSourceRow => ({
  id: 'notion', name: 'Notion', icon: 'i-simple-icons-notion', isDefault: false, statusText: 'Synchronisiert · vor 5 Min.',
  statusTone: 'muted', canSetDefault: true, canRepair: false, canConfigure: true, ...overrides,
})

const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' },
  UBadge: { template: '<span data-testid="badge"><slot /></span>' },
  UIcon: true,
}
const render = (r: ConnectedSourceRow) => mount(SourceRow, { props: { row: r }, global: { stubs } })

describe('SourceRow (#324)', () => {
  it('the default row shows the badge as text and no "Als Standard festlegen"', () => {
    const w = render(row({ isDefault: true, canSetDefault: false }))
    expect(w.text()).toContain('Standard')
    expect(w.find('[data-testid="source-set-default-notion"]').exists()).toBe(false)
  })

  it('another row offers "Als Standard festlegen" whose accessible name carries the source, and emits its id', async () => {
    const w = render(row())
    const button = w.get('[data-testid="source-set-default-notion"]')
    expect(button.text()).toBe('Als Standard festlegen')
    expect(button.attributes('aria-label')).toBe('Notion als Standard festlegen')
    await button.trigger('click')
    expect(w.emitted('setDefault')).toEqual([['notion']])
  })

  it('the repair shows only when the row allows it and the status takes the warning tone without an error colour', async () => {
    expect(render(row()).find('[data-testid="source-repair-notion"]').exists()).toBe(false)
    const w = render(row({ canRepair: true, statusText: 'Verbindung prüfen', statusTone: 'warning' }))
    expect(w.get('[data-testid="source-status-notion"]').classes()).toContain('text-warning-700')
    expect(w.get('[data-testid="source-status-notion"]').classes().join(' ')).not.toContain('error')
    await w.get('[data-testid="source-repair-notion"]').trigger('click')
    expect(w.emitted('repair')).toEqual([['notion']])
  })

  it('settings and disconnect emit with the id and carry the source in their names', async () => {
    const w = render(row())
    expect(w.get('[data-testid="source-settings-notion"]').text()).toBe('Notion-Einstellungen')
    expect(w.get('[data-testid="source-disconnect-notion"]').attributes('aria-label')).toBe('Notion trennen')
    await w.get('[data-testid="source-settings-notion"]').trigger('click')
    await w.get('[data-testid="source-disconnect-notion"]').trigger('click')
    expect(w.emitted('openSettings')).toEqual([['notion']])
    expect(w.emitted('disconnect')).toEqual([['notion']])
  })

  it('Local offers nothing but "Als Standard festlegen" (and nothing at all when it is the only source)', () => {
    const local = row({ id: 'local', name: 'Lokal', canConfigure: false, statusText: 'Auf diesem Gerät gespeichert' })
    const w = render(local)
    expect(w.findAll('button').map((b) => b.attributes('data-testid'))).toEqual(['source-set-default-local'])
    const only = render({ ...local, isDefault: true, canSetDefault: false })
    expect(only.findAll('button')).toHaveLength(0)
    expect(only.text()).toContain('Standard')
  })
})
