/**
 * @composable useOpenedOnce
 * @description Gate for a dialog whose code loads on first use (#288): `true` from the first moment the watched flag is
 * true and for good after, so the lazy component stays mounted (its close transition and focus return still run).
 * @responsibility One-way latch over a reactive flag. No UI.
 */
import { ref, watch, type WatchSource } from 'vue'

export function useOpenedOnce(isOpen: WatchSource<boolean>) {
  const opened = ref(false)
  watch(
    isOpen,
    (open) => {
      if (open) opened.value = true
    },
    { immediate: true, flush: 'sync' },
  )
  return opened
}
