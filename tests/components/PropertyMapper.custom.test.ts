/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PropertyMapper from '~/components/notion/setup/mapping/PropertyMapper.vue'
import type { NotionDatabaseSchema, NotionPropertyMapping } from '~/types/notion'

const schema: NotionDatabaseSchema = {
  Title: { id: 't', name: 'Title', type: 'title' },
  Status: { id: 's', name: 'Status', type: 'select' },
  Score: { id: 'n', name: 'Score', type: 'number' },
  Link: { id: 'u', name: 'Link', type: 'url' },
  Due: { id: 'd', name: 'Due', type: 'date' },
  Aktivität: { id: 'a', name: 'Aktivität', type: 'select' },
}

// Minimal stubs for Nuxt UI/Icons used in the component template
const globalStubs = {
  USelect: {
    template: '<select><slot /></select>',
    props: ['modelValue', 'items'],
  },
  UToggle: {
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', !$props.modelValue)" />',
    props: ['modelValue'],
  },
  UInput: {
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', ($event && $event.target && $event.target.value))" />',
    props: ['modelValue'],
  },
  UDivider: {
    template: '<hr />',
  },
  UIcon: {
    template: '<i />',
  },
}

describe('PropertyMapper – custom properties', () => {
  it('excludes core-mapped fields from custom list and emits selected customs on save', async () => {
    const defaultMapping: Partial<NotionPropertyMapping> = {
      title: 'Title',
      status: 'Status',
      dueDate: 'Due',
      // priority/timeBox/timeSpent not set
      customProperties: [
        { name: 'Score', type: 'number', enabled: false, key: 'score' },
        { name: 'Link', type: 'url', enabled: true, key: 'link', label: 'Öffentlicher Link' },
      ],
    }

    const wrapper = mount(PropertyMapper as any, {
      global: { stubs: globalStubs as any },
      props: {
        databaseSchema: schema,
        defaultMapping: defaultMapping as any,
      },
    })

    // Verify stubs mounted
    expect(wrapper.exists()).toBe(true)

    // Flip Score to enabled and set a custom label via bound model
    // The custom selections live under customSelections[prop.name]
    // Accessing component internals since UI is stubbed
    const vm = wrapper.vm as any
    // Wait a tick: mount initializes selections via watchers
    await wrapper.vm.$nextTick()

    // Ensure core fields are excluded from eligible list
    const eligible = vm.eligibleCustomProps || []
    const names = eligible.map((p: any) => p.name)
    expect(names).not.toContain('Title')
    expect(names).not.toContain('Status')
    expect(names).not.toContain('Due')

    // Toggle Score on and set label
    if (!vm.customSelections?.Score) {
      vm.customSelections = vm.customSelections || {}
      vm.customSelections.Score = { enabled: false, label: null }
    }

    vm.customSelections.Score.enabled = true
    vm.customSelections.Score.label = 'Punkte'

    // Save and capture emitted mapping
    vm.save()
    const emitted = wrapper.emitted('saved')
    expect(emitted).toBeTruthy()
    const [emittedMapping] = emitted![0] as [NotionPropertyMapping]

    // customProperties should include Score (enabled) and Link (already enabled)
    const customs = emittedMapping.customProperties || []
    const byKey: Record<string, any> = Object.fromEntries(customs.map((c: any) => [c.key, c]))
    expect(byKey['score']).toMatchObject({ name: 'Score', key: 'score', enabled: true, type: 'number', label: 'Punkte' })
    expect(byKey['link']).toMatchObject({ name: 'Link', key: 'link', enabled: true, type: 'url', label: 'Öffentlicher Link' })

    // Core mappings preserved
    expect(emittedMapping.title).toBe('Title')
    expect(emittedMapping.status).toBe('Status')
    expect(emittedMapping.dueDate).toBe('Due')
  })

  it('excludes activity field from custom properties when mapped to standard field', async () => {
    const defaultMapping: Partial<NotionPropertyMapping> = {
      title: 'Title',
      status: 'Status',
      activity: 'Aktivität', // Mapped to standard activity field
      customProperties: [
        { name: 'Score', type: 'number', enabled: true, key: 'score' },
      ],
    }

    const wrapper = mount(PropertyMapper as any, {
      global: { stubs: globalStubs as any },
      props: {
        databaseSchema: schema,
        defaultMapping: defaultMapping as any,
      },
    })

    const vm = wrapper.vm as any
    await wrapper.vm.$nextTick()

    // Ensure Aktivität is excluded from eligible custom properties
    const eligible = vm.eligibleCustomProps || []
    const names = eligible.map((p: any) => p.name)
    expect(names).not.toContain('Aktivität')
    expect(names).not.toContain('Title')
    expect(names).not.toContain('Status')

    // Score and Link should be available as custom properties
    expect(names).toContain('Score')
    expect(names).toContain('Link')
    expect(names).toContain('Due')
  })
})

describe('PropertyMapper – isMappingValid gate (#358)', () => {
  it('is false while the schema is empty and turns true once it is auto-mapped', async () => {
    const wrapper = mount(PropertyMapper as any, {
      global: { stubs: globalStubs as any },
      props: { databaseSchema: {} },
    })
    expect((wrapper.vm as any).isMappingValid).toBe(false)

    await wrapper.setProps({ databaseSchema: schema })
    await wrapper.vm.$nextTick()
    expect((wrapper.vm as any).isMappingValid).toBe(true)
  })
})
