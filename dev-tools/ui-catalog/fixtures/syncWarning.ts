import type { CatalogFixture } from '../useCatalog'
import { FIXTURE_NOW } from '../fixtureData'

/** The last merged sync of the source, a day before `FIXTURE_NOW`. */
const fixture: CatalogFixture = () => ({ lastSyncTimestamp: new Date(FIXTURE_NOW.getTime() - 24 * 3_600_000) })
export default fixture
