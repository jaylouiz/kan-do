<!--
@component NotionSettingsSection
@kind compound
@category input
@description Wrapper component for settings sections with save/cancel actions
@usage Used in the Notion settings page to wrap each configuration section
@avoid Only for the Notion settings sections; other settings pages use PageHeader, SectionHeader and plain rows.
@responsibility
- Provides consistent layout for settings sections
- Manages save/cancel button states
- Shows loading state during save operations
-->
<template>
  <PageSheet class="space-y-6">
    <!-- Section Header -->
    <div class="pb-2">
      <SectionHeader tag="h2">{{ title }}</SectionHeader>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
    </div>

    <!-- Section Content -->
    <div class="py-2">
      <slot />
    </div>

    <!-- Section Footer with Actions -->
    <div class="flex items-center justify-end gap-2 pt-4">
      <UButton
        v-if="hasChanges"
        color="neutral"
        variant="soft"
        :disabled="isSaving"
        @click="$emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        size="lg"
        color="primary"
        :loading="isSaving"
        :disabled="!hasChanges && !alwaysShowSave"
        @click="$emit('save')"
      >
        {{ resolvedSaveLabel }}
      </UButton>
    </div>
  </PageSheet>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PageSheet from '~/components/ui/PageSheet.vue'
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'NotionSettingsSection' });

/**
 * Props
 * @prop {string} title Section title
 * @prop {string=} description Optional section description
 * @prop {boolean} isSaving Whether the section is currently saving
 * @prop {boolean} hasChanges Whether there are unsaved changes
 * @prop {string=} saveLabel Custom label for save button
 * @prop {boolean=} alwaysShowSave Always enable save button even without changes
 */
const props = withDefaults(defineProps<{
  /** Section title */
  title: string;
  /** Optional section description */
  description?: string;
  /** Whether the section is currently saving */
  isSaving?: boolean;
  /** Whether there are unsaved changes */
  hasChanges?: boolean;
  /** Custom label for save button */
  saveLabel?: string;
  /** Always enable save button even without changes */
  alwaysShowSave?: boolean;
}>(), {
  description: undefined,
  isSaving: false,
  hasChanges: false,
  saveLabel: undefined,
  alwaysShowSave: false,
});

defineEmits<{
  (e: 'save' | 'cancel'): void;
}>();

const { t } = useI18n();

const resolvedSaveLabel = computed(() => props.saveLabel ?? t('common.save'));
</script>
