<!--
@component GithubSettingsPage
@description Desktop-only sub-page /settings/github: paste, test and remove the two GitHub tokens
(`updates`, `feedback`) that live in the macOS Keychain (#223, ADR 007).
@usage Command palette "GitHub-Zugriff", or a deep link from the update (#225) and feedback (#227) notices
@responsibility
- Same sub-page pattern as /settings/data: PageHeader with back link, one flat column, no cards
- Load the status of both entries when the page opens (lazy Keychain read), then check saved tokens once
- Show a single sentence and no fields when the Keychain cannot be read
-->
<template>
  <NuxtLayout name="sub-page">
    <div class="space-y-10">
      <p v-if="tokens.keychainUnavailable.value" class="text-body text-muted" role="status" data-testid="github-keychain-unavailable">
        {{ t('settings.github.keychainUnavailable') }}
      </p>
      <template v-else-if="tokens.loaded.value">
        <GithubTokenRow entry="github-updates" />
        <GithubTokenRow entry="github-feedback" />
      </template>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import GithubTokenRow from '~/components/settings/GithubTokenRow.vue';
import { useGithubTokens } from '~/composables/useGithubTokens';

defineOptions({ name: 'GithubSettingsPage' });

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  middleware: 'desktop-only',
  titleKey: 'settings.github.pageTitle',
  descriptionKey: 'settings.github.pageDescription',
});

const { t } = useI18n();
const tokens = useGithubTokens();

// Saved tokens are verified once per visit (#241); the page is usable while that runs.
onMounted(() => { void tokens.load().then(() => tokens.checkOnOpen()); });
</script>
