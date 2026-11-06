<!--
@component GithubTokenRow
@description One GitHub token entry on /settings/github: purpose, required access and the state area
(empty, checking, saved, rejected, error). Flat section, no card (DESIGN.md sub-page pattern).
@usage <GithubTokenRow entry="github-updates" />
@responsibility
- Show the state of one Keychain entry: only the last four characters are ever visible
- Paste, check and store a token ("Speichern"), re-check it ("Testen"), remove it with undo ("Entfernen")
- Keep focus on the field after remove and on the remove button after undo
-->
<template>
  <section :aria-labelledby="headingId" class="space-y-3">
    <div class="space-y-1">
      <h2 :id="headingId" class="font-display text-lg font-semibold tracking-tight text-highlighted">
        {{ t(`settings.github.${key}.title`) }}
      </h2>
      <p class="text-sm text-muted">{{ t(`settings.github.${key}.purpose`) }}</p>
      <p class="text-sm text-muted">{{ t(`settings.github.${key}.access`) }}</p>
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
        <UButton ref="removeButton" variant="ghost" color="neutral" icon="i-ph-trash" :ui="{ leadingIcon: 'text-error' }" @click="onRemove">
          {{ t('settings.github.remove') }}
        </UButton>
      </div>
      <p
        v-if="problemText"
        class="w-full text-sm"
        :class="isOfflineProblem ? 'text-muted' : 'text-error-700'"
        :role="isOfflineProblem ? 'status' : 'alert'"
      >
        {{ problemText }}
      </p>

      <!-- Screenshot upload (#247): only the feedback token uploads; the probe leaves nothing in the repository -->
      <div v-if="entry === 'github-feedback'" class="flex w-full flex-wrap items-center gap-x-4 gap-y-1" data-testid="github-upload-probe">
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="row.upload === 'checking'"
          :disabled="row.upload === 'checking'"
          @click="tokens.probeUpload(entry)"
        >
          {{ row.upload === 'checking' ? t('settings.github.probe.checking') : t('settings.github.probe.action') }}
        </UButton>
        <p v-if="probeText" class="flex items-center gap-1 text-sm" :class="row.upload === 'allowed' ? 'text-muted' : 'text-toned'" role="status" data-testid="github-upload-probe-result">
          <UIcon
            :name="row.upload === 'allowed' ? 'i-ph-check-circle' : 'i-ph-warning-circle'"
            :class="row.upload === 'allowed' ? 'text-success' : 'text-warning-700'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          {{ probeText }}
        </p>
        <ExternalLink
          v-if="row.upload === 'denied'"
          :href="manageTokensUrl"
          class="inline-flex items-center gap-1 rounded-sm text-sm text-highlighted underline underline-offset-2 focus-ring"
        >
          {{ t('settings.github.probe.changeToken') }}
          <UIcon name="i-ph-arrow-up-right" class="size-4" aria-hidden="true" />
        </ExternalLink>
      </div>
    </div>

    <!-- Empty, checking and rejected share the field -->
    <div v-else class="space-y-3" :data-testid="state === 'rejected' ? 'github-token-rejected' : 'github-token-empty'">
      <p v-if="state === 'rejected'" class="flex items-center gap-2 text-sm" role="status">
        <span class="font-mono text-muted" aria-hidden="true">{{ masked }}</span>
        <span class="sr-only">{{ t('settings.github.savedAria', { last4: row.last4 ?? '' }) }}</span>
        <UIcon name="i-ph-warning-circle" class="size-4 shrink-0 text-error" aria-hidden="true" />
        <span class="text-error-700">{{ t('settings.github.rejectedLine') }}</span>
      </p>
      <ExternalLink
        :href="tokenUrl"
        class="inline-flex items-center gap-1 rounded-sm text-sm text-highlighted underline underline-offset-2 focus-ring"
      >
        {{ t('settings.github.createToken') }}
        <UIcon name="i-ph-arrow-up-right" class="size-4" aria-hidden="true" />
      </ExternalLink>
      <form class="flex flex-wrap items-start gap-2 sm:flex-nowrap" @submit.prevent="onSave">
        <UFormField
          :label="t('settings.github.fieldLabel', { name: title })"
          :error="isOfflineProblem ? false : (problemText ?? false)"
          :help="isOfflineProblem ? (problemText ?? undefined) : undefined"
          :ui="{ label: 'sr-only', root: 'min-w-0 flex-1', error: 'text-error-700' }"
        >
          <UInput
            ref="tokenInput"
            v-model="draft"
            type="password"
            :placeholder="t('settings.github.placeholder')"
            :disabled="row.checking"
            :ui="{ base: 'placeholder:text-muted' }"
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

    <p v-if="entry === 'github-feedback'" class="text-sm text-muted">{{ t('settings.github.scopeHelp') }}</p>
  </section>
</template>

<script setup lang="ts">
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
