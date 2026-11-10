<!--
@component TaskCardContextMenu
@kind component
@category overlay
@description Wraps TaskCard with a context menu for quick task actions.
  On desktop: right-click opens the menu via the native contextmenu event.
  On mobile/touch: a 750ms long press opens the menu; moving more than 14px
  (grace pixels) cancels it so a drag gesture is never interrupted.
  Keyboard: the ContextMenu key or Shift+F10 on the focused card (its `.task-wrapper`, a parent of this
  component) opens the menu at the card; on close focus returns to the card (kd#23).
  If a drag starts while the menu is open it is closed immediately.
@usage Used in BoardColumn to provide right-click / long-press menu on task cards
@avoid Only wraps TaskCard for the right-click / long-press menu; not for stack headers or other rows.
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
  >
    <!--
      Inner wrapper captures pointer events for long-press detection.
      contextmenu is intercepted on touch so we control open state ourselves;
      on mouse it bubbles through to UContextMenu as normal.
    -->
    <div
      ref="wrapperEl"
      v-bind="longPressHandlers"
      :class="{ 'kando-long-press-active': isPressing }"
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
        <p class="text-sm text-muted">
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
import { ref, computed, toRef, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import type { Task } from "~/types/task";
import { useTaskContextMenu } from "~/composables/useTaskContextMenu";
import { useLongPress } from "~/composables/useLongPress";
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

// Programmatic open state — shared between desktop (contextmenu event) and
// mobile (long press). UContextMenu is driven by this ref via v-model:open.
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

// ── Mobile / touch long-press ─────────────────────────────────────────────────

// Track pointer position at pointerdown so we can measure movement after fire.
let _pressX = 0;
let _pressY = 0;
// Cleanup fn for the post-fire drag guard listener.
let _dragGuardCleanup: (() => void) | null = null;

function removeDragGuard() {
  if (_dragGuardCleanup) {
    _dragGuardCleanup();
    _dragGuardCleanup = null;
  }
}

const { handlers: longPressHandlers, isPressing, lastPointerType } = useLongPress(
  () => {
    // Timer fired: user held still for 750ms on a touch device.
    // Provide haptic feedback when available.
    if (import.meta.client && "vibrate" in navigator) {
      navigator.vibrate(10);
    }
    isOpen.value = true;

    // After the menu opens the finger is still down. If the user starts dragging
    // (moves > 10px), reka-ui's DismissableLayer may capture pointer events before
    // dnd-kit can fire onDragStart — so the existing dragState watcher won't close
    // the menu. We install a capture-phase document listener as an escape hatch.
    if (!import.meta.client) return;
    const fireX = _pressX;
    const fireY = _pressY;

    // Close on either pointermove OR touchmove — on iOS, reka-ui's DismissableLayer
    // can consume touch events before the browser synthesizes them into pointer events,
    // so pointermove alone may never fire. touchmove in capture phase arrives first.
    const onMove = (e: PointerEvent | TouchEvent) => {
      const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? fireX) : e.clientX;
      const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? fireY) : e.clientY;
      const d = Math.sqrt((clientX - fireX) ** 2 + (clientY - fireY) ** 2);
      if (d > 10) {
        // reka-ui's DismissableLayer ignores external v-model=false while the menu is
        // actively open — it only responds to Escape or an internal dismiss trigger.
        // Dispatching Escape is the reliable way to close the ContextMenu from outside.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        isOpen.value = false;
        removeDragGuard();
      }
    };
    const onUp = () => removeDragGuard();

    document.addEventListener("pointermove", onMove as EventListener, { capture: true, passive: true });
    document.addEventListener("touchmove", onMove as EventListener, { capture: true, passive: true });
    document.addEventListener("pointerup", onUp, { capture: true, once: true });

    _dragGuardCleanup = () => {
      document.removeEventListener("pointermove", onMove as EventListener, true);
      document.removeEventListener("touchmove", onMove as EventListener, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  },
);

/** Record pointer position at press time so the drag guard has an origin. */
function handleWrapperPointerDown(event: PointerEvent) {
  _pressX = event.clientX;
  _pressY = event.clientY;
}

/**
 * Intercepts the native contextmenu event.
 * - Mouse (right-click): let it bubble up to UContextMenu naturally.
 * - Touch / pen: stop propagation so UContextMenu does not double-open;
 *   the long-press handler above already controls isOpen.
 */
function handleContextMenu(event: MouseEvent) {
  if (keyboardEvents.has(event)) return; // our own keyboard-triggered event
  if (lastPointerType.value !== "mouse") {
    // Touch-triggered: we manage open state via useLongPress.
    // Stop propagation to prevent UContextMenu from also reacting.
    event.stopPropagation();
  }
}

// ── Keyboard: ContextMenu key / Shift+F10 on the focused card (kd#23) ──────────
// The focus holder is the parent `.task-wrapper`, so its keydown never reaches this component's own
// wrapper. reka opens only from a `contextmenu` event with coordinates: dispatch one at the card.

const wrapperEl = ref<HTMLElement | null>(null);
let cardEl: HTMLElement | null = null;
/** The card that had focus when the key opened the menu; focus goes back to it on close */
let keyboardOpener: HTMLElement | null = null;
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
  keyboardOpener = cardEl;
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
  setTimeout(() => { if (!isOpen.value) keyboardOpener = null; }, 500);
}

onMounted(() => {
  cardEl = wrapperEl.value?.closest<HTMLElement>(".task-wrapper") ?? null;
  cardEl?.addEventListener("keydown", handleCardKeydown);
  document.addEventListener("contextmenu", swallowNativeContextmenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", swallowNativeContextmenu, true);
});

watch(isOpen, async (open) => {
  if (open || !keyboardOpener) return;
  const card = keyboardOpener;
  keyboardOpener = null;
  await nextTick();
  // reka returns focus to its (non-focusable) trigger; an item that navigated away or moved the card keeps its own focus
  if (card.isConnected && (!document.activeElement || document.activeElement === document.body)) {
    card.focus({ preventScroll: true });
  }
});

// ── Close menu when a drag starts ─────────────────────────────────────────────
// Primary guard: document pointermove listener installed by the long-press
// callback above. Secondary guard: watcher on dragState covers the case where
// dnd-kit does fire onDragStart (pointer events not swallowed by the overlay).

const { dragState } = useBoardDragState();

watch(
  () => dragState.value.isDragging,
  (dragging) => {
    if (dragging) {
      isOpen.value = false;
      removeDragGuard();
    }
  },
  { flush: 'sync' },
);

// Remove drag guard listener on unmount to avoid leaks.
onBeforeUnmount(() => {
  removeDragGuard();
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
