/**
 * Style fingerprint of the `/ui` catalog samples (#66, epic #58 D3): the computed styles of each sample's root
 * element, written to `tests/e2e/snapshots/ui-catalog.styles.json` and diffed against it. It records what the browser
 * resolves (colour, background, font, size, radius, shadow, padding, border, outline), never a pixel box, so it holds on
 * macOS and Linux alike and runs in CI against the flagged E2E build. Pixel baselines stay macOS-local.
 */

/** The computed properties recorded per sample (kebab-case CSS names). Boxes (width, height, margin, position) are left out on purpose. */
export const FINGERPRINT_PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration-line',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-width',
  'outline-style',
  'outline-color',
  'outline-offset',
  'opacity',
  'cursor',
  'gap',
  'min-height',
  'min-width',
] as const

export type Fingerprint = Record<string, Record<string, string>>

/** One line per sample, keys sorted: a changed token shows up as the samples it touches in a diff. */
export function serializeFingerprint(fingerprint: Fingerprint): string {
  const lines = Object.keys(fingerprint).sort().map(key => `  ${JSON.stringify(key)}: ${JSON.stringify(fingerprint[key])}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

/**
 * Differences between the recorded and the measured fingerprint, as readable lines: a sample that appeared or vanished,
 * a property whose value changed. `[]` when they match.
 */
export function diffFingerprint(expected: Fingerprint, actual: Fingerprint): string[] {
  const problems: string[] = []
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) problems.push(`${key}: sample is gone`)
  }
  for (const key of Object.keys(actual)) {
    const before = expected[key]
    if (!before) {
      problems.push(`${key}: new sample`)
      continue
    }
    for (const property of new Set([...Object.keys(before), ...Object.keys(actual[key]!)])) {
      if (before[property] !== actual[key]![property]) problems.push(`${key} ${property}: ${before[property]} -> ${actual[key]![property]}`)
    }
  }
  return problems
}
