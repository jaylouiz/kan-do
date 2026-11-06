import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { isApplePlatform, isSubmitShortcut, usePlatformShortcut } from '~/composables/usePlatformShortcut'
import { setTestLocale } from '../helpers/i18n'

function stubPlatform(platform: string, userAgentDataPlatform?: string) {
  vi.stubGlobal('navigator', {
    platform,
    ...(userAgentDataPlatform ? { userAgentData: { platform: userAgentDataPlatform } } : {}),
  })
}

function shortcutFor(): string {
  let shortcut = ''
  mount(defineComponent({
    setup() {
      shortcut = usePlatformShortcut().submitShortcut
      return () => null
    },
  }))
  return shortcut
}

afterEach(() => {
  vi.unstubAllGlobals()
  setTestLocale('de')
})

describe('isApplePlatform (#161)', () => {
  it('prefers userAgentData.platform', () => {
    stubPlatform('Win32', 'macOS')
    expect(isApplePlatform()).toBe(true)
  })

  it('falls back to navigator.platform', () => {
    stubPlatform('MacIntel')
    expect(isApplePlatform()).toBe(true)
    stubPlatform('Linux x86_64')
    expect(isApplePlatform()).toBe(false)
    stubPlatform('Win32')
    expect(isApplePlatform()).toBe(false)
  })
})

describe('usePlatformShortcut (#161)', () => {
  it('names Cmd on macOS', () => {
    stubPlatform('MacIntel')
    expect(shortcutFor()).toBe('Cmd + Enter')
  })

  it('names Strg in German and Ctrl in English elsewhere', () => {
    stubPlatform('Win32')
    expect(shortcutFor()).toBe('Strg + Enter')
    setTestLocale('en')
    expect(shortcutFor()).toBe('Ctrl + Enter')
  })
})

describe('isSubmitShortcut (#161)', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

  it('accepts Cmd+Enter (macOS) and Ctrl+Enter (elsewhere)', () => {
    expect(isSubmitShortcut(key({ key: 'Enter', metaKey: true }))).toBe(true)
    expect(isSubmitShortcut(key({ key: 'Enter', ctrlKey: true }))).toBe(true)
  })

  it('ignores a bare Enter and other keys', () => {
    expect(isSubmitShortcut(key({ key: 'Enter' }))).toBe(false)
    expect(isSubmitShortcut(key({ key: 's', metaKey: true }))).toBe(false)
  })
})
