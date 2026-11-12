<!--
@component WhatsNewDialog
@kind block
@category overlay
@description "What's new" after a desktop update (#226): one calm dialog with the Highlights of every
version since the last one seen, newest first. Opened by the "Was ist neu" button of the post-update toast
(#390) and by the re-open from the palette and /settings/updates.
@usage <WhatsNewDialog /> once in app.vue (desktop); open it with useWhatsNew()
@avoid Only after a desktop update; installing one is UpdateDialog.
@responsibility
- One section per version: display headline "Version X.Y.Z", then the bullets as plain body text (bold title + sentence)
- Footer: single primary "Schließen" on every path; Escape, overlay and X are the same close
- Text is rendered with interpolation only (never v-html); the bold title is a <strong>
- No version with highlights (re-open only): one muted line
-->
<template>
  <AppDialog
    v-model:open="isOpen"
    :title="t('whatsNew.title')"
    :description="t('whatsNew.description')"
    size="sm"
    hide-description
  >
    <template #body>
      <div class="max-h-96 space-y-6 overflow-y-auto" tabindex="0" data-testid="whats-new-body">
        <section v-for="entry in state.entries" :key="entry.version" class="space-y-2" :aria-labelledby="`whats-new-${entry.version}`">
          <SectionHeader :id="`whats-new-${entry.version}`" tag="h3" size="sub">
            {{ t('whatsNew.version', { version: entry.version }) }}
          </SectionHeader>
          <ul class="list-disc space-y-1.5 pl-5 text-sm text-default">
            <li v-for="(bullet, index) in entry.bullets" :key="`${index}-${bullet.title}`">
              <strong class="font-semibold text-highlighted">{{ bullet.title }}</strong> {{ bullet.text }}
            </li>
          </ul>
        </section>
        <EmptyNote v-if="state.entries.length === 0" data-testid="whats-new-empty">{{ t('whatsNew.empty') }}</EmptyNote>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton size="lg" color="primary" data-testid="whats-new-close" @click="whatsNew.close()">
          {{ t('whatsNew.close') }}
        </UButton>
      </div>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import AppDialog from '~/components/ui/AppDialog.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyNote from '~/components/ui/EmptyNote.vue';
import { useWhatsNew } from '~/composables/useWhatsNew';

defineOptions({ name: 'WhatsNewDialog' });

const { t } = useI18n();
const whatsNew = useWhatsNew();
const { state } = whatsNew;

const isOpen = computed({
  get: () => state.open,
  set: (open: boolean) => { if (!open) whatsNew.close(); },
});
</script>
