/** #762: the web build is called "Web-App" / "web app", never "public cloud version", and its welcome intro promises no Notion or Todoist. */
import { describe, expect, it } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'

describe('web app copy (#762)', () => {
  it('names no "public cloud version" in any locale string', () => {
    for (const locale of [de, en]) expect(JSON.stringify(locale)).not.toMatch(/öffentliche[nr]? Cloud|public cloud/i)
  })

  it('the web welcome intro leaves Notion and Todoist out', () => {
    expect(de.onboarding.page.introWeb).not.toMatch(/Notion|Todoist/)
    expect(en.onboarding.page.introWeb).not.toMatch(/Notion|Todoist/)
  })

  it('the unavailable Notion row says Mac app only', () => {
    expect(de.sources.page.cloudUnavailable).toBe('Nur in der Desktop-App')
    expect(en.sources.page.cloudUnavailable).toBe('Desktop app only')
  })
})
