import type { CatalogFixture } from '../useCatalog'

/** The Thema and Aktivität lists show the value itself. */
const fixture: CatalogFixture = () => ({ optionLabel: (value: string) => value })
export default fixture
