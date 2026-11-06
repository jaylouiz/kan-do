<!--
@component WhatsNewDialog
@description "What's new" after a desktop update (#226): one calm dialog with the Highlights of every
version since the last one seen, newest first. Opened by the "Was ist neu" button of the post-update toast
(#390) and by the re-open from the palette and /settings/updates.
@usage <WhatsNewDialog /> once in app.vue (desktop); open it with useWhatsNew()
@responsibility
- One section per version: display headline "Version X.Y.Z", then the bullets as plain body text (bold title + sentence)
- Footer: single primary "Schließen" on every path; Escape, overlay and X are the same close
- Text is rendered with interpolation only (never v-html); the bold title is a <strong>
- No version with highlights (re-open only): one muted line
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('whatsNew.title')"
    :description="t('whatsNew.description')"
    :ui="{ content: MODAL_WIDTH.sm, description: 'sr-only' }"
  >
    <template #body>
      <div class="max-h-96 space-y-6 overflow-y-auto" tabindex="0" data-testid="whats-new-body">
        <section v-for="entry in state.entries" :key="entry.version" class="space-y-2" :aria-labelledby="`whats-new-${entry.version}`">
          <h3 :id="`whats-new-${entry.version}`" class="section-heading">
            {{ t('whatsNew.version', { version: entry.version }) }}
          </h3>
          <ul class="list-disc space-y-1.5 pl-5 text-sm text-default">
            <li v-for="(bullet, index) in entry.bullets" :key="`${index}-${bullet.title}`">
              <strong class="font-semibold text-highlighted">{{ bullet.title }}</strong> {{ bullet.text }}
            </li>
          </ul>
        </section>
        <p v-if="state.entries.length === 0" class="text-sm text-muted" data-testid="whats-new-empty">{{ t('whatsNew.empty') }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton size="lg" color="primary" data-testid="whats-new-close" @click="whatsNew.close()">
          {{ t('whatsNew.close') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWhatsNew } from '~/composables/useWhatsNew';
import { MODAL_WIDTH } from '~/utils/modalSizes';

defineOptions({ name: 'WhatsNewDialog' });

const { t } = useI18n();
const whatsNew = useWhatsNew();
const { state } = whatsNew;

const isOpen = computed({
  get: () => state.open,
  set: (open: boolean) => { if (!open) whatsNew.close(); },
});
</script>
