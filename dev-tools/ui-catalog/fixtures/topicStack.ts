import type { CatalogFixture } from '../useCatalog'
import { useTasksStore } from '~/store/tasks'

/** The three Offen tasks of the topic "Baustelle Müller" in the sample's demo board (host `board`), as one stack. */
const fixture: CatalogFixture = () => ({ tasks: useTasksStore().tasksOpen.filter(task => task.topic === 'Baustelle Müller') })
export default fixture
