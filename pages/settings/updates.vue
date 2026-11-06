<!--
@component UpdatesSettingsPage
@description Desktop-only sub-page /settings/updates: which version runs, whether updates work and why
not, and where the log file lives (#225, ADR 009). Mostly text; the update itself is installed from
UpdateDialog.
@usage Command palette "Version & Updates", "Nach Updates suchen" for any outcome but an update or up to date, the start-up toast's dialog
@responsibility
- Show the app version and the last check; "Nach Updates suchen" runs one check and opens the dialog when an update exists
- Explain every outcome in one calm sentence (rejected, offline, no release, rate limit, not configured, error); updates need no token (public releases)
- Link to /settings/github when the optional token is rejected; reveal the log folder in the Finder
- Same sub-page pattern as /settings/data and /settings/github: one flat column, no cards; web redirects to /tasks
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
    <div class="space-y-10">
      <section aria-labelledby="updates-version-heading" class="space-y-3">
        <h2 id="updates-version-heading" class="section-heading">
          {{ t('settings.updates.versionHeading') }}
        </h2>
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p class="font-mono text-sm text-highlighted" data-testid="updates-version">
            {{ t('settings.updates.versionLine', { version: state.appVersion ?? '…' }) }}
          </p>
          <div class="flex items-center gap-3">
            <UButton
              variant="soft"
              color="neutral"
              :loading="state.checking"
              :disabled="state.installing"
              data-testid="updates-check"
              @click="onCheck"
            >
              {{ retryable ? t('settings.updates.retry') : t('settings.updates.check') }}
            </UButton>
            <UButton variant="link" color="neutral" class="px-0" data-testid="updates-whats-new" @click="whatsNew.openReopen()">
              {{ t('settings.updates.whatsNew') }}
            </UButton>
          </div>
        </div>
        <div class="space-y-1" role="status" aria-live="polite">
          <p v-if="statusLine" class="text-sm" :class="statusClass" data-testid="updates-status">{{ statusLine }}</p>
          <p class="text-sm text-muted" data-testid="updates-last-checked">{{ lastCheckedLine }}</p>
        </div>
        <UButton
          v-if="update"
          variant="soft"
          color="neutral"
          data-testid="updates-details"
          @click="updater.openDialog()"
        >
          {{ t('settings.updates.details') }}
        </UButton>
      </section>

      <section aria-labelledby="updates-access-heading" class="space-y-3">
        <h2 id="updates-access-heading" class="section-heading">
          {{ t('settings.updates.accessHeading') }}
        </h2>
        <p class="text-sm text-muted">{{ t('settings.updates.accessBody') }}</p>
        <UButton
          v-if="offersGithubLink"
          to="/settings/github"
          variant="soft"
          color="neutral"
          icon="i-ph-key"
          data-testid="updates-open-github"
        >
          {{ t('settings.updates.openGithub') }}
        </UButton>
      </section>

      <section aria-labelledby="updates-log-heading" class="space-y-3">
        <h2 id="updates-log-heading" class="section-heading">
          {{ t('settings.updates.logHeading') }}
        </h2>
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p class="min-w-0 font-mono text-sm break-all text-highlighted" data-testid="updates-log-path">{{ logPath }}</p>
          <UButton variant="ghost" color="neutral" icon="i-ph-folder-open" data-testid="updates-log-reveal" @click="onRevealLog">
            {{ t('settings.updates.revealLog') }}
          </UButton>
        </div>
      </section>
    </div>
  </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppUpdater } from '~/composables/useAppUpdater';
import { useWhatsNew } from '~/composables/useWhatsNew';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import type { UpdateErrorReason, UpdateStatus } from '~/types/updater';

defineOptions({ name: 'UpdatesSettingsPage' });

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  middleware: 'desktop-only',
  titleKey: 'settings.updates.pageTitle',
  descriptionKey: 'settings.updates.pageDescription',
});

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const updater = useAppUpdater();
const whatsNew = useWhatsNew();
const { state, update } = updater;

const logPath = ref('');

/** Camel-case key segment per status, under `settings.updates.status.*`. */
const STATUS_KEYS: Record<UpdateStatus, string> = {
  'up-to-date': 'upToDate',
  available: 'available',
  rejected: 'rejected',
  offline: 'offline',
  'no-release-or-access': 'noReleaseOrAccess',
  'rate-limited': 'rateLimited',
  'not-configured': 'notConfigured',
  error: 'error',
};

const REASON_KEYS: Record<UpdateErrorReason, string> = {
  'manifest-missing': 'manifestMissing',
  'manifest-invalid': 'manifestInvalid',
  'no-platform': 'noPlatform',
  keychain: 'keychain',
  api: 'api',
  unknown: 'unknown',
};

const status = computed(() => state.result?.status ?? null);
const retryable = computed(() => status.value === 'offline' || status.value === 'rate-limited' || status.value === 'error');
/** The GitHub access page is the way forward for a rejected token; without a token, updates need none. */
const offersGithubLink = computed(() => status.value === 'rejected');

const statusLine = computed(() => {
  if (state.checking) return t('settings.updates.checking');
  const result = state.result;
  if (!result) return null;
  if (result.status === 'available') return t('settings.updates.status.available', { version: result.version ?? '' });
  if (result.status === 'error') return t(`settings.updates.status.errorReason.${REASON_KEYS[result.reason ?? 'unknown']}`);
  return t(`settings.updates.status.${STATUS_KEYS[result.status]}`);
});

/** Orange only for "fix this first" (token rejected); a failed check is plain text, not a failure of the app. */
const statusClass = computed(() => (!state.checking && status.value === 'rejected' ? 'text-warning-700' : 'text-default'));

const lastCheckedLine = computed(() =>
  state.lastCheckedAt
    ? t('settings.updates.lastChecked', { time: formatDateTime(state.lastCheckedAt, 'mediumDateShortTime') })
    : t('settings.updates.neverChecked'),
);

async function onCheck() {
  const result = await updater.check();
  if (result?.status === 'available') updater.openDialog();
}

async function onRevealLog() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_reveal');
  } catch {
    // Revealing is a convenience; the path above stays readable.
  }
}

async function loadLogPath() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    logPath.value = await invoke<string>('log_location');
  } catch {
    logPath.value = '';
  }
}

onMounted(() => {
  void updater.loadVersion();
  void updater.hydrate();
  void loadLogPath();
});
</script>
