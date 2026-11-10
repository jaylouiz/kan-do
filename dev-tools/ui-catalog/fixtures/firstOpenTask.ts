import type { CatalogFixture } from '../useCatalog'
import { useTasksStore } from '~/store/tasks'

/** The id of the first Offen task of the sample's demo board (host `board`: the sample's own tasks store). */
const fixture: CatalogFixture = () => ({ taskId: useTasksStore().tasksOpen[0]?.id ?? null })
export default fixture
