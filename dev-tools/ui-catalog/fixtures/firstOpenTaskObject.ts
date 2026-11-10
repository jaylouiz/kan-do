import type { CatalogFixture } from '../useCatalog'
import { useTasksStore } from '~/store/tasks'

/** The first Offen task of the sample's demo board as the `task` prop (host `board`). */
const fixture: CatalogFixture = () => ({ task: useTasksStore().tasksOpen[0] })
export default fixture
