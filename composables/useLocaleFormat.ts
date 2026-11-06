/**
 * @composable useLocaleFormat
 * @description Binds the pure helpers of `utils/localeFormat` to the active UI locale. The returned
 * functions read the reactive locale, so templates and computeds re-render on locale change.
 */
import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  compareText as compareTextFor,
  createTranslate,
  formatDateTime as formatDateTimeFor,
  formatDuration as formatDurationFor,
  formatDurationParts as formatDurationPartsFor,
  formatMinutesAgo as formatMinutesAgoFor,
  formatNumber as formatNumberFor,
  type DateTimePreset,
  type DurationStyle,
} from '~/utils/localeFormat'
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '~/utils/localeResolution'

export function useLocaleFormat() {
  const i18n = useI18n()
  const locale: ComputedRef<AppLocale> = computed(() => normalizeLocale(i18n.locale.value) ?? DEFAULT_LOCALE)
  const translate = createTranslate(i18n.t as (...args: never[]) => string)

  return {
    locale,
    formatDuration: (seconds: number | null | undefined, style: DurationStyle) =>
      formatDurationFor(seconds, style, translate),
    formatDurationParts: (seconds: number, style: 'clock' | 'clockRounded' | 'clockShort') =>
      formatDurationPartsFor(seconds, style, translate),
    formatDateTime: (value: Date | string | number, preset: DateTimePreset) =>
      formatDateTimeFor(value, locale.value, preset),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumberFor(value, locale.value, options),
    compareText: (a: string, b: string) => compareTextFor(a, b, locale.value),
    formatMinutesAgo: (minutes: number | null) => formatMinutesAgoFor(minutes, translate),
  }
}
