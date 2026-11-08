import { ref } from 'vue';
import type { TaskStatus } from '~/types/taskStatus';

/**
 * Which stacks are expanded (#147), per column and group key. In memory only, never persisted:
 * a reload shows every stack collapsed. Module-level, so the column that renders the members and
 * useBoardDndKit (the drop index maps against the rendered order) read the same state, and it
 * survives a column re-mounting or a sync updating its tasks.
 *
 * BoardColumn keeps it honest: a group that drops below two tasks is pruned, and all groups of a
 * column are cleared when grouping is turned off or its key changes.
 *
 * Expansion survives a mobile tab switch on purpose. The tab changes while a card is being dragged
 * (the edge-scroll column switch, Board.vue `fireEdgeScroll`), and collapsing a stack then would
 * shift the layout under the dragged card.
 */
const expandedByStatus = ref<Record<number, string[]>>({});

/**
 * Armed by a pointer expand, so the rest of that click sequence cannot open a sheet: a double-click
 * (or double-tap) on a collapsed stack expands it with the first click, and the second click lands on
 * the first member (a card opens on click, #25). Event-scoped, no timer: see `shouldBlockModal`.
 */
let postExpandArmed = false;

/** A new click sequence (mousedown with detail < 2) ends the guard; the expanding click's own mousedown came before arming */
function onMouseDownCapture(event: MouseEvent) {
  if (event.detail < 2) disarmPostExpand();
}

function armPostExpand() {
  if (postExpandArmed || typeof document === 'undefined') return;
  postExpandArmed = true;
  document.addEventListener('mousedown', onMouseDownCapture, true);
}

function disarmPostExpand() {
  if (!postExpandArmed) return;
  postExpandArmed = false;
  document.removeEventListener('mousedown', onMouseDownCapture, true);
}

/** Text for the board's polite live region: stacks opening and closing (one region, see Board.vue) */
const stackAnnouncement = ref('');

export function useStackExpansion() {
  /** Group keys expanded in the column of `status`, in the order they were opened */
  function expandedKeys(status: TaskStatus): string[] {
    return expandedByStatus.value[status] ?? [];
  }

  function isExpanded(status: TaskStatus, groupKey: string): boolean {
    return expandedKeys(status).includes(groupKey);
  }

  /**
   * Expands a group. A pointer expand also arms the post-expand sheet guard (the rest of a
   * double-click must not open a member's sheet); a keyboard expand never does.
   */
  function expand(status: TaskStatus, groupKey: string, source: 'pointer' | 'keyboard') {
    if (isExpanded(status, groupKey)) return;
    expandedByStatus.value = { ...expandedByStatus.value, [status]: [...expandedKeys(status), groupKey] };
    if (source === 'pointer') armPostExpand();
  }

  function collapse(status: TaskStatus, groupKey: string) {
    if (!isExpanded(status, groupKey)) return;
    disarmPostExpand();
    expandedByStatus.value = {
      ...expandedByStatus.value,
      [status]: expandedKeys(status).filter(key => key !== groupKey),
    };
  }

  /** Collapses every group of a column; returns the keys that were expanded */
  function collapseAll(status: TaskStatus): string[] {
    const keys = expandedKeys(status);
    if (keys.length === 0) return [];
    disarmPostExpand();
    expandedByStatus.value = { ...expandedByStatus.value, [status]: [] };
    return keys;
  }

  /** Drops the expanded keys that are no longer a stack (`stackKeys`: the groups of 2+ tasks) */
  function prune(status: TaskStatus, stackKeys: readonly string[]) {
    const keys = expandedKeys(status);
    const kept = keys.filter(key => stackKeys.includes(key));
    if (kept.length === keys.length) return;
    expandedByStatus.value = { ...expandedByStatus.value, [status]: kept };
  }

  /** Test helper: forgets every expansion */
  function reset() {
    expandedByStatus.value = {};
    disarmPostExpand();
  }

  /**
   * Whether opening a sheet for `event` belongs to the click that expanded a stack: the guard is
   * armed and the event is the second (or later) click of a sequence (`detail >= 2`). Enter on a
   * member dispatches a synthetic click with `detail` 0, which is never blocked.
   */
  function shouldBlockModal(event: MouseEvent) {
    return postExpandArmed && event.detail >= 2;
  }

  /**
   * Announces `message` through the board's live region. An identical message is cleared first,
   * so opening the same stack twice is read twice.
   */
  function announceStack(message: string) {
    if (stackAnnouncement.value === message) stackAnnouncement.value = '';
    void Promise.resolve().then(() => {
      stackAnnouncement.value = message;
    });
  }

  return {
    expandedKeys,
    isExpanded,
    expand,
    collapse,
    collapseAll,
    prune,
    reset,
    shouldBlockModal,
    stackAnnouncement,
    announceStack,
  };
}
