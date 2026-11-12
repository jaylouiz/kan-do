<!--
@component ChoiceCard
@kind primitive
@category input
@description The one card for a bigger choice (kd#178): a full-width answer row with an icon, a label, an optional hint line and a mark at the end. The welcome page's two answers ("Noch nirgends", "In Notion", which open a setup) and the local setup's two radio cards (empty or sample board) are this one card.
@usage <ChoiceCard icon="i-ph-desktop" @click="open">{{ label }}</ChoiceCard> (the mark at the end is the go-on arrow); inside a `RadioGroupRoot` give it a `value` and it is a radio card (the mark is the radio dot): <ChoiceCard value="fresh" icon="i-ph-plus-circle"><template #hint>{{ hint }}</template>{{ label }}</ChoiceCard>. Attributes (`data-testid`, `aria-*`, `disabled`) and the click land on the control.
@avoid Not for a pick among a few short words (ChoiceChip), not for an action in a row (UButton) and not for an option inside a list (the select menu's item). A card that opens something never carries a filled look: no answer is the primary one; the fill is the checked state of a radio card only.
@responsibility
- Render one native `<button>`, or a reka `RadioGroupItem` (a button with `role="radio"`) when `value` is set; the host owns the group (arrow keys, one Tab stop) and the meaning of a click
- One shell: 64 px minimum, 12 px corners (the radius of buttons and fields, DESIGN.md "Radius"), a hairline border that darkens on hover; a radio card that is checked is a fill, the solid primary with inverted text and mark, like the picked ChoiceChip (DESIGN.md "States": selected is a fill). Only a checked radio card is filled: no go-on answer is
- The mark at the end is the only difference between the two: the go-on arrow (an answer that opens something), the radio dot (an answer that waits for a confirmation)
- Visible focus halo (`focus-ring`); the press, the hand cursor and the disabled look come from the base layer (DESIGN.md "States")
-->
<template>
  <component
    :is="isRadio ? RadioGroupItem : 'button'"
    v-bind="isRadio ? { value } : { type: 'button' }"
    class="group focus-ring flex min-h-16 w-full items-center gap-4 rounded-md border border-default bg-elevated p-4 text-left not-data-[state=checked]:hover:border-accented data-[state=checked]:border-primary data-[state=checked]:bg-primary"
  >
    <UIcon :name="icon" class="size-6 shrink-0 text-toned group-data-[state=checked]:text-inverted" aria-hidden="true" />
    <span class="min-w-0 flex-1">
      <span class="block text-lg font-medium text-highlighted group-data-[state=checked]:text-inverted"><slot /></span>
      <span v-if="$slots.hint" class="block text-sm text-muted group-data-[state=checked]:text-inverted"><slot name="hint" /></span>
    </span>
    <span
      v-if="isRadio"
      class="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accented group-data-[state=checked]:border-(--ui-text-inverted)"
      aria-hidden="true"
    >
      <span class="size-2.5 scale-0 rounded-full bg-(--ui-text-inverted) transition-transform duration-(--duration-fast) group-data-[state=checked]:scale-100 motion-reduce:transition-none" />
    </span>
    <UIcon v-else :name="ICONS.goOn" class="size-5 shrink-0 text-muted" aria-hidden="true" />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RadioGroupItem } from 'reka-ui';
import { ICONS } from '~/lib/icons';

defineOptions({ name: 'ChoiceCard' });

const props = defineProps<{
  /** The icon before the label (an `i-ph-*` name) */
  icon: string;
  /** Makes it a radio card: the value inside the surrounding `RadioGroupRoot` */
  value?: string;
}>();

defineSlots<{
  default(): unknown;
  /** The line under the label */
  hint?(): unknown;
}>();

const isRadio = computed(() => props.value !== undefined);
</script>
