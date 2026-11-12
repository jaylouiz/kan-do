import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ListRow from '~/components/ui/ListRow.vue'

describe('ListRow (#76)', () => {
  it('a static row is a plain <li> with the one density and the attrs on the <li>', () => {
    const wrapper = mount(ListRow, { attrs: { 'data-testid': 'row' }, slots: { default: 'Lokal' } })
    expect(wrapper.element.tagName).toBe('LI')
    expect(wrapper.attributes('data-testid')).toBe('row')
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['min-h-14', 'py-3']))
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('has one density and one hover (kd#180): no density and no hover prop', () => {
    const props = Object.keys((ListRow as unknown as { props: Record<string, unknown> }).props ?? {})
    expect(props).not.toContain('density')
    expect(props).not.toContain('hover')
  })

  it('an action row is one button: click emits, aria-expanded and label follow the props, the testid names the button', async () => {
    const wrapper = mount(ListRow, {
      props: { action: true, expanded: true, label: 'Bearbeiten: Arbeit', buttonTestid: 'row-button' },
      attrs: { 'data-testid': 'row' },
      slots: { default: 'Arbeit', after: '<p class="after">Editor</p>' },
    })
    const button = wrapper.get('[data-testid="row-button"]')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.attributes('aria-label')).toBe('Bearbeiten: Arbeit')
    expect(button.classes()).toEqual(expect.arrayContaining(['focus-ring', 'min-h-14', '-mx-2', 'px-2', 'w-full', 'box-content', 'hover:bg-muted']))
    expect(wrapper.attributes('data-testid')).toBe('row')
    expect(wrapper.find('.after').exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('exposes focus() so a host can return focus to the row (topic editor close)', () => {
    const wrapper = mount(ListRow, { props: { action: true }, slots: { default: 'x' }, attachTo: document.body })
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    wrapper.unmount()
  })

  it('leaves aria-expanded off a row that does not expand', () => {
    const wrapper = mount(ListRow, { props: { action: true }, slots: { default: 'x' } })
    expect(wrapper.get('button').attributes('aria-expanded')).toBeUndefined()
  })

  it('a link row is one NuxtLink to the target (kd#179): no button, the muted tint, click re-emitted, the testid names the link', async () => {
    const NuxtLinkStub = { props: ['to'], template: '<a :href="to" v-bind="$attrs"><slot /></a>' }
    const wrapper = mount(ListRow, {
      props: { to: '/settings/github', buttonTestid: 'row-link' },
      attrs: { 'data-testid': 'row' },
      slots: { default: 'GitHub-Zugriff' },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    expect(wrapper.element.tagName).toBe('LI')
    expect(wrapper.find('button').exists()).toBe(false)
    const link = wrapper.get('[data-testid="row-link"]')
    expect(link.attributes('href')).toBe('/settings/github')
    expect(link.text()).toBe('GitHub-Zugriff')
    expect(link.classes()).toEqual(expect.arrayContaining(['min-h-14', '-mx-2', 'px-2', 'hover:bg-muted', 'focus-ring']))
    await link.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
