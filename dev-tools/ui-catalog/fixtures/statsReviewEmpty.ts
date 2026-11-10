import type { CatalogFixture } from '../useCatalog'
import { FIXTURE_NOW } from '../fixtureData'
import { deriveReview } from '~/lib/statisticsReview'

/** A review without any completed task: the verdict's empty state. */
const fixture: CatalogFixture = () => ({ review: deriveReview([], FIXTURE_NOW, {}) })
export default fixture
