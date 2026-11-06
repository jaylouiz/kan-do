import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #614: the desktop window has no separate title bar; the traffic lights sit in the app bar row. The window can only
// still be moved if the drag strip (`data-tauri-drag-region`, app.vue) is allowed to call the window plugin.

const root = resolve(__dirname, '../..')
const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
  app: { windows: Array<Record<string, unknown>> }
}
const capability = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')) as {
  permissions: Array<string | { identifier: string }>
}

describe('desktop window chrome', () => {
  const main = conf.app.windows[0]!

  it('uses an overlay title bar without a title', () => {
    expect(main.titleBarStyle).toBe('Overlay')
    expect(main.hiddenTitle).toBe(true)
  })

  it('places the traffic lights inside the app bar row', () => {
    const pos = main.trafficLightPosition as { x: number, y: number }
    expect(pos.x).toBeGreaterThan(0)
    // The bar row is 3.5rem (56px) with the pills centred at 28px: the lights must start inside it.
    expect(pos.y).toBeGreaterThan(0)
    expect(pos.y).toBeLessThan(56)
  })

  it('lets the drag strip move the window; double click zoom is covered by core:default', () => {
    const ids = capability.permissions.map(p => (typeof p === 'string' ? p : p.identifier))
    expect(ids).toContain('core:window:allow-start-dragging')
    expect(ids).toContain('core:default')
  })
})
