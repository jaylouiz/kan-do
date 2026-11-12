<!--
@component GithubTokenRow
@kind component
@category input
@description One GitHub token entry on /settings/github: purpose, required access and the state area
(empty, checking, saved, rejected, error). Flat section, no card (DESIGN.md sub-page pattern).
@usage <GithubTokenRow entry="github-updates" />
@avoid Only the GitHub token entries on /settings/github; the Notion token is TokenStep.
@responsibility
- Show the state of one Keychain entry: only the last four characters are ever visible
- Paste, check and store a token ("Speichern"), re-check it ("Testen"), remove it with undo ("Entfernen")
- Keep focus on the field after remove and on the remove button after undo
-->
<template>
  <PageSheet tag="section" :aria-labelledby="headingId" class="space-y-3">
    <div class="space-y-1">
      <SectionHeader :id="headingId" tag="h2">
        {{ t(`settings.github.${key}.title`) }}
      </SectionHeader>
      <p class="text-body text-muted">{{ t(`settings.github.${key}.purpose`) }}</p>
      <p class="text-body text-muted">{{ t(`settings.github.${key}.access`) }}</p>
    </div>

    <!-- Saved -->
    <div v-if="state === 'saved'" class="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="github-token-saved">
      <p class="flex items-center gap-2 text-sm">
        <span class="font-mono text-muted" aria-hidden="true">{{ masked }}</span>
        <span class="sr-only">{{ t('settings.github.savedAria', { last4: row.last4 ?? '' }) }}</span>
        <span class="flex items-center gap-1 text-muted" role="status">
          <UIcon
            :name="row.checking ? 'i-ph-circle-notch' : row.valid ? 'i-ph-check-circle' : 'i-ph-key'"
            :class="[row.checking ? 'motion-safe:animate-spin' : row.valid ? 'text-success' : 'text-muted']"
            class="size-4"
            aria-hidden="true"
          />
          {{ row.checking ? t('settings.github.checking') : row.valid ? t('settings.github.valid') : t('settings.github.stored') }}
        </span>
      </p>
      <div class="flex items-center gap-1">
        <UButton
          variant="ghost"
          color="neutral"
          :disabled="row.checking"
          @click="tokens.test(entry)"
        >
          {{ t('settings.github.test') }}
        </UButton>
        <UButton ref="removeButton" variant="ghost" color="neutral" :icon="ICONS.delete" :ui="{ leadingIcon: 'text-error' }" @click="onRemove">
          {{ t('settings.github.remove') }}
        </UButton>
      </div>
      <UAlert
        v-if="problemText"
        :color="isOfflineProblem ? 'neutral' : 'error'"
        variant="subtle"
        :icon="isOfflineProblem ? 'i-ph-info' : 'i-ph-warning-circle'"
        :role="isOfflineProblem ? 'status' : 'alert'"
        :description="problemText"
      />

      <!-- Screenshot upload (#247): only the feedback token uploads; the probe leaves nothing in the repository -->
      <div v-if="entry === 'github-feedback'" class="flex w-full flex-wrap items-center gap-x-4 gap-y-1" data-testid="github-upload-probe">
        <UButton
          variant="ghost"
          color="neutral"
          :loading="row.upload === 'checking'"
          :disabled="row.upload === 'checking'"
          @click="tokens.probeUpload(entry)"
        >
          {{ row.upload === 'checking' ? t('settings.github.probe.checking') : t('settings.github.probe.action') }}
        </UButton>
        <UAlert
          v-if="probeText"
          :color="row.upload === 'allowed' ? 'success' : 'warning'"
          variant="subtle"
          class="w-auto"
          :icon="row.upload === 'allowed' ? 'i-ph-check-circle' : 'i-ph-warning-circle'"
          role="status"
          :description="probeText"
          data-testid="github-upload-probe-result"
        />
        <ExternalLink
          v-if="row.upload === 'denied'"
          :href="manageTokensUrl"
          class="inline-flex items-center gap-1 rounded-sm text-sm text-highlighted underline underline-offset-2 focus-ring"
        >
          {{ t('settings.github.probe.changeToken') }}
          <UIcon :name="ICONS.external" class="size-4" aria-hidden="true" />
        </ExternalLink>
      </div>
    </div>

    <!-- Empty, checking and rejected share the field -->
    <div v-else class="space-y-3" :data-testid="state === 'rejected' ? 'github-token-rejected' : 'github-token-empty'">
      <template v-if="state === 'rejected'">
        <p class="text-body" role="status">
          <span class="font-mono text-muted" aria-hidden="true">{{ masked }}</span>
          <span class="sr-only">{{ t('settings.github.savedAria', { last4: row.last4 ?? '' }) }}</span>
        </p>
        <UAlert color="error" variant="subtle" icon="i-ph-warning-circle" role="status" :description="t('settings.github.rejectedLine')" />
      </template>
      <ExternalLink
        :href="tokenUrl"
        class="inline-flex items-center gap-1 rounded-sm text-sm text-highlighted underline underline-offset-2 focus-ring"
      >
        {{ t('settings.github.createToken') }}
        <UIcon :name="ICONS.external" class="size-4" aria-hidden="true" />
      </ExternalLink>
      <form class="flex flex-wrap items-start gap-2 sm:flex-nowrap" @submit.prevent="onSave">
        <UFormField
          :label="t('settings.github.fieldLabel', { name: title })"
          :error="isOfflineProblem ? false : (problemText ?? false)"
          :help="isOfflineProblem ? (problemText ?? undefined) : undefined"
          :ui="{ label: 'sr-only', root: 'min-w-0 flex-1' }"
        >
          <UInput
            ref="tokenInput"
            v-model="draft"
            type="password"
            :placeholder="t('settings.github.placeholder')"
            :disabled="row.checking"
            class="w-full"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
          />
        </UFormField>
        <UButton type="submit" variant="soft" color="neutral" :loading="row.checking" :disabled="!draft.trim() || row.checking">
          {{ row.checking ? t('settings.github.checking') : t('settings.github.save') }}
        </UButton>
      </form>
    </div>

    <p v-if="entry === 'github-feedback'" class="text-body text-muted">{{ t('settings.github.scopeHelp') }}</p>
  </PageSheet>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PageSheet from '~/components/ui/PageSheet.vue'
import { ICONS } from '~/lib/icons'
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ExternalLink from '~/components/ui/ExternalLink.vue';
import { GITHUB_ENTRY_KEY, useGithubTokens } from '~/composables/useGithubTokens';
import type { GithubSecretEntry } from '~/lib/secrets';

defineOptions({ name: 'GithubTokenRow' });

interface Props {
  entry: GithubSecretEntry;
}

const props = defineProps<Props>();

const { t } = useI18n();
const tokens = useGithubTokens();

const key = computed(() => GITHUB_ENTRY_KEY[props.entry]);
const headingId = computed(() => `github-${key.value}-heading`);
const title = computed(() => t(`settings.github.${key.value}.title`));
const row = computed(() => tokens.rows[props.entry]);
const masked = computed(() => `●●●● ${row.value.last4 ?? ''}`.trim());

// Fine-grained PATs are created here; the repository and permissions are chosen on GitHub.
const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
// Where an existing token's permissions are changed (inside the opener scope `github.com/settings/**`).
const manageTokensUrl = 'https://github.com/settings/personal-access-tokens';

const draft = ref('');
const tokenInput = ref<{ inputRef?: HTMLInputElement } | null>(null);
const removeButton = ref<{ $el?: HTMLElement } | null>(null);

type RowState = 'empty' | 'saved' | 'rejected';
const state = computed<RowState>(() => {
  if (!row.value.present || row.value.removed) return 'empty';
  return row.value.rejected ? 'rejected' : 'saved';
});

const problemText = computed(() => {
  const problem = row.value.problem;
  if (!problem) return null;
  // A failed test of a stored token is not "nothing stored".
  if (problem === 'offline' || problem === 'unverified' || problem === 'forbidden' || problem === 'notFound') {
    return t(`settings.github.problem.${problem}${row.value.present ? 'Test' : 'Save'}`, { permission: t(`settings.github.${key.value}.permission`) });
  }
  return t(`settings.github.problem.${problem}`);
});

// Offline or "could not check" is not a mistake in the field: shown as a calm help line, not as a field error.
const isOfflineProblem = computed(() => row.value.problem === 'offline' || row.value.problem === 'unverified');

const probeText = computed(() => {
  switch (row.value.upload) {
    case 'allowed': return t('settings.github.probe.allowed');
    case 'denied': return t('settings.github.probe.denied');
    case 'offline': return t('settings.github.probe.offline');
    case 'failed': return t('settings.github.probe.failed');
    default: return null;
  }
});

async function onSave() {
  const saved = await tokens.save(props.entry, draft.value);
  if (saved) {
    draft.value = '';
    return;
  }
  await nextTick();
  tokenInput.value?.inputRef?.focus();
}

async function focusField() {
  await nextTick();
  tokenInput.value?.inputRef?.focus();
}

async function focusRemove() {
  await nextTick();
  removeButton.value?.$el?.focus();
}

function onRemove() {
  tokens.remove(props.entry, () => { void focusRemove(); });
  void focusField();
}
</script>
