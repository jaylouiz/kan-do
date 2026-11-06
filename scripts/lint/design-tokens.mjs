// @ts-check
/**
 * Token-use checks for the styling sources (assets/, components/, pages/, layouts/, app.vue), the kan-do counterpart
 * of a framework's theme-API check: Tailwind and Nuxt UI accept any class or `var()` name silently, so a misspelt or
 * foreign token (`text-muted-foreground` from shadcn, `var(--ui-text-dim)`) renders nothing and no other check notices.
 *
 * - `projectCssClasses(root)`: every class selector the project's own CSS defines (assets/css and `.vue` <style>
 *   blocks). `eslint.config.mjs` passes them, with every class that does not look like a utility, to
 *   `better-tailwindcss/no-unknown-classes` as ignores, so the rule reports only utility-shaped classes that neither
 *   Tailwind, Nuxt UI nor the project defines.
 * - `checkCssVars(root, files)`: every `var(--x)` in CSS must resolve to a custom property defined by the project's
 *   CSS, a runtime style binding, Tailwind's theme or Nuxt UI. A fallback (`var(--x, 1rem)`) does not excuse it: the
 *   token is fiction and the value silently comes from the fallback. Dynamic names (`var(--topic-${key})`) are
 *   skipped. A role check (`--ui-text-*` only on `color`) was tried and dropped: the board uses text tokens for
 *   indicator bars and borders on purpose (dnd.css, ColumnDropZone), so it only produced noise.
 *
 * Runs per edit (`.claude/hooks/eslint-file.sh` calls `node scripts/lint/design-tokens.mjs <file>`), in `npm run lint`
 * (the ESLint rule) and in `npm run verify` (`tests/config/design-tokens.test.ts` over every source file).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIRS = ['assets', 'components', 'pages', 'layouts']
const SOURCE_FILES = ['app.vue', 'app.config.ts']
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'prototype'])

/**
 * Styling source files below `root` (`.css`, `.vue`, plus `app.config.ts`).
 * @param {string} root
 * @returns {string[]}
 */
export function styleSources(root) {
  /** @type {string[]} */
  const files = []
  /** @param {string} dir */
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(path)
      }
      else if (/\.(css|vue)$/.test(name)) files.push(path)
    }
  }
  for (const dir of SOURCE_DIRS) walk(join(root, dir))
  for (const file of SOURCE_FILES) if (existsSync(join(root, file))) files.push(join(root, file))
  return files.sort()
}

/** Comments blanked out with their newlines kept, so offsets still map to the right line. */
/** @param {string} text */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (/** @type {string} */ m) => m.replace(/[^\n]/g, ' '))
/**
 * The CSS of a source file: a `.vue` file's <style> blocks, a `.css` file whole.
 * @param {string} file
 */
function cssOf(file) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return stripComments(text)
  // Everything outside <style> blanked out (newlines kept), so a declaration's offset is its line in the file.
  if (file.endsWith('.vue')) {
    let out = ''
    let last = 0
    for (const m of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g)) {
      const open = m[1] ?? ''
      const body = m[2] ?? ''
      const start = (m.index ?? 0) + open.length
      out += text.slice(last, start).replace(/[^\n]/g, ' ') + body
      last = start + body.length
    }
    return stripComments(out + text.slice(last).replace(/[^\n]/g, ' '))
  }
  return ''
}

/**
 * Class names the project's own CSS defines (`.name` in any selector).
 * @param {string} root
 * @returns {string[]}
 */
export function projectCssClasses(root) {
  /** @type {Set<string>} */
  const names = new Set()
  for (const file of styleSources(root)) {
    for (const match of cssOf(file).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (match[1]) names.add(match[1])
  }
  return [...names].sort()
}

/**
 * A class that does not start with a Tailwind utility root (after variants and `!`) is a component or marker class
 * (`task-card`, `is-on`, `more-panel`) and not the rule's business; the rule checks only utility-shaped classes.
 */
export const NON_UTILITY_CLASS = '^(?!(?:[\\w-]+:)*!?-?(?:text|bg|border|ring|outline|font|tracking|leading|shadow|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|p[xytrblse]?|m[xytrblse]?|gap|space|w|h|size|min|max|inset|top|left|right|bottom|start|end|z|opacity|rounded|scrollbar|grid|col|row|flex|basis|grow|shrink|items|justify|self|place|content|order|translate|scale|rotate|skew|origin|transition|duration|ease|delay|animate|cursor|select|overflow|truncate|line-clamp|aspect|object|backdrop|blur|brightness|contrast|grayscale|invert|saturate|sepia|drop-shadow|filter|sr-only|not-sr-only|underline|overline|uppercase|lowercase|capitalize|italic|whitespace|break|hyphens|list|table|appearance|pointer-events|resize|scroll|snap|touch|will-change|block|inline|hidden|visible|invisible|static|fixed|absolute|relative|sticky|isolate|container|columns|float|clear|box|indent|align|tabular-nums|antialiased|subpixel-antialiased|mix-blend|bg-blend|field-sizing)(?:-|$))'

/**
 * Custom properties a Tailwind theme or Nuxt UI defines (read from their stylesheets in node_modules).
 * @param {string} root
 */
function libraryVars(root) {
  /** @type {Set<string>} */
  const names = new Set()
  const sheets = [
    'node_modules/tailwindcss/theme.css',
    'node_modules/@nuxt/ui/dist/runtime/index.css',
    '.nuxt/ui.css',
  ]
  for (const sheet of sheets) {
    const path = join(root, sheet)
    if (existsSync(path)) for (const m of readFileSync(path, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) if (m[1]) names.add(m[1])
  }
  return names
}
/** Nuxt UI writes the colour aliases at runtime from `app.config.ts` (`--ui-primary`, `--ui-color-<name>-<step>`); the
 * text, bg and border roles are declared in its stylesheet and checked by name. */
const RUNTIME_PREFIXES = [/^--ui-color-[a-z]+-(50|[1-9]00|950)$/, /^--ui-(primary|secondary|success|info|warning|error|neutral)$/]

/** Custom properties the project defines: CSS declarations, `@theme` entries and style bindings in templates/scripts. */
/**
 * @param {string} root
 * @param {string[]} [extraFiles]
 */
function projectVars(root, extraFiles = []) {
  /** @type {Set<string>} */
  const names = new Set()
  /** @param {string} text */
  const addBindings = (text) => { for (const m of text.matchAll(/['"`](--[\w-]+)['"`]/g)) if (m[1]) names.add(m[1]) }
  for (const file of [...styleSources(root), ...extraFiles.filter(f => existsSync(f))]) {
    const text = readFileSync(file, 'utf8')
    for (const m of cssOf(file).matchAll(/(--[\w-]+)\s*:/g)) if (m[1]) names.add(m[1])
    // `:style="{ '--stack-h': … }"`, `style.setProperty('--x', …)`, `{ '--x': value }` in scripts and templates
    addBindings(text)
  }
  for (const dir of ['composables', 'lib', 'utils', 'plugins']) {
    /** @param {string} d */
    const walk = (d) => {
      if (!existsSync(d)) return
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|js|vue)$/.test(n)) addBindings(readFileSync(p, 'utf8'))
      }
    }
    walk(join(root, dir))
  }
  return names
}

/**
 * @param {string} root checkout root
 * @param {string[]} [files] files to check (default: every styling source)
 * @returns {{ file: string, line: number, message: string }[]}
 */
export function checkCssVars(root, files = styleSources(root)) {
  const known = new Set([...libraryVars(root), ...projectVars(root, files)])
  const findings = []
  for (const file of files) {
    if (!/\.(css|vue)$/.test(file) || !existsSync(file)) continue
    const css = cssOf(file)
    const lineOf = (/** @type {number} */ index) => css.slice(0, index).split('\n').length
    for (const use of css.matchAll(/var\((--[\w-]+)(\$\{)?/g)) {
      const name = use[1] ?? ''
      if (use[2] || name.endsWith('-')) continue // dynamic name
      if (known.has(name) || RUNTIME_PREFIXES.some(re => re.test(name))) continue
      findings.push({ file, line: lineOf(use.index ?? 0), message: `var(${name}) is not defined by the project's CSS, Tailwind's theme or Nuxt UI (misspelt or foreign token?)` })
    }
  }
  return findings
}

// CLI: `node scripts/lint/design-tokens.mjs [files...]` (default: every styling source); exit 1 on findings.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  const files = process.argv.slice(2).map(f => resolve(f))
  const findings = checkCssVars(root, files.length > 0 ? files : undefined)
  for (const f of findings) console.log(`${relative(root, f.file)}:${f.line} ${f.message}`)
  process.exit(findings.length > 0 ? 1 : 0)
}
