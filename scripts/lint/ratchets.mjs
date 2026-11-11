/**
 * Count ratchets of the UI kit (#78, epic #58): a baseline of per-file counts, committed as data under
 * `tests/config/`, that may only fall. A file above its count fails (a new file has 0), a baseline above the real count
 * fails too ("lower it"), so a cleanup that removes a raw `<button>` or a `:ui` binding has to say so in the same PR.
 *
 * - `raw-button`: `<button>` elements in shipped Vue UI. A button is a `UButton` (DESIGN.md "Components", `/ui` Aktion
 *   entries) or the `ListRow` action row; a raw one needs a reason in the baseline.
 * - `ui-prop`: `:ui="…"` / `ui="…"` bindings, and the `*-ui` forwarding props (`:desktop-ui`, `:picker-ui`, …) that carry call-site classes into a `:ui`. Visual identity belongs in the `app.config.ts` theme or in tokens (epic #58
 *   D1, DESIGN.md "Guards"); the call-site `ui` prop only places a part.
 *
 * Lower: `npm run ratchet:lower` (never raises; raising is a hand edit of the baseline, visible in the diff).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RATCHETS = {
  'raw-button': {
    baseline: 'tests/config/raw-button.baseline.json',
    pattern: /<button(?=[\s>/])/g,
    unit: 'raw <button> element',
    fix: 'use UButton (ghost or soft, color neutral; DESIGN.md "Components", /ui Aktion entries) or the ListRow action row; a kept raw button needs a reason in the baseline',
  },
  'ui-prop': {
    baseline: 'tests/config/ui-prop.baseline.json',
    pattern: /(?<![\w:.-])(?::|v-bind:)?(?:[a-z]+-)*ui=(?=["'])/g,
    unit: ':ui binding',
    fix: 'move the visual identity into the app.config.ts theme or a token (DESIGN.md "Guards", epic #58 D1); the call-site ui prop only places a part',
  },
}

const FOLDERS = ['components', 'pages', 'layouts']

/** @param {string} dir @returns {string[]} */
function vueFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Shipped UI sources (prototypes and the error test page are not part of the kit), relative to `root`. @param {string} root */
export function uiSources(root) {
  const files = FOLDERS.flatMap(f => vueFiles(join(root, f)))
  if (existsSync(join(root, 'app.vue'))) files.push(join(root, 'app.vue'))
  return files.filter(f => !/error-test\.vue$|\/prototype\//.test(f)).map(f => relative(root, f))
}

/** HTML comments hold doc blocks that name `<button>` and `:ui`; they are not markup. @param {string} text */
const withoutComments = text => text.replace(/<!--[\s\S]*?-->/g, '')

/**
 * Per-file counts of one ratchet.
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {Record<string, number>}
 */
export function countRatchet(root, name) {
  const { pattern } = RATCHETS[name]
  /** @type {Record<string, number>} */
  const counts = {}
  for (const rel of uiSources(root)) {
    const n = (withoutComments(readFileSync(join(root, rel), 'utf8')).match(pattern) ?? []).length
    if (n > 0) counts[rel] = n
  }
  return counts
}

/**
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {Record<string, { count: number, reason: string }>}
 */
export function readRatchetBaseline(root, name) {
  const path = join(root, RATCHETS[name].baseline)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

/**
 * Findings of one ratchet: a file above its baseline, a baseline above the count, an entry without a reason.
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {string[]}
 */
export function checkRatchet(root, name) {
  const { baseline: file, unit, fix } = RATCHETS[name]
  const real = countRatchet(root, name)
  const base = readRatchetBaseline(root, name)
  /** @type {string[]} */
  const out = []
  for (const [path, n] of Object.entries(real)) {
    const limit = base[path]?.count ?? 0
    if (n > limit) out.push(`${path} has ${n} ${unit}${n === 1 ? '' : 's'}, the baseline allows ${limit}: ${fix}`)
  }
  for (const [path, entry] of Object.entries(base)) {
    const n = real[path] ?? 0
    if (entry.count > n) out.push(`${file}: ${path} has ${n} ${unit}${n === 1 ? '' : 's'}, the baseline says ${entry.count}; lower it (npm run ratchet:lower)`)
    if (!entry.reason || !entry.reason.trim()) out.push(`${file}: ${path} needs a reason (why it stays, or which issue removes it)`)
  }
  return out
}

/**
 * Rewrites every baseline down to the real counts. Never raises: a file above its baseline is reported and left alone.
 * @param {string} root
 * @returns {string[]} files above their baseline
 */
export function lowerRatchets(root) {
  /** @type {string[]} */
  const refused = []
  for (const name of /** @type {(keyof typeof RATCHETS)[]} */ (Object.keys(RATCHETS))) {
    const real = countRatchet(root, name)
    const base = readRatchetBaseline(root, name)
    /** @type {Record<string, { count: number, reason: string }>} */
    const next = {}
    for (const [path, entry] of Object.entries(base)) {
      const n = Math.min(real[path] ?? 0, entry.count)
      if (n > 0) next[path] = { count: n, reason: entry.reason }
    }
    for (const [path, n] of Object.entries(real)) if (n > (base[path]?.count ?? 0)) refused.push(`${name}: ${path} has ${n}, the baseline allows ${base[path]?.count ?? 0}`)
    writeFileSync(join(root, RATCHETS[name].baseline), `${JSON.stringify(next, null, 2)}\n`)
  }
  return refused
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  if (process.argv.includes('--update')) {
    const refused = lowerRatchets(root)
    for (const r of refused) console.log(`not raised: ${r}`)
    process.exit(refused.length > 0 ? 1 : 0)
  }
  const findings = /** @type {(keyof typeof RATCHETS)[]} */ (Object.keys(RATCHETS)).flatMap(n => checkRatchet(root, n))
  for (const f of findings) console.log(f)
  process.exit(findings.length > 0 ? 1 : 0)
}
