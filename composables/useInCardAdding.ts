/**
 * @composable useInCardAdding
 * @description True while an in-card new-task form (NewCardFlow, #649) is open on the board
 * @responsibility
 * - One shared signal so the focus overlay (#394) can step aside: it would dim the form being typed in (kd#56)
 * - Singleton, module-level state like `useTaskDraft`; a counter, so two slots opening and closing in
 *   any order never leave it stuck
 * - `trackInCardAdding(open)` is called by AddTaskSlot with its own flow state and releases its claim on unmount
 */
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue';

const openCount = ref(0);

/** True while at least one in-card form is open */
export const inCardAdding = computed(() => openCount.value > 0);

/** Counts `open` into the shared signal for the lifetime of the calling component */
export function trackInCardAdding(open: Ref<boolean>) {
  let counted = false;
  const set = (value: boolean) => {
    if (value === counted) return;
    counted = value;
    openCount.value += value ? 1 : -1;
  };
  watch(open, set, { immediate: true });
  if (getCurrentInstance()) onBeforeUnmount(() => set(false));
}
