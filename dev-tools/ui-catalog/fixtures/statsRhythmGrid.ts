import type { CatalogFixture } from '../useCatalog'
import { demoRhythm } from '../fixtureData'

/** The demo board's work rhythm with the weekday labels `StatsTiles` builds for it (Monday first). */
const fixture: CatalogFixture = ({ locale }) => {
  const rhythm = demoRhythm()
  const day = (weekday: number): Date => new Date(2026, 10, 2 + weekday)
  return {
    rhythm,
    weekdayLabels: Array.from({ length: 7 }, (_, weekday) => day(weekday).toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '')),
    longestName: rhythm.longestWeekday === null ? null : day(rhythm.longestWeekday).toLocaleDateString(locale, { weekday: 'long' }),
  }
}
export default fixture
