/**
 * @module topicStyles
 * @description The fixed palette behind a topic's mark (#431): nine hues and 24 Phosphor fill glyphs, and the
 * mapping from the colour a source gave a topic onto the nearest hue. Pure data and functions; the user's choice
 * per topic name lives in `store/topicStyles.ts`, the resolver in `useTopicColor`, the rendering in `TopicMark`.
 *
 * Symbols are stored as a key (`briefcase`), never as an icon class, so the set can change later. The 24 class
 * names are literals on purpose: the icon bundler only sees string literals (desktop CSP, ADR 012), never a
 * template string.
 */

export const HUES = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type TopicHue = (typeof HUES)[number]

export interface TopicSymbol {
  key: string
  /** The Phosphor fill-weight icon class (literal, see the module note). */
  icon: string
  /** i18n key of the glyph's accessible label. */
  labelKey: string
}

export const TOPIC_SYMBOLS: readonly TopicSymbol[] = [
  { key: 'briefcase', icon: 'i-ph-briefcase-fill', labelKey: 'topic.symbol.briefcase' },
  { key: 'house', icon: 'i-ph-house-fill', labelKey: 'topic.symbol.house' },
  { key: 'graduation-cap', icon: 'i-ph-graduation-cap-fill', labelKey: 'topic.symbol.graduation-cap' },
  { key: 'code', icon: 'i-ph-code-fill', labelKey: 'topic.symbol.code' },
  { key: 'palette', icon: 'i-ph-palette-fill', labelKey: 'topic.symbol.palette' },
  { key: 'chat-circle', icon: 'i-ph-chat-circle-fill', labelKey: 'topic.symbol.chat-circle' },
  { key: 'shopping-cart', icon: 'i-ph-shopping-cart-fill', labelKey: 'topic.symbol.shopping-cart' },
  { key: 'heart', icon: 'i-ph-heart-fill', labelKey: 'topic.symbol.heart' },
  { key: 'airplane', icon: 'i-ph-airplane-fill', labelKey: 'topic.symbol.airplane' },
  { key: 'currency-eur', icon: 'i-ph-currency-eur-fill', labelKey: 'topic.symbol.currency-eur' },
  { key: 'wrench', icon: 'i-ph-wrench-fill', labelKey: 'topic.symbol.wrench' },
  { key: 'lightbulb', icon: 'i-ph-lightbulb-fill', labelKey: 'topic.symbol.lightbulb' },
  { key: 'calendar', icon: 'i-ph-calendar-fill', labelKey: 'topic.symbol.calendar' },
  { key: 'users', icon: 'i-ph-users-fill', labelKey: 'topic.symbol.users' },
  { key: 'book-open', icon: 'i-ph-book-open-fill', labelKey: 'topic.symbol.book-open' },
  { key: 'music-note', icon: 'i-ph-music-note-fill', labelKey: 'topic.symbol.music-note' },
  { key: 'barbell', icon: 'i-ph-barbell-fill', labelKey: 'topic.symbol.barbell' },
  { key: 'camera', icon: 'i-ph-camera-fill', labelKey: 'topic.symbol.camera' },
  { key: 'envelope', icon: 'i-ph-envelope-fill', labelKey: 'topic.symbol.envelope' },
  { key: 'star', icon: 'i-ph-star-fill', labelKey: 'topic.symbol.star' },
  { key: 'flag', icon: 'i-ph-flag-fill', labelKey: 'topic.symbol.flag' },
  { key: 'leaf', icon: 'i-ph-leaf-fill', labelKey: 'topic.symbol.leaf' },
  { key: 'rocket-launch', icon: 'i-ph-rocket-launch-fill', labelKey: 'topic.symbol.rocket-launch' },
  { key: 'gear', icon: 'i-ph-gear-fill', labelKey: 'topic.symbol.gear' },
]

/** What the user chose for a topic name. Either field may be null; both null means no entry at all. */
export interface TopicStyle {
  hue: TopicHue | null
  symbol: string | null
}

const HUE_SET: ReadonlySet<string> = new Set(HUES)

export function isHue(value: unknown): value is TopicHue {
  return typeof value === 'string' && HUE_SET.has(value)
}

/** The symbol for a stored key, or `undefined` for an unknown one (hand-edited or from a future version). */
export function symbolOf(key: unknown): TopicSymbol | undefined {
  return typeof key === 'string' ? TOPIC_SYMBOLS.find(symbol => symbol.key === key) : undefined
}

/**
 * The hue for the colour a source gave a topic: Notion's names map 1:1 (`default` is gray), a `#rrggbb` /
 * `#rgb` hex maps to the nearest hue by angle (near-grey is gray, dark orange is brown), anything else is `null`.
 */
export function hueOfSourceColor(code: string | null | undefined): TopicHue | null {
  if (!code) return null
  const color = code.trim().toLowerCase()
  if (color === 'default') return 'gray'
  if (isHue(color)) return color
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(color)
  if (!match) return null
  const digits = match[1]!.length === 3 ? [...match[1]!].map(d => d + d) : (match[1]!.match(/../g) ?? [])
  const [r, g, b] = digits.map(d => Number.parseInt(d, 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta < 0.08) return 'gray'
  let angle = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  angle = (angle * 60 + 360) % 360
  if (angle < 20 || angle >= 340) return 'red'
  if (angle < 40) return max < 0.6 ? 'brown' : 'orange'
  if (angle < 70) return 'yellow'
  if (angle < 170) return 'green'
  if (angle < 255) return 'blue'
  if (angle < 320) return 'purple'
  return 'pink'
}
