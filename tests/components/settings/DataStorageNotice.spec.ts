import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { resetCloudNoticeDismissal } from '~/composables/useDataFolder'
import { initDataStorage, resetDataStorage } from '~/lib/dataStorage'
import type { CloudSync } from '~/types/dataFile'
import { createFakeDataBackend, type FakeDataBackend } from '../../helpers/fakeDataBackend'

// Renders the actions as plain buttons; the real UAlert needs the Nuxt UI runtime.
const AlertStub = defineComponent({
  props: { actions: { type: Array, default: () => [] }, color: { type: String, default: '' }, icon: { type: String, default: '' }, title: { type: String, default: '' } },
  setup(props) {
    return () => h('div', { 'data-color': props.color, 'data-icon': props.icon, 'data-title': props.title }, (props.actions as { label: string, onClick?: () => void }[]).map((a) => h('button', { onClick: a.onClick }, a.label)))
  },
})

const cloud = (patch: Partial<CloudSync> = {}): CloudSync => ({ state: 'pending', message: null, since: '2026-10-27T10:00:00.000Z', visible: true, ...patch })

let backend: FakeDataBackend

beforeEach(async () => {
  resetCloudNoticeDismissal()
  resetDataStorage()
  backend = createFakeDataBackend({})
  await initDataStorage({ backend })
  await Promise.resolve()
})
afterEach(() => {
  useBoardDragState().dragState.value.isDragging = false
  resetDataStorage()
})

const mountNotice = () => mount(DataStorageNotice, { global: { stubs: { UAlert: AlertStub, DataConflictModal: true } } })
const hideButtons = (w: ReturnType<typeof mountNotice>) => w.findAll('button').filter((b) => b.text() === 'Ausblenden')

describe('DataStorageNotice cloud states (#289)', () => {
  it.each(['uploading', 'pending', 'error'] as const)('%s renders the same neutral notice', async (state) => {
    const wrapper = mountNotice()
    backend.emit({ cloudSync: cloud({ state, message: state === 'error' ? 'offline' : null }) })
    await nextTick()
    const alert = wrapper.find('div')
    expect(alert.attributes('data-color')).toBe('neutral')
    expect(alert.attributes('data-icon')).toBe('i-ph-cloud-slash')
    expect(alert.attributes('data-title')).toBe('Noch nicht in iCloud hochgeladen. Lokal ist alles gespeichert.')
  })
})

describe('DataStorageNotice "Ausblenden" (#284)', () => {
  it('hides the notice and drops the action', async () => {
    const wrapper = mountNotice()
    backend.emit({ cloudSync: cloud() })
    await nextTick()
    expect(hideButtons(wrapper)).toHaveLength(1)
    await hideButtons(wrapper)[0]!.trigger('click')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('offers no action while a drag holds a notice whose live state is already gone', async () => {
    const wrapper = mountNotice()
    backend.emit({ cloudSync: cloud() })
    await nextTick()
    useBoardDragState().dragState.value.isDragging = true
    backend.emit({ cloudSync: cloud({ state: 'uploaded', since: null, visible: false }) })
    await nextTick()
    // The held notice still renders (no layout shift), but a click could not act on it.
    expect(wrapper.findAll('button').length).toBeGreaterThan(0)
    expect(hideButtons(wrapper)).toHaveLength(0)
  })
})
