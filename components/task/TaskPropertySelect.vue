<!--
@component TaskPropertySelect
@kind component
@category input
@description Select for a property row's value that opens a list (status, priority, topic, activity, select fields): a soft-filled field with a chevron (#114)
@usage Value slot of TaskPropertyRow in the detail and add views; `plain` only for a quiet footer line outside a row (AddTargetSwitch)
@avoid Only a value picker inside a TaskPropertyRow; topic and activity use TopicPropertyPicker; a free value (timebox, text) is an InlineEditable, not a select.
@responsibility
- Soft select trigger (USelectMenu `soft` variant from app.config.ts: muted fill, chevron, 36px, 44px on touch), named "<label>: <value>"; `plain` keeps the old text trigger (`property` variant: body text, dotted rule on hover)
- Optional `value-leading` slot: a value icon (the topic mark) sits inside the select, before the value
- Optional help text at the top of the open picker (reachable on touch, replaces tooltips)
- Clearing lives inside the picker (a "<label> entfernen" action), never as a × on the trigger
- Menu items use Nuxt UI size `md`, the same text size as the task card context menu (text-sm)
- Optional `item-leading` slot per option (the topic mark), a `content-top` slot above the search (after the hint; the edit rows of TopicPropertyPicker, #443)
  and a `content-extra` slot above the clear action ("Bearbeiten", "Themen verwalten")
-->
<template>
  <USelectMenu
    v-model:open="isOpen"
    :model-value="selectModel"
    :items="items"
    :value-key="valueKey"
    :multiple="multiple"
    :variant="plain ? 'property' : 'soft'"
    size="md"
    :trailing="!plain"
    :disabled="disabled"
    :placeholder="placeholder"
    :search-input="searchPlaceholder ? { placeholder: searchPlaceholder, ...(searchAutofocus ? {} : { autofocus: false }) } : false"
    :create-item="createItem"
    :content="{ sideOffset: 4, side, align }"
    :ui="{ content: 'min-w-52', ...pickerUi }"
    :aria-label="triggerLabel"
    @update:model-value="onUpdate"
    @create="(item: string) => emit('create', item)"
  >
    <template v-if="hint || $slots['content-top']" #content-top>
      <p v-if="hint" class="px-3 pt-2 pb-1 text-xs text-muted">{{ hint }}</p>
      <slot name="content-top" />
    </template>
    <template v-if="$slots['value-leading'] && !plain" #leading>
      <slot name="value-leading" />
    </template>
    <template v-if="$slots['item-leading']" #item-leading="slotProps">
      <slot name="item-leading" v-bind="slotProps" />
    </template>
    <template v-if="(clearLabel && hasValue) || $slots['content-extra']" #content-bottom>
      <div class="p-1" data-testid="task-property-footer">
        <slot name="content-extra" :close="() => (isOpen = false)" />
        <UButton
          v-if="clearLabel && hasValue"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          :label="clearLabel"
          data-testid="task-property-clear"
          @click="onClear"
        />
      </div>
    </template>
  </USelectMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SelectMenuItem } from '@nuxt/ui';

defineOptions({ name: 'TaskPropertySelect' });

type SelectValue = string | number | string[];

const props = withDefaults(defineProps<{
  /** Property name; the trigger is announced as "<label>: <value>" */
  label: string;
  /** Current value; empty ('' / null / undefined / []) shows the placeholder */
  modelValue?: SelectValue | null;
  items: SelectMenuItem[];
  /** Key of the value on object items (e.g. `value`); plain string items need none */
  valueKey?: string;
  multiple?: boolean;
  placeholder?: string;
  /** Shows a search field with this placeholder; without it the picker has no search */
  searchPlaceholder?: string;
  /** False keeps the search field from taking focus when it mounts (the picker opens with focus elsewhere, e.g. back on "Fertig"'s button) */
  searchAutofocus?: boolean;
  /** Allow creating a new option from the search term */
  createItem?: boolean;
  /** Help text shown at the top of the open picker */
  hint?: string;
  /** Label of the in-picker clear action; omit when the value cannot be cleared */
  clearLabel?: string;
  /** The quiet text trigger without fill or chevron, for a footer line outside a property row */
  plain?: boolean;
  /** Locks the trigger (e.g. while a save runs) */
  disabled?: boolean;
  /** Side of the trigger the picker opens on; the footer switch opens upward */
  side?: 'top' | 'bottom';
  /** Edge of the trigger the picker aligns to; the footer switch aligns to the start so a wide picker stays inside the sheet */
  align?: 'start' | 'center' | 'end';
  /** Slot classes for the open picker, merged over the default width (e.g. wrapping item descriptions; `viewport` and `empty` `hidden` while a `content-top` slot replaces the list) */
  pickerUi?: { content?: string; itemDescription?: string; viewport?: string; empty?: string };
}>(), {
  modelValue: undefined,
  valueKey: undefined,
  multiple: false,
  placeholder: undefined,
  searchPlaceholder: undefined,
  searchAutofocus: true,
  createItem: false,
  hint: undefined,
  clearLabel: undefined,
  plain: false,
  disabled: false,
  side: 'bottom',
  align: 'center',
  pickerUi: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: SelectValue];
  /** The user created an option from the search term (picks arrive via `update:modelValue`) */
  create: [value: string];
  /** The user cleared the value from inside the picker */
  clear: [];
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const hasValue = computed(() => {
  const value = props.modelValue;
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
});

const selectModel = computed(() => (hasValue.value ? props.modelValue ?? undefined : props.multiple ? [] : undefined));

function itemLabel(value: string | number): string {
  const match = props.items.find((item) => typeof item === 'object' && item !== null && props.valueKey
    ? (item as Record<string, unknown>)[props.valueKey] === value
    : item === value);
  if (match && typeof match === 'object') return String((match as Record<string, unknown>).label ?? value);
  return String(value);
}

const valueText = computed(() => {
  if (!hasValue.value) return props.placeholder ?? '';
  const value = props.modelValue as SelectValue;
  return Array.isArray(value) ? value.join(', ') : itemLabel(value);
});

const triggerLabel = computed(() => `${props.label}: ${valueText.value}`);

function onUpdate(value: SelectValue) {
  emit('update:modelValue', value);
}

function onClear() {
  emit('clear');
  isOpen.value = false;
}
</script>
