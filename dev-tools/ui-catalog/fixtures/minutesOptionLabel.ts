import type { CatalogFixture } from '../useCatalog'

/** What a value reads as in the Timebox step ("30 min"); the Thema and Aktivität lists show the value itself. */
const fixture: CatalogFixture = () => ({ optionLabel: (value: string) => `${value} min` })
export default fixture
