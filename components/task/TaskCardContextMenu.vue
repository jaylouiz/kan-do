<!--
@component TaskCardContextMenu
@kind component
@category overlay
@description Wraps TaskCard with a context menu for quick task actions.
  On desktop: right-click opens the menu via the native contextmenu event.
  On touch (phone width, tablets): the card's corner menu button (#296, rendered by TaskCard from the opener this
  component provides) opens it anchored at the button; a press-and-hold opens nothing, it belongs to the drag, and
  the touch contextmenu event (Android fires one after a hold) is swallowed.
  Keyboard: the ContextMenu key or Shift+F10 on the focused card (its `.task-wrapper`, a parent of this
  component) opens the menu at the card; on close focus returns to the card (kd#23), or to the button when it opened the menu.
  If a drag starts while the menu is open it is closed immediately.
@usage Used in BoardColumn to provide the right-click / corner-button menu on task cards
@avoid Only wraps TaskCard for the right-click / corner-button menu; not for stack headers or other rows.
@responsibility
- Provides context menu with task actions (status, timebox, delete, etc.)
- Handles custom timebox modal
- Delegates task operations to composables
-->
<template>
  <UContextMenu
    v-model:open="isOpen"
    :items="menuItems"
    :ui="contextMenuUi"
    size="md"
    :content="{ collisionPadding: 8 }"
    :press-open-delay="NEVER_MS"
  >
    <!--
      Inner wrapper: contextmenu is intercepted on touch (a hold never opens the menu, #296);
      on mouse it bubbles through to UContextMenu as normal.
    -->
    <div
      ref="wrapperEl"
      @pointerdown="handleWrapperPointerDown"
      @contextmenu="handleContextMenu"
    >
      <slot />
    </div>
  </UContextMenu>

  <!-- Custom timebox modal -->
  <AppDialog
    v-model:open="showTimeboxModal"
    :title="t('task.contextMenu.setTimebox')"
    size="sm"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-body text-muted">
          {{ t('task.contextMenu.customPrompt') }}
        </p>
        <div class="flex items-center gap-3">
          <UInput
            v-model="customTimeboxMinutes"
            type="number"
            placeholder="25"
            :min="1"
            :max="480"
            autofocus
            class="w-24"
            @keyup.enter="applyCustomTimebox"
          />
          <span class="text-sm text-muted">{{ t('task.contextMenu.minutesUnit') }}</span>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="() => { showTimeboxModal = false; }"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        size="lg"
        color="primary"
        :disabled="!isValidTimebox"
        @click="applyCustomTimebox"
      >
        {{ t('common.apply') }}
      </UButton>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import AppDialog from '~/components/ui/AppDialog.vue';
import { ref, computed, toRef, watch, nextTick, onMounted, onBeforeUnmount, provide } from "vue";
import { useI18n } from "vue-i18n";
import type { Task } from "~/types/task";
import { useTaskContextMenu } from "~/composables/useTaskContextMenu";
import { TASK_CARD_MENU_KEY } from "~/lib/taskCardMenu";
import { useBoardDragState } from "~/composables/useBoardDragState";

defineOptions({ name: "TaskCardContextMenu" });

const { t } = useI18n();

/**
 * Props for TaskCardContextMenu component.
 */
const props = defineProps<{
  /** The task object to show context menu for */
  task: Task;
}>();

const emit = defineEmits<{
  /** Emitted when task is deleted */
  deleted: [taskId: string];
}>();

// Programmatic open state — shared between desktop (contextmenu event), the corner button and the keyboard.
// UContextMenu is driven by this ref via v-model:open.
const isOpen = ref(false);

// Custom timebox modal state
const showTimeboxModal = ref(false);
const customTimeboxMinutes = ref<number | undefined>(undefined);

const isValidTimebox = computed(() => {
  const val = customTimeboxMinutes.value;
  return val !== undefined && val >= 1 && val <= 480;
});

// Context menu setup
const taskRef = toRef(props, "task");
const { menuItems, setTimebox } = useTaskContextMenu(taskRef, {
  onCustomTimebox: () => {
    // Pre-fill with current timebox if exists
    if (props.task.timeBoxSeconds) {
      customTimeboxMinutes.value = Math.round(props.task.timeBoxSeconds / 60);
    } else {
      customTimeboxMinutes.value = undefined;
    }
    showTimeboxModal.value = true;
  },
  onDeleted: (taskId) => {
    emit("deleted", taskId);
  },
});

// ── Touch: the pointer type, so a hold's native contextmenu never opens the menu (#296) ────────────────────────

/**
 * reka's trigger opens a touch or pen press itself after `pressOpenDelay` (700 ms by default), which is the hold-versus-drag
 * conflict of #296: the menu appeared behind the dragged card. A delay no press reaches (the largest timer value; anything
 * above it fires at once) turns it off; the contextmenu event of a mouse is unaffected.
 */
const NEVER_MS = 2 ** 31 - 1;

const lastPointerType = ref<string>("mouse");

function handleWrapperPointerDown(event: PointerEvent) {
  lastPointerType.value = event.pointerType;
}

/**
 * Intercepts the native contextmenu event.
 * - Mouse (right-click): let it bubble up to UContextMenu naturally.
 * - Touch / pen: stop propagation: a press-and-hold belongs to the drag (#296), the corner button opens the menu.
 */
function handleContextMenu(event: MouseEvent) {
  if (keyboardEvents.has(event)) return; // our own keyboard-triggered event
  if (lastPointerType.value !== "mouse") {
    // Android fires one after a hold: reka skips a prevented event, so a hold opens nothing
    event.preventDefault();
    event.stopPropagation();
  }
}

// ── Keyboard: ContextMenu key / Shift+F10 on the focused card (kd#23) ──────────
// The focus holder is the parent `.task-wrapper`, so its keydown never reaches this component's own
// wrapper. reka opens only from a `contextmenu` event with coordinates: dispatch one at the card.

const wrapperEl = ref<HTMLElement | null>(null);
let cardEl: HTMLElement | null = null;
/** The element that opened the menu by key (the card) or by tap (its corner button, #296); focus goes back to it on close */
let menuOpener: HTMLElement | null = null;
/** The synthetic contextmenu events dispatched for a key press (they skip the touch guard) */
const keyboardEvents = new WeakSet<Event>();

function isEditable(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Until this time a native contextmenu is the Menu key's own keyup event (Windows Chromium/WebView2 fires it after keydown) */
let nativeGuardUntil = 0;
function swallowNativeContextmenu(event: MouseEvent) {
  if (Date.now() > nativeGuardUntil || keyboardEvents.has(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

function handleCardKeydown(event: KeyboardEvent) {
  const isMenuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
  if (!isMenuKey || event.repeat || event.defaultPrevented || isEditable(event.target)) return;
  if (!cardEl || dragState.value.isDragging || document.querySelector(".board.dragging, .kando-dnd-dragged")) return;
  // Stops the browser's own contextmenu event, which would open the menu a second time
  event.preventDefault();
  menuOpener = cardEl;
  nativeGuardUntil = Date.now() + 500;
  const rect = cardEl.getBoundingClientRect();
  const synthetic = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + 24,
    clientY: rect.top + Math.min(rect.height, 48) / 2,
  });
  keyboardEvents.add(synthetic);
  wrapperEl.value?.dispatchEvent(synthetic);
  // A menu that did not open must not leave a stale origin behind
  setTimeout(() => { if (!isOpen.value) menuOpener = null; }, 500);
}

/**
 * The corner button's opener (#296, provided to TaskCard): the same synthetic contextmenu the key path uses, at the
 * button, so reka anchors the menu there and flips it inside the viewport; focus returns to the button on close.
 */
function openFromButton(trigger: HTMLElement) {
  menuOpener = trigger;
  const rect = trigger.getBoundingClientRect();
  const synthetic = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.right,
    clientY: rect.bottom + 4,
  });
  keyboardEvents.add(synthetic);
  wrapperEl.value?.dispatchEvent(synthetic);
  setTimeout(() => { if (!isOpen.value) menuOpener = null; }, 500);
}
provide(TASK_CARD_MENU_KEY, openFromButton);

onMounted(() => {
  cardEl = wrapperEl.value?.closest<HTMLElement>(".task-wrapper") ?? null;
  cardEl?.addEventListener("keydown", handleCardKeydown);
  document.addEventListener("contextmenu", swallowNativeContextmenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", swallowNativeContextmenu, true);
});

watch(isOpen, async (open) => {
  if (open || !menuOpener) return;
  const card = menuOpener;
  menuOpener = null;
  await nextTick();
  // reka returns focus to its (non-focusable) trigger; an item that navigated away or moved the card keeps its own focus
  if (card.isConnected && (!document.activeElement || document.activeElement === document.body)) {
    card.focus({ preventScroll: true });
  }
});

// ── Close menu when a drag starts ─────────────────────────────────────────────
// A watcher on dragState covers a drag that begins while the menu is open (keyboard drag, a mouse drag after
// a right-click); a touch hold no longer opens a menu, so there is no hold-then-drag path (#296).

const { dragState } = useBoardDragState();

watch(
  () => dragState.value.isDragging,
  (dragging) => {
    if (dragging) isOpen.value = false;
  },
  { flush: 'sync' },
);

onBeforeUnmount(() => {
  cardEl?.removeEventListener("keydown", handleCardKeydown);
});

// ── Timebox helpers ───────────────────────────────────────────────────────────

/**
 * Applies custom timebox from modal input
 */
const applyCustomTimebox = () => {
  if (isValidTimebox.value && customTimeboxMinutes.value) {
    setTimebox(customTimeboxMinutes.value * 60);
    showTimeboxModal.value = false;
    customTimeboxMinutes.value = undefined;
  }
};

/**
 * Custom UI overrides for context menu styling
 */
const contextMenuUi = {
  content: "min-w-48",
};
</script>
