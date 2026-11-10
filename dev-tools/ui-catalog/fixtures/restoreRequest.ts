import type { CatalogFixture } from '../useCatalog'

/** A restore request whose `run` does nothing: confirming in the sample replaces no data. */
const fixture: CatalogFixture = () => ({
  request: {
    title: 'Sicherung wiederherstellen?',
    sourceLabel: 'Sicherung vom 8. November',
    sourceCount: 42,
    run: () => Promise.resolve(),
  },
})
export default fixture
