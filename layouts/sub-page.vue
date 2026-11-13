<!--
@component SubPageLayout
@description Shared layout for sub-pages with a scrolling header and consistent styling
@usage Apply via definePageMeta({ layout: 'sub-page' }) in pages
@responsibility
- Provide consistent page structure for sub-pages (settings, statistics, etc.), below the app bar (#470); a page with `definePageMeta({ backTo })` (the settings sub-pages, #236) starts its column with the `BackButton` "Zurück zu Einstellungen", the pages the app bar leads to (Einstellungen, Papierkorb, Statistik) have none
- Stays out of the way of the phone bar: the content pads by --phone-bar-offset
- Render PageHeader with title/description from route meta, except on a page with `definePageMeta({ pageHeader: false })`
  (Einstellungen, Papierkorb, Statistik; #670, #686): the app bar's pill already names it, so the title stays only as a
  screen-reader-only h1 (the page keeps its heading outline) and the content takes over the header's `pt-safe`
- Wrap content in one centred column on the app bar's axis (#673): the full container (`max-w-5xl`, 992 px of content at 1280)
  by default, a 672 px reading column (`max-w-2xl` on a div inside the padded `main`, so the content is 672 px and not less)
  on a page with `definePageMeta({ pageWidth: 'narrow' })` (Einstellungen and its sub-pages, Papierkorb). The header follows
  the same column (`PageHeader` `narrow`). The pages carry no width class of their own
-->
<template>
  <div class="sub-page bg-page">
    <PageHeader
      v-if="showsHeader"
      :title="pageTitle"
      :description="pageDescription"
      :narrow="isNarrow"
    >
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </PageHeader>
    <h1 v-else class="sr-only">{{ pageTitle }}</h1>

    <div class="px-safe" :class="{ 'pt-safe': !showsHeader }">
      <main class="mx-auto max-w-5xl px-4 py-8">
        <div data-testid="sub-page-column" :class="{ 'mx-auto max-w-2xl': isNarrow }">
          <div v-if="backTo" class="mb-4 flex">
            <BackButton :label="t('common.backToSettings')" :to="backTo" />
          </div>
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BackButton from '~/components/ui/BackButton.vue';
import PageHeader from '~/components/ui/PageHeader.vue';

defineOptions({ name: 'SubPageLayout' });

const route = useRoute();
const { t } = useI18n();

/** Named by the app bar already (#670): no visible header */
const showsHeader = computed(() => route.meta.pageHeader !== false);

/** A deeper route leads back to its parent (#236): only the settings sub-pages name one */
const backTo = computed(() => (typeof route.meta.backTo === 'string' ? route.meta.backTo : undefined));

/** One 672 px column on the axis instead of the full container (#673) */
const isNarrow = computed(() => route.meta.pageWidth === 'narrow');

const pageTitle = computed(() => {
  const key = route.meta.titleKey as string | undefined;
  if (key) return t(key);
  return (route.meta.title as string) || t('common.settings');
});

const pageDescription = computed(() => {
  const key = route.meta.descriptionKey as string | undefined;
  if (key) return t(key);
  return (route.meta.description as string) || undefined;
});
</script>

<style scoped>
/* Fills the viewport below the desktop app bar (min-h-screen would add the bar's 3.5rem and scroll every short
   page); on a phone the bar floats at the bottom and the last content stays clear of it (both offsets: app-nav.css) */
.sub-page {
  min-height: calc(100vh - var(--app-bar-offset-top));
  min-height: calc(100dvh - var(--app-bar-offset-top));
  padding-bottom: var(--phone-bar-offset);
}
</style>
