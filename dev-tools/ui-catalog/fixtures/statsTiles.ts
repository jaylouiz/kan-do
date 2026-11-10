import type { CatalogFixture } from '../useCatalog'
import { demoReview, demoRhythm } from '../fixtureData'

/** The review and the work rhythm of the demo board, as `/statistics` hands them to the tiles. */
const fixture: CatalogFixture = () => ({ review: demoReview(), rhythm: demoRhythm() })
export default fixture
