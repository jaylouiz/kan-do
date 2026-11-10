import type { CatalogFixture } from '../useCatalog'
import { demoReview } from '../fixtureData'

/** The weekly points of the demo review (`WeekPoint` holds Dates, which an entry cannot). */
const fixture: CatalogFixture = () => ({ weeks: demoReview().weeks })
export default fixture
