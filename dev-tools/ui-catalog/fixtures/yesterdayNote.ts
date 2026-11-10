import type { CatalogFixture } from '../useCatalog'
import { demoBoardToday } from '../fixtureData'

/** Three tasks done yesterday evening: the demo board's one, plus two more of its done titles moved to yesterday. */
const fixture: CatalogFixture = () => {
  const { tasks } = demoBoardToday()
  const yesterday = tasks.find(task => task.completedAt && task.status === 3 && task.completedAt.getDate() !== new Date().getDate())
  if (!yesterday) return { tasks: [] }
  const others = tasks.filter(task => task.status === 3 && task !== yesterday).slice(0, 2)
  return { tasks: [yesterday, ...others.map((task, index) => ({ ...task, id: `${task.id}-y${index}`, completedAt: yesterday.completedAt }))] }
}
export default fixture
