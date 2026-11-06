import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskSourceIcon from '~/components/task/TaskSourceIcon.vue'
import { setTestLocale } from '../../helpers/i18n'

const render = (source: 'local' | 'notion' | 'todoist' | string | undefined) =>
  mount(TaskSourceIcon, { props: { source: source as 'local' }, global: { stubs: { UIcon: { template: '<i v-bind="$attrs" />', inheritAttrs: false } } } })

describe('TaskSourceIcon (#323)', () => {
  it.each([
    ['local', 'Lokal'],
    ['notion', 'Notion'],
    ['todoist', 'Todoist'],
  ] as const)('%s is an image named %s, with no visible text and no tab stop', (source, name) => {
    const w = render(source)
    expect(w.attributes('role')).toBe('img')
    expect(w.attributes('aria-label')).toBe(name)
    expect(w.attributes('title')).toBe(name)
    expect(w.attributes('tabindex')).toBeUndefined()
    expect(w.text()).toBe('')
  })

  it('maps each source to a bundled ph / simple-icons icon', () => {
    expect(render('local').attributes('name')).toBe('i-ph-desktop')
    expect(render('notion').attributes('name')).toBe('i-simple-icons-notion')
    expect(render('todoist').attributes('name')).toBe('i-simple-icons-todoist')
  })

  it('follows the locale', () => {
    setTestLocale('en')
    expect(render('local').attributes('aria-label')).toBe('Local')
  })

  it.each([undefined, 'bogus'])('falls back to the Local icon for source %s without throwing (#360)', (source) => {
    const w = render(source)
    expect(w.attributes('name')).toBe('i-ph-desktop')
    expect(w.attributes('aria-label')).toBe('Lokal')
  })
})
