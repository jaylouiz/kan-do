<!--
@component ExpandingButton
@description Button that expands to show text on hover
@usage Used for compact UI elements that reveal more information on interaction
@responsibility
- Provides compact button that expands on hover
- Manages transition animations and timing
- Calculates appropriate width for expanded state
-->
<template>
  <div class="inline-flex items-center">
    <UButton
      :variant="props.variant"
      :color="props.color"
      class="flex min-h-10 items-center overflow-hidden rounded-full transition-all duration-300 ease-in-out"
      :style="buttonStyle"
      @mouseenter="startHoverTimer"
      @click="$emit('click')"
      @mouseleave="clearHoverTimer"
    >
      <span class="flex w-full items-center">
        <UIcon
          :name="props.icon"
          :class="[
            'mr-2.5 size-5  shrink-0',
            variant === 'ghost' ? `text-${props.color}-500` : '',
          ]"
        />
        <span
          ref="labelRef"
          class="absolute inline-flex items-center overflow-hidden whitespace-nowrap opacity-0"
          :class="{ 'static! opacity-100!': showLabel }"
        >
          <slot />
        </span>
      </span>
    </UButton>
  </div>
</template>

<script setup lang="ts">
import type { PropType } from "vue";

// Nuxt UI compatible types
type ButtonVariant = "solid" | "outline" | "soft" | "ghost" | "link";
type ButtonColor = "primary" | "secondary" | "success" | "info" | "warning" | "error" | "neutral";

defineOptions({ name: 'ExpandingButton' });

/**
 * Component props
 */
const props = defineProps({
  /** Button style variant (soft, solid, outline, ghost) */
  variant: {
    type: String as PropType<ButtonVariant>,
    default: "soft",
  },
  /** Button color theme */
  color: {
    type: String as PropType<ButtonColor>,
    default: "neutral",
  },
  /** Icon to display in the button */
  icon: {
    type: String,
    required: true,
  },
});

defineEmits<{
  (e: "click"): void;
}>();

const showLabel = ref(false);
const labelRef = ref<HTMLElement | null>(null);
const labelWidth = ref(40); // Default minimum width
let hoverTimer: NodeJS.Timeout | null = null;

/**
 * Computed style for the button width based on expanded state
 */
const buttonStyle = computed(() => ({
  width: showLabel.value ? `${labelWidth.value}px` : "2.5rem",
}));

/**
 * Starts the hover timer to trigger button expansion
 */
function startHoverTimer() {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if (labelRef.value) {
      labelWidth.value = labelRef.value.offsetWidth + 60; // Add padding
    }
    showLabel.value = true;
  }, 150); // 150ms delay before showing
}

/**
 * Clears the hover timer and collapses the button
 */
function clearHoverTimer() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  showLabel.value = false;
}
</script>

<style scoped></style>
