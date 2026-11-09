<!--
@component SettingsSubpageLink
@description One quiet link row from a settings surface to a settings sub-page (#242): icon, label, muted
description and a trailing arrow. Text weight, no card, no accent colour. Laid out like a connection row of /settings
(icon column, gap-4, base-size title; #683): the row sits `-mx-2 px-2` so the icon lines up with the rows above and the hover
fill still has room around the text.
@usage <SettingsSubpageLink to="/settings/github" icon="i-ph-key" :label="t('settings.subpages.github.label')" :description="t('settings.subpages.github.description')" />
@responsibility
- Render a single NuxtLink whose accessible name is label + description
- Hover and keyboard focus use the standard ink focus ring
- Re-emit the click so a host (e.g. a modal) can close itself while the link navigates
-->
<template>
  <NuxtLink
    :to="to"
    class="group -mx-2 flex min-h-11 items-center gap-4 rounded-md px-2 py-3 text-default hover:bg-elevated focus-ring"
    data-testid="settings-subpage-link"
    @click="emit('click')"
  >
    <UIcon :name="icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
    <span class="flex min-w-0 flex-1 flex-col">
      <span data-testid="settings-subpage-link-label">{{ label }}</span>
      <span class="text-sm text-muted">{{ description }}</span>
    </span>
    <UIcon :name="ICONS.goOn" class="size-4 shrink-0 text-muted" aria-hidden="true" />
  </NuxtLink>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons';
defineOptions({ name: 'SettingsSubpageLink' });

interface Props {
  to: string;
  icon: string;
  label: string;
  description: string;
}

defineProps<Props>();

const emit = defineEmits<{ (e: 'click'): void }>();
</script>
