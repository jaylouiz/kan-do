<!--
@component InlineEditable
@kind primitive
@category input
@description A generic component for inline editing of values.
@usage Wraps content that switches between a read-only display view and an editable input view.
@avoid Only read-or-edit in place; a form field that is always editable uses a plain input.
@responsibility
- Handle read/edit mode toggling
- `required`: an empty value is never saved; Enter shows `requiredMessage` and stays in the editor, Esc and blur restore (kd#27)
- Emit update events on save
- Provide slots for custom display and input components
- Keyboard-reachable edit: the read-mode trigger is `role="button"` `tabindex="0"` named "<field>: <value>";
  Enter or Space edits, Enter saves, Escape cancels (and never closes the surrounding dialog), focus returns to the trigger
-->
<template>
  <div
    ref="rootRef"
    data-inline-editable
    class="group relative rounded-md transition-colors duration-200"
    :class="[
      isEditing ? 'bg-transparent' : isRule ? 'cursor-pointer' : 'cursor-pointer focus-within:bg-accented/50 hover:bg-accented/50',
      containerClass
    ]"
  >
    <!-- Read Mode, interactive display (#208): display content and trigger are siblings, so links in the
         content are not descendants of role=button. The empty trigger comes first in Tab order and is stretched
         over the box; the content ignores pointer events except links (CSS), so a click elsewhere reaches the trigger. -->
    <template v-if="!isEditing && interactiveDisplay">
      <div
        ref="triggerRef"
        role="button"
        tabindex="0"
        :aria-label="triggerLabel"
        class="absolute inset-0 rounded-md focus-ring"
        @click="startEdit"
        @keydown.enter.self.prevent="startEdit"
        @keydown.space.self.prevent="startEdit"
      />
      <div
        class="pointer-events-none relative flex min-h-8 items-center rounded-md border border-transparent px-2 py-1.5"
        :class="[displayClass, { 'text-muted italic': !modelValue && resolvedPlaceholder }]"
      >
        <slot name="display">
          {{ modelValue || resolvedPlaceholder }}
        </slot>
      </div>
    </template>

    <!-- Read Mode -->
    <div
      v-else-if="!isEditing"
      ref="triggerRef"
      role="button"
      tabindex="0"
      :aria-label="triggerLabel"
      class="flex min-h-8 items-center rounded-md border border-transparent px-2 py-1.5 focus-ring"
      :class="[
        isRule ? 'task-property-value -ms-2 py-0 text-sm max-md:min-h-11' : '',
        displayClass,
        { 'text-muted italic': !modelValue && resolvedPlaceholder }
      ]"
      @click="startEdit"
      @keydown.enter.self.prevent="startEdit"
      @keydown.space.self.prevent="startEdit"
    >
      <slot name="display">
        {{ modelValue || resolvedPlaceholder }}
      </slot>
      
      <!-- Edit Indicator (Pencil) - Always visible for editable affordance -->
      <UIcon
        v-if="!isEditing && showEditIcon"
        name="ph:pencil-simple"
        class="ml-1.5 size-3.5  text-muted opacity-40 transition-opacity group-hover:opacity-70"
      />
    </div>

    <!-- Edit Mode -->
    <div v-else class="relative">
      <slot
        name="edit"
        :value="localValue"
        :set-value="(val: string | number | null) => localValue = val"
        :input-props="inputProps"
        :finish-edit="() => finishEdit()"
        :commit-edit="() => finishEdit(true)"
        :cancel-edit="() => cancelEdit(true)"
      >
        <UInput
          ref="inputRef"
          :model-value="localValue ?? undefined"
          v-bind="$attrs"
          :size="size"
          :variant="variant"
          class="w-full"
          :autofocus="true"
          :aria-invalid="requiredError ? true : undefined"
          :aria-describedby="requiredError ? requiredId : undefined"
          @update:model-value="onInput($event)"
          @blur="onBlur"
          @keydown.enter="handleEnter"
          @keydown.esc.stop="cancelEdit(true)"
        />
      </slot>
      <p v-if="requiredError" :id="requiredId" class="mt-1 ms-2 text-sm text-error-700" role="alert" data-testid="inline-required-error">
        {{ requiredMessage }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, useId, type ComponentPublicInstance } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'InlineEditable' });

const props = withDefaults(defineProps<{
  /** The value to be edited */
  modelValue?: string | number | null;
  /** Placeholder text when value is empty */
  placeholder?: string;
  /** Size of the input component (for default UInput) */
  size?: "md" | "xs" | "sm" | "lg" | "xl";
  /** Visual variant of the input component (for default UInput) */
  variant?: "outline" | "soft" | "subtle" | "ghost" | "none";
  /** Whether to show a pencil icon on hover in read mode */
  showEditIcon?: boolean;
  /** CSS class for the outer container */
  containerClass?: string;
  /** CSS class for the display element */
  displayClass?: string;
  /** Accessible field name (e.g. "Title"); the trigger is announced as "<label>: <value>" */
  label?: string;
  /** Whether to allow multiline input (affects Enter key behavior) */
  multiline?: boolean;
  /** Spoken form of a non-empty value when it differs from `modelValue` (e.g. "1 h" for 60), used in the trigger's name */
  valueText?: string;
  /**
   * Hover/focus affordance of the read-mode trigger: `fill` is the soft background (title, notes),
   * `rule` the dotted rule under plain text used by the task sheet's property rows (#161).
   */
  affordance?: 'fill' | 'rule';
  /**
   * Opt-in for a `#display` slot with its own interactive content (links): the content renders beside an
   * empty, stretched `role="button"` trigger instead of inside it. The display wrapper is
   * `pointer-events-none` so clicks reach the trigger; content that must stay clickable needs
   * `pointer-events: auto` (see `.task-notes-markdown a` in `task-detail.css`).
   * The trigger element is replaced when this flips (e.g. notes empty to written); after a keyboard
   * commit/cancel, focus is restored to the new trigger.
   * This branch ignores `showEditIcon` and `affordance="rule"`: it renders no pencil and no rule styling.
   */
  interactiveDisplay?: boolean;
  /**
   * An empty value cannot be saved (kd#27): Enter keeps the editor open and shows `requiredMessage`; Escape and
   * leaving the field restore the old value. Needs `requiredMessage`.
   */
  required?: boolean;
  /** The text shown (and announced) when a required value is confirmed empty. */
  requiredMessage?: string;
}>(), {
  required: false,
  requiredMessage: undefined,
  interactiveDisplay: false,
  modelValue: '',
  placeholder: undefined,
  label: undefined,
  size: 'md',
  variant: 'outline',
  showEditIcon: false,
  containerClass: '',
  displayClass: '',
  multiline: false,
  valueText: undefined,
  affordance: 'fill',
});

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null];
  'save': [value: string | number | null];
  'cancel': [];
}>();

const { t } = useI18n();
const isRule = computed(() => props.affordance === 'rule');
const resolvedPlaceholder = computed(() => props.placeholder ?? t('common.clickToEdit'));

const isEditing = ref(false);
const localValue = ref(props.modelValue);
const inputRef = ref<ComponentPublicInstance | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);

/** Accessible name of the read-mode trigger: field label plus current value (or the empty hint). */
const triggerLabel = computed(() => {
  const isEmpty = props.modelValue === null || props.modelValue === '' || props.modelValue === 0;
  const value = isEmpty ? resolvedPlaceholder.value : (props.valueText ?? String(props.modelValue));
  return props.label ? `${props.label}: ${value}` : value;
});

// A keyboard commit/cancel must leave focus on the trigger even when the parent swaps the trigger element a
// tick later (`interactiveDisplay` flips with the async-updated value, #218). Not reactive: it only gates focus.
let pendingFocus = false;

function clearPendingFocus() {
  pendingFocus = false;
  document.removeEventListener('focusin', onDocumentFocusIn);
}

/** Focus moved to another element: the user took over, so a later trigger swap must not steal it back. */
function onDocumentFocusIn(e: FocusEvent) {
  if (!rootRef.value?.contains(e.target as Node)) clearPendingFocus();
}

/** Returns focus to the read-mode trigger after a keyboard commit/cancel so focus is not lost. */
function focusTrigger() {
  clearPendingFocus();
  nextTick(() => {
    triggerRef.value?.focus();
    // Armed only now: the rebinding from edit to read mode is handled by this focus call itself.
    pendingFocus = true;
    document.addEventListener('focusin', onDocumentFocusIn);
  });
}

// The trigger was replaced while a restore is pending: focus fell to body, so re-apply it once.
watch(triggerRef, (el) => {
  if (!pendingFocus || !el) return;
  const active = document.activeElement;
  if (!active || active === document.body) el.focus();
  clearPendingFocus();
}, { flush: 'post' });

onBeforeUnmount(clearPendingFocus);

// expose computed props for the slot
const inputProps = {
  size: props.size,
  variant: props.variant,
  autofocus: true
};

watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal;
});

function startEdit() {
  if (isEditing.value) return;
  clearPendingFocus();
  localValue.value = props.modelValue;
  isEditing.value = true;
  
  nextTick(() => {
    // Focus logic: try to find an input element to focus
    if (inputRef.value?.$el) {
       const input = inputRef.value.$el.querySelector('input, textarea');
       if (input) input.focus();
       else inputRef.value.$el.focus();
       return;
    }
    // Custom #edit slot: the slot's own control gets focus, so one click is enough to start typing
    // (a dynamically inserted `autofocus` attribute is not honoured by the browser).
    rootRef.value?.querySelector<HTMLElement>('input, textarea')?.focus();
  });
}

const requiredId = `inline-required-${useId()}`;
const requiredError = ref(false);
const isBlank = () => props.required && String(localValue.value ?? '').trim() === '';

function onInput(value: string | number | null | undefined) {
  localValue.value = value ?? null;
  requiredError.value = false;
}

/** Leaving the field with nothing in it is a cancel, not an error trap. */
function onBlur() {
  if (isBlank()) cancelEdit();
  else finishEdit();
}

function finishEdit(restoreFocus = false) {
  if (!isEditing.value) return;
  if (isBlank()) {
    // Confirmed empty: stay in the editor and say why
    requiredError.value = !!props.requiredMessage;
    if (!requiredError.value) cancelEdit(restoreFocus);
    return;
  }

  isEditing.value = false;
  
  if (localValue.value !== props.modelValue) {
    emit('update:modelValue', localValue.value);
    emit('save', localValue.value);
  }
  if (restoreFocus === true) focusTrigger();
}

function cancelEdit(restoreFocus = false) {
  isEditing.value = false;
  requiredError.value = false;
  localValue.value = props.modelValue;
  emit('cancel');
  if (restoreFocus === true) focusTrigger();
}

function handleEnter(e: KeyboardEvent) {
  if (!props.multiline) {
    e.preventDefault(); // Prevent newline if not multiline
    finishEdit(true);
  }
}

defineExpose({
  isEditing,
  startEdit,
  finishEdit,
  cancelEdit
});
</script>
