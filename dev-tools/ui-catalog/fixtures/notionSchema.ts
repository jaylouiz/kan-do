import type { CatalogFixture } from '../useCatalog'
import { demoNotionSchema } from '../fixtureData'

/** The database schema a Notion wizard step reads its property options from. */
const fixture: CatalogFixture = () => ({ databaseSchema: demoNotionSchema() })
export default fixture
