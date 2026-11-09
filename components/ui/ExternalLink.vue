<!--
@component ExternalLink
@kind primitive
@category action
@description Link to an external page. In the desktop app it opens in the system browser through
tauri-plugin-opener (narrow URL permission in src-tauri/capabilities); on web it is a plain
`<a target="_blank">`.
@usage <ExternalLink href="https://www.notion.so/my-integrations">Manage token</ExternalLink>
@avoid Only for pages outside the app (opens the system browser on desktop); in-app links use NuxtLink.
@responsibility
- Keep the href real so middle-click, copy-link and screen readers behave on web
- Hand the URL to the opener plugin on desktop instead of navigating the webview
- Report an opener failure through useErrorHandler (context `external_link`), never swallow it
-->
<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    @click="open"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
import { isTauri } from '~/utils/isTauri';
import { openExternal } from '~/utils/openExternal';

defineOptions({ name: 'ExternalLink' });

interface Props {
  href: string;
}

const props = defineProps<Props>();

function open(event: MouseEvent) {
  // On web the anchor's own navigation (new tab, middle-click, copy-link) stays; only the desktop webview is redirected.
  if (!isTauri()) return;
  event.preventDefault();
  void openExternal(props.href);
}
</script>
