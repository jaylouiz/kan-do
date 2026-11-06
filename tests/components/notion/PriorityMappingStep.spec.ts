import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PriorityMappingStep from '~/components/notion/setup/wizard/steps/PriorityMappingStep.vue'
import type { NotionDatabaseSchema } from '~/types/notion'

const option = (name: string) => ({ id: name, name, color: 'gray' })
const schema = (names: string[]) => ({ Priorität: { id: 'p', name: 'Priorität', type: 'select', select: { options: names.map(option) } } }) as unknown as NotionDatabaseSchema

const STUBS = {
  UFormField: { props: ['label', 'required'], template: '<div class="field" :data-required="required"><label>{{ label }}</label><slot /></div>' },
  USelectMenu: { name: 'USelectMenu', props: ['modelValue', 'items', 'multiple'], emits: ['update:modelValue'], template: '<div class="menu" :data-multiple="multiple" />' },
  UAlert: { template: '<div class="alert"><slot name="description" /></div>' },
}

function mountStep(names: string[], defaultMapping?: unknown) {
  return mount(PriorityMappingStep, {
    props: { databaseSchema: schema(names), priorityPropertyName: 'Priorität', defaultMapping: defaultMapping as never },
    global: { stubs: STUBS },
  })
}

const saved = (w: ReturnType<typeof mountStep>) => {
  ;(w.vm as unknown as { save: () => void }).save()
  return w.emitted('saved')?.[0]?.[0]
}

describe('PriorityMappingStep (#617)', () => {
  it('shows three multi-select fields, High required', () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'])
    const fields = w.findAll('.field')
    expect(fields.map(f => f.find('label').text())).toEqual(['Hoch', 'Normal', 'Niedrig'])
    expect(fields.map(f => f.attributes('data-required'))).toEqual(['true', 'false', 'false'])
    expect(w.findAll('.menu').every(m => m.attributes('data-multiple') !== undefined && m.attributes('data-multiple') !== 'false')).toBe(true)
  })

  it('suggests every fitting option per level, Urgent and High both under High', () => {
    const w = mountStep(['Dringend', 'Hoch', 'Mittel', 'Niedrig', 'Irgendwann'])
    expect(saved(w)).toEqual({ high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: ['Niedrig'] })
  })

  it('puts the plain High name before Urgent so the first option written back is High', () => {
    const w = mountStep(['Dringend', 'Hoch', 'Mittel', 'Niedrig'])
    expect((saved(w) as { high: string[] }).high).toEqual(['Hoch', 'Dringend'])
    const en = mountStep(['Critical', 'Urgent', 'High', 'Medium', 'Low'])
    expect((saved(en) as { high: string[] }).high).toEqual(['High', 'Urgent', 'Critical'])
  })

  it('emits change when a level is edited, not for the initial suggestion', async () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'])
    await w.vm.$nextTick()
    expect(w.emitted('change')).toBeUndefined()
    await w.findAllComponents({ name: 'USelectMenu' })[1]!.vm.$emit('update:modelValue', [])
    expect(w.emitted('change')?.at(-1)?.[0]).toEqual({ high: ['Hoch'], regular: [], low: ['Niedrig'] })
  })

  it('does not emit change when the schema loads after the form opened (#627)', async () => {
    const w = mountStep([])
    await w.setProps({ databaseSchema: schema(['Hoch', 'Mittel', 'Niedrig']) })
    await w.vm.$nextTick()
    expect(w.emitted('change')).toBeUndefined()
    expect(saved(w)).toEqual({ high: ['Hoch'], regular: ['Mittel'], low: ['Niedrig'] })
  })

  it('reset() restores the first-open state when no mapping is stored (#627)', async () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'])
    const menus = () => w.findAllComponents({ name: 'USelectMenu' })
    await menus()[0]!.vm.$emit('update:modelValue', ['Niedrig'])
    await menus()[2]!.vm.$emit('update:modelValue', [])
    expect(menus().map(m => m.props('modelValue'))).toEqual([['Niedrig'], ['Mittel'], []])
    ;(w.vm as unknown as { reset: () => void }).reset()
    await w.vm.$nextTick()
    expect(menus().map(m => m.props('modelValue'))).toEqual([['Hoch'], ['Mittel'], ['Niedrig']])
    expect(w.emitted('change')).toHaveLength(2)
  })

  it('reset() restores the stored mapping (#627)', async () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'], { high: ['Hoch'], regular: [], low: ['Niedrig'] })
    await w.findAllComponents({ name: 'USelectMenu' })[0]!.vm.$emit('update:modelValue', ['Mittel'])
    ;(w.vm as unknown as { reset: () => void }).reset()
    await w.vm.$nextTick()
    expect(w.findAllComponents({ name: 'USelectMenu' }).map(m => m.props('modelValue'))).toEqual([['Hoch'], [], ['Niedrig']])
  })

  it('shows a mapping stored before #617 as stored (an unset level stays empty) and saves the new shape (#636)', () => {
    const w = mountStep(['Dringend', 'Hoch', 'Mittel', 'Niedrig'], { urgent: 'Dringend', high: 'Hoch', medium: 'Mittel', low: null })
    expect(saved(w)).toEqual({ high: ['Hoch', 'Dringend'], regular: ['Mittel'], low: [] })
  })

  it('does not refill a level stored as empty with the suggestion (#636)', () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'], { high: ['Hoch'], regular: [], low: ['Niedrig'] })
    expect(w.findAllComponents({ name: 'USelectMenu' }).map(m => m.props('modelValue'))).toEqual([['Hoch'], [], ['Niedrig']])
    expect(saved(w)).toEqual({ high: ['Hoch'], regular: [], low: ['Niedrig'] })
  })

  it('assigns nothing when the schema loads late and a mapping is stored (#636)', async () => {
    const w = mountStep([], { high: ['Hoch'], regular: [], low: [] })
    await w.setProps({ databaseSchema: schema(['Hoch', 'Mittel', 'Niedrig']) })
    await w.vm.$nextTick()
    expect(w.findAllComponents({ name: 'USelectMenu' }).map(m => m.props('modelValue'))).toEqual([['Hoch'], [], []])
  })

  it('emits only what is shown when a level is edited next to a stored-empty one (#636)', async () => {
    const w = mountStep(['Hoch', 'Mittel', 'Niedrig'], { high: ['Hoch'], regular: [], low: [] })
    await w.findAllComponents({ name: 'USelectMenu' })[2]!.vm.$emit('update:modelValue', ['Niedrig'])
    expect(w.emitted('change')?.at(-1)?.[0]).toEqual({ high: ['Hoch'], regular: [], low: ['Niedrig'] })
  })

  it('is invalid without a High option and does not emit', () => {
    const w = mountStep(['A', 'B'])
    expect((w.vm as unknown as { isMappingValid: boolean }).isMappingValid).toBe(false)
    expect(saved(w)).toBeUndefined()
  })

  it('flags an option under two levels and does not save', () => {
    const w = mountStep(['Hoch', 'Niedrig'], { high: ['Hoch'], regular: ['Hoch'], low: ['Niedrig'] })
    expect(w.find('.alert').text()).toContain('Hoch')
    expect((w.vm as unknown as { isMappingValid: boolean }).isMappingValid).toBe(false)
    expect(saved(w)).toBeUndefined()
  })
})
