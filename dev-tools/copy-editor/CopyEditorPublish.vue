<!--
@component CopyEditorPublish
@description The Publish review of the live copy editor (#59, dev only): every collected edit with before and after
in both languages, the agent drafts marked, then two explicit steps: translate the agent languages, push a PR.
Loading (translation or push running), error (kept edits, step named) and done (PR link) states are shown here.
@usage Right pane of CopyEditorDialog in its "publish" view.
@responsibility Present edits and drive `publish.ts`. Never pushes before the drafts have been shown.
-->
<template>
  <div class="flex flex-col gap-3 p-4" data-testid="copy-editor-publish-view">
    <p class="text-sm" data-testid="copy-editor-count">
      <template v-if="pendingEdits.length">{{ pendingEdits.length }} {{ pendingEdits.length === 1 ? 'edit' : 'edits' }} in 2 files ({{ LOCALE_FILES }})</template>
      <template v-else>No edits to publish yet. Pick text on the page or press ⌥K and save an edit.</template>
    </p>

    <ul v-if="pendingEdits.length" class="flex flex-col gap-2">
      <li v-for="entry in pendingEdits" :key="entry.key" class="rounded-lg border border-default p-3 text-sm" :data-testid="`copy-editor-row-${entry.key}`">
        <p class="font-mono text-xs break-all text-muted">{{ entry.key }}</p>
        <p v-for="lang in LANGS" :key="lang" class="mt-1">
          <span class="font-medium">{{ lang.toUpperCase() }}</span>
          <template v-if="entry[lang] === baseValue(entry.key, lang)">
            <span class="text-muted"> · {{ entry.written === lang ? 'unchanged' : 'not translated yet (agent)' }}</span>
          </template>
          <template v-else>
            · <del class="text-muted">{{ baseValue(entry.key, lang) }}</del> → <ins class="no-underline">{{ entry[lang] }}</ins>
            <UBadge v-if="entry.written !== lang && entry.other === 'draft'" color="warning" variant="subtle" size="sm" class="ml-1">agent draft</UBadge>
          </template>
        </p>
        <p v-if="entry.draftProblems?.length" class="mt-1 text-error">Draft rejected: {{ entry.draftProblems.join('; ') }}. Write it yourself in the editor or retry.</p>
        <UButton type="button" size="xs" color="neutral" variant="link" class="mt-1 -ml-1" @click="openEditor(entry.key)">Edit</UButton>
      </li>
    </ul>

    <UAlert v-if="errors.length" color="error" variant="subtle" icon="i-ph-warning-circle" title="Not published, your edits are kept" data-testid="copy-editor-error">
      <template #description>
        <p v-for="line in errors" :key="line" class="whitespace-pre-wrap">{{ line }}</p>
      </template>
    </UAlert>

    <UAlert v-if="result" color="success" variant="subtle" icon="i-ph-check-circle" :title="`Published ${result.edits} ${result.edits === 1 ? 'edit' : 'edits'} on ${result.branch}`" data-testid="copy-editor-done">
      <template #description>
        <a v-if="result.prUrl" :href="result.prUrl" target="_blank" rel="noopener" class="underline">{{ result.prUrl }}</a>
        <p v-if="result.note">{{ result.note }}</p>
        <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
      </template>
    </UAlert>

    <div v-if="pendingEdits.length" class="flex flex-wrap items-center gap-2">
      <UButton v-if="needsTranslation.length" color="neutral" :loading="phase === 'translating'" :disabled="phase !== 'idle'" icon="i-ph-translate" data-testid="copy-editor-translate" @click="translateDrafts">
        {{ phase === 'translating' ? 'Agent is translating…' : `Translate ${needsTranslation.length} with the agent` }}
      </UButton>
      <UButton color="primary" :loading="phase === 'publishing'" :disabled="phase !== 'idle' || needsTranslation.length > 0" icon="i-ph-git-pull-request" data-testid="copy-editor-push" @click="pushPullRequest">
        {{ phase === 'publishing' ? 'Checking and pushing…' : 'Push PR' }}
      </UButton>
      <p v-if="needsTranslation.length" class="text-sm text-muted">Translate first: you review the drafts before anything is pushed.</p>
    </div>

    <div v-if="publishedEdits.length" class="flex flex-wrap items-center gap-2 border-t border-default pt-3 text-sm text-muted">
      <p>{{ publishedEdits.length }} published, still shown in the app.</p>
      <UButton type="button" size="xs" color="neutral" variant="link" data-testid="copy-editor-clear-published" @click="clearPublished">Clear published</UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { baseValue, clearPublished, needsTranslation, openEditor, pendingEdits, publishedEdits, type Lang } from './edits'
import { errors, phase, pushPullRequest, result, translateDrafts } from './publish'

defineOptions({ name: 'CopyEditorPublish' })

const LANGS: Lang[] = ['de', 'en']
const LOCALE_FILES = 'de.json, en.json'
</script>
