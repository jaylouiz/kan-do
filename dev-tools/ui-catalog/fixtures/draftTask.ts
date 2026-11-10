import { onBeforeUnmount } from 'vue'
import type { CatalogFixture } from '../useCatalog'
import { useTaskDraft } from '~/composables/useTaskDraft'

/** Starts a draft in Offen with a title (the draft is module state, so it is dropped again when the sample leaves). */
const fixture: CatalogFixture = () => {
  const draft = useTaskDraft()
  draft.startDraft()
  draft.updateDraft({ title: 'Angebot Familie Hoffmann', topic: 'Angebote' })
  onBeforeUnmount(() => draft.clearDraft())
  return {}
}
export default fixture
