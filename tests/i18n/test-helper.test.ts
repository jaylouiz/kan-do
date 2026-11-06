import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { useI18n } from 'vue-i18n'
import { translate } from '~/lib/i18n'
import { setTestLocale } from '../helpers/i18n'

describe('shared i18n test setup', () => {
  it('provides $t to mounted components', () => {
    const wrapper = mount({ template: '<p>{{ $t("common.back") }}</p>' })
    expect(wrapper.text()).toBe('Zurück')
  })

  it('useI18n works outside a component', () => {
    expect(useI18n().t('common.back')).toBe('Zurück')
  })

  it('translate() uses the shared instance', () => {
    expect(translate('common.back')).toBe('Zurück')
  })

  it('setTestLocale switches locale and is reset to de for the next test', () => {
    setTestLocale('en')
    expect(useI18n().locale.value).toBe('en')
  })

  it('locale is de again after the previous test', () => {
    expect(useI18n().locale.value).toBe('de')
  })
})
