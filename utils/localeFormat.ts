/**
 * @module localeFormat
 * @description Pure, locale-aware formatting helpers (durations, dates, numbers, relative labels,
 * text collation). Every function takes the locale and/or a `Translate` function explicitly so it is
 * unit-testable; `composables/useLocaleFormat.ts` binds them to the active locale.
 *
 * The German output of every duration style is byte-identical to the formatters this module
 * replaced. Styles are named by output shape because the old copies were not interchangeable.
 */
import type { AppLocale } from '~/utils/localeResolution'

/** Translates `key`; `plural` selects the `a | b` branch of plural messages. */
export type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

/**
 * Duration output shapes (examples in German/English, identical):
 * - `spaced`:       `45s`, `1 min 1s`, `1 h 30 min` (zero/negative/null -> `0 min`)
 * - `compact`:      `45s`, `5min`, `1h 30min`
 * - `clock`:        `45 min`, `1 h`, `1:30 h`, `2:00 h` (minutes floored)
 * - `clockRounded`: like `clock`, minutes rounded to the nearest half minute first
 * - `clockShort`:   `45 min`, `2 h`, `1:30 h` (minutes rounded, never negative)
 */
export type DurationStyle = 'spaced' | 'compact' | 'clock' | 'clockRounded' | 'clockShort'

type ClockStyle = Extract<DurationStyle, 'clock' | 'clockRounded' | 'clockShort'>

/**
 * Date/time shapes (mirror the former `Intl` option objects):
 * - `dayMonthYearTime`: `05.03.2024, 14:07`
 * - `dayMonthYear`:     `05.03.2024`
 * - `dayMonth`:         `05.03.`
 * - `mediumDateShortTime`, `shortDateShortTime`: `dateStyle` + `timeStyle`
 * - `longDateUtc`:      `5. März 2024`, always interpreted in UTC (date-only Notion values)
 */
export type DateTimePreset =
  | 'dayMonthYearTime'
  | 'dayMonthYear'
  | 'dayMonth'
  | 'mediumDateShortTime'
  | 'shortDateShortTime'
  | 'longDateUtc'

const DATE_TIME_OPTIONS: Record<DateTimePreset, Intl.DateTimeFormatOptions> = {
  dayMonthYearTime: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  dayMonthYear: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dayMonth: { day: '2-digit', month: '2-digit' },
  mediumDateShortTime: { dateStyle: 'medium', timeStyle: 'short' },
  shortDateShortTime: { dateStyle: 'short', timeStyle: 'short' },
  longDateUtc: { dateStyle: 'long', timeZone: 'UTC' },
}

/**
 * Adapts a vue-i18n `t` function (`t(key, named)` / `t(key, plural, { named })`) to {@link Translate}.
 */
export function createTranslate(t: (...args: never[]) => string): Translate {
  const call = t as unknown as (...args: unknown[]) => string
  return (key, named, plural) => {
    if (plural !== undefined) return call(key, plural, { named: named ?? {} })
    return named ? call(key, named) : call(key)
  }
}

const pad2 = (n: number): string => n.toString().padStart(2, '0')

/** `{ value, unit }` for the clock styles, e.g. `1:30` + `h` or `45` + `min`. */
export function formatDurationParts(
  seconds: number,
  style: ClockStyle,
  t: Translate,
): { value: string; unit: string } {
  const hourUnit = t('duration.unitHour')
  const minuteUnit = t('duration.unitMinute')

  if (style === 'clockShort') {
    const totalMinutes = Math.max(0, Math.round(seconds / 60))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours >= 1 && minutes === 0) return { value: `${hours}`, unit: hourUnit }
    if (hours >= 1) return { value: `${hours}:${pad2(minutes)}`, unit: hourUnit }
    return { value: `${totalMinutes}`, unit: minuteUnit }
  }

  const totalMinutes = style === 'clockRounded' ? Math.round(seconds / 30) / 2 : Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.round(totalMinutes % 60)
  if (hours > 1) return { value: `${hours}:${pad2(minutes)}`, unit: hourUnit }
  if (hours === 1 && minutes === 0) return { value: '1', unit: hourUnit }
  if (hours === 1) return { value: `1:${pad2(minutes)}`, unit: hourUnit }
  return { value: `${minutes}`, unit: minuteUnit }
}

/** Formats a duration in seconds in the given output shape. */
export function formatDuration(
  seconds: number | null | undefined,
  style: DurationStyle,
  t: Translate,
): string {
  const h = t('duration.unitHour')
  const min = t('duration.unitMinute')
  const s = t('duration.unitSecond')

  switch (style) {
    case 'spaced': {
      if (!seconds || seconds < 0) return `0 ${min}`
      const total = Math.round(seconds)
      if (total < 60) return `${total}${s}`
      const hours = Math.floor(total / 3600)
      const rest = total % 3600
      const minutes = Math.floor(rest / 60)
      const remainder = rest % 60
      const parts: string[] = []
      if (hours > 0) parts.push(`${hours} ${h}`)
      if (minutes > 0) parts.push(`${minutes} ${min}`)
      if (remainder > 0 && hours === 0) parts.push(`${remainder}${s}`)
      return parts.length === 0 ? `0 ${min}` : parts.join(' ')
    }
    case 'compact': {
      const value = seconds ?? 0
      if (value < 60) return `${value}${s}`
      if (value < 3600) return `${Math.round(value / 60)}${min}`
      const hours = Math.floor(value / 3600)
      const minutes = Math.round((value % 3600) / 60)
      return minutes > 0 ? `${hours}${h} ${minutes}${min}` : `${hours}${h}`
    }
    default: {
      const { value, unit } = formatDurationParts(seconds ?? 0, style, t)
      return `${value} ${unit}`
    }
  }
}

/**
 * Formats a date/time. Unparsable input yields `"Invalid Date"` (as `toLocale*String` did).
 * @param timeZone - overrides the preset's zone (tests); `longDateUtc` is always UTC otherwise
 */
export function formatDateTime(
  value: Date | string | number,
  locale: AppLocale,
  preset: DateTimePreset,
  timeZone?: string,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid Date'
  const options = timeZone ? { ...DATE_TIME_OPTIONS[preset], timeZone } : DATE_TIME_OPTIONS[preset]
  return new Intl.DateTimeFormat(locale, options).format(date)
}

/** Formats a number with the locale's grouping and decimal separators. */
export function formatNumber(value: number, locale: AppLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

/** Locale-aware string comparison for `Array.prototype.sort`. */
export function compareText(a: string, b: string, locale: AppLocale): number {
  return a.localeCompare(b, locale)
}

/** "Updated N minutes ago" style label for the last sync; `null` means never synced. */
export function formatMinutesAgo(minutes: number | null, t: Translate): string {
  if (minutes === null) return t('relative.notUpdatedYet')
  if (minutes < 1) return t('relative.justUpdated')
  return t('relative.updatedMinutesAgo', { n: minutes }, minutes)
}
