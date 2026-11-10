<!--
@component DatePickerField
@kind component
@category input
@description Popover calendar picker for a date value of a task-sheet row: custom date properties and the done day.
             Wraps UPopover + UCalendar. Replaces <input type="date">.
@usage <DatePickerField v-model="field.value" />; a date that must exist and has limits (the done day, kd#131):
       <DatePickerField :model-value="{ start: day }" :min-day="min" :max-day="max" :clearable="false" />
@avoid Only a date inside a TaskPropertyRow; other values use TaskPropertySelect or InlineEditable.
@responsibility
- Show the formatted date as plain text in read mode (or the muted empty CTA when value is null), no icon
- Open a UCalendar popover on click
- Emit update:modelValue with { start: string } on date select
- Provide Löschen and Heute shortcuts in the popover footer; `clearable: false` drops Löschen (a value that cannot be empty)
- `minDay` / `maxDay` (`YYYY-MM-DD`) disable the days outside in the calendar; Heute is disabled when today is outside
-->
<template>
  <UPopover v-model:open="isOpen" :disabled="disabled">
    <template #default>
      <PropertyValueTrigger
        class="-ms-2"
        inset
        :tone="modelValue ? 'value' : 'empty'"
        :disabled="disabled"
        :aria-label="label ? `${label}: ${triggerText}` : undefined"
        data-testid="date-picker-trigger"
        @click="isOpen = true"
      >
        {{ triggerText }}
      </PropertyValueTrigger>
    </template>

    <template #content>
      <div class="min-w-[260px] p-2">
        <UCalendar
          :model-value="calendarDate"
          :min-value="minValue"
          :max-value="maxValue"
          data-testid="date-picker-calendar"
          @update:model-value="onSelectDate"
        />
        <div class="mt-2 flex items-center border-t pt-2" :class="clearable ? 'justify-between' : 'justify-end'">
          <UButton
            v-if="clearable"
            size="sm"
            variant="ghost"
            color="neutral"
            :label="t('common.delete')"
            data-testid="date-picker-clear"
            @click="onClear"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="primary"
            :label="t('common.today')"
            :disabled="!isTodayAllowed"
            data-testid="date-picker-today"
            @click="onToday"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type CalendarDate, type DateValue, parseDate, today, getLocalTimeZone } from '@internationalized/date';
import type { DateRange } from 'reka-ui';
import { formatDateRange } from '~/composables/useTaskDetail';
import PropertyValueTrigger from '~/components/ui/PropertyValueTrigger.vue';

defineOptions({ name: 'DatePickerField' });

const { t } = useI18n();

interface Props {
  modelValue: { start: string; end?: string } | null;
  disabled?: boolean;
  /** Property name; names the trigger "<label>: <value>" */
  label?: string;
  /** Earliest selectable day (`YYYY-MM-DD`); none when absent or null */
  minDay?: string | null;
  /** Latest selectable day (`YYYY-MM-DD`); none when absent or null */
  maxDay?: string | null;
  /** Whether the value can be removed (the Löschen shortcut) */
  clearable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  label: undefined,
  minDay: null,
  maxDay: null,
  clearable: true,
});

const triggerText = computed(() => (props.modelValue ? formatDateRange(props.modelValue) : t('task.datePicker.set')));

const emit = defineEmits<{
  'update:modelValue': [value: { start: string; end?: string } | null];
}>();

const isOpen = ref(false);

/** Convert our { start } model to a CalendarDate for UCalendar */
const calendarDate = computed<CalendarDate | undefined>(() => {
  if (!props.modelValue?.start) return undefined;
  try {
    return parseDate(props.modelValue.start);
  } catch {
    return undefined;
  }
});

const toCalendarDate = (day: string | null): CalendarDate | undefined => {
  if (!day) return undefined;
  try {
    return parseDate(day);
  } catch {
    return undefined;
  }
};
const minValue = computed(() => toCalendarDate(props.minDay));
const maxValue = computed(() => toCalendarDate(props.maxDay));
const isTodayAllowed = computed(() => {
  const now = today(getLocalTimeZone());
  return !(minValue.value && now.compare(minValue.value) < 0) && !(maxValue.value && now.compare(maxValue.value) > 0);
});

function onSelectDate(value: DateValue | DateRange | DateValue[] | null | undefined) {
  // We only use single-date (non-range, non-multiple) mode, so value will be DateValue
  if (!value || Array.isArray(value) || typeof value !== 'object' || 'start' in value) return;
  const dateValue = value as DateValue;
  // DateValue.toString() yields YYYY-MM-DD for CalendarDate (no T separator)
  emit('update:modelValue', { start: dateValue.toString() });
  isOpen.value = false;
}

function onClear() {
  emit('update:modelValue', null);
  isOpen.value = false;
}

function onToday() {
  emit('update:modelValue', { start: today(getLocalTimeZone()).toString() });
  isOpen.value = false;
}
</script>
