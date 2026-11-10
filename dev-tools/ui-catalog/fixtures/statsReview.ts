import type { CatalogFixture } from '../useCatalog'
import { demoReview } from '../fixtureData'

/** The whole review of the demo board (`Review` holds Dates and baselines). */
const fixture: CatalogFixture = () => ({ review: demoReview() })
export default fixture
