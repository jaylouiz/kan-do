import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsSubpageLink from '~/components/settings/SettingsSubpageLink.vue'

const NuxtLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const IconStub = { props: ['name'], template: '<i :data-icon="name" />' }
const global = { stubs: { NuxtLink: NuxtLinkStub, UIcon: IconStub } }

describe('SettingsSubpageLink (#242)', () => {
  const props = { to: '/settings/github', icon: 'i-ph-key', label: 'GitHub-Zugriff', description: 'Tokens für Updates und Feedback' }

  it('renders label, description, icon and trailing arrow as one link to the target', () => {
    const wrapper = mount(SettingsSubpageLink, { props, global })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe('/settings/github')
    expect(link.text()).toContain('GitHub-Zugriff')
    expect(link.text()).toContain('Tokens für Updates und Feedback')
    expect(wrapper.findAll('i').map(i => i.attributes('data-icon'))).toEqual(['i-ph-key', 'i-ph-arrow-right'])
  })

  it('re-emits the click so a host can close itself', async () => {
    const wrapper = mount(SettingsSubpageLink, { props, global })
    await wrapper.find('a').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
