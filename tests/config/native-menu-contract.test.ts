import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MENU_ACTION_EVENT, MENU_ACTION_IDS, MENU_LABEL_KEYS } from '../../lib/nativeMenu'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'

// Drift guard for the macOS menu bar (#614): the Rust side (`menu.rs`) and the web side (`lib/nativeMenu.ts`)
// share a list of custom item ids, an event name and the set of label fields.

const root = resolve(__dirname, '../..')
const rust = readFileSync(resolve(root, 'src-tauri/src/menu.rs'), 'utf8')

const camel = (snake: string): string => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

describe('native menu contract', () => {
  it('lists the same custom item ids in Rust and TypeScript', () => {
    const block = /pub const MENU_ACTIONS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)?.[1] ?? ''
    const ids = [...block.matchAll(/"([^"]+)"/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toEqual([...MENU_ACTION_IDS])
  })

  it('uses the same event name', () => {
    expect(rust).toContain(`pub const MENU_ACTION_EVENT: &str = "${MENU_ACTION_EVENT}";`)
  })

  it('sends exactly the label fields Rust deserializes', () => {
    const struct = /pub struct MenuLabels \{([\s\S]*?)\n\}/.exec(rust)?.[1] ?? ''
    const fields = [...struct.matchAll(/pub (\w+): String/g)].map(m => camel(m[1]!))
    expect(fields).toEqual([...MENU_LABEL_KEYS])
  })

  it.each([['de', de], ['en', en]] as const)('has a non-empty menu.* title per label in %s', (_name, locale) => {
    const menu = (locale as unknown as { menu: Record<string, string> }).menu
    expect(Object.keys(menu).sort()).toEqual([...MENU_LABEL_KEYS].sort())
    for (const key of MENU_LABEL_KEYS) expect(menu[key], key).toBeTruthy()
  })
})
