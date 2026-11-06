<!--
@component ExternalLink
@description Link to an external page. In the desktop app it opens in the system browser through
tauri-plugin-opener (narrow URL permission in src-tauri/capabilities); on web it is a plain
`<a target="_blank">`.
@usage <ExternalLink href="https://www.notion.so/my-integrations">Manage token</ExternalLink>
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
import { useErrorHandler } from '~/composables/useErrorHandler';
import { isTauri } from '~/utils/isTauri';

defineOptions({ name: 'ExternalLink' });

const { handleError } = useErrorHandler();

interface Props {
  href: string;
}

const props = defineProps<Props>();

async function open(event: MouseEvent) {
  if (!isTauri()) return;
  event.preventDefault();
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(props.href);
  } catch (error) {
    // The click is already default-prevented, so a rejection would otherwise be silent.
    handleError(error instanceof Error ? error : String(error), 'external_link');
  }
}
</script>
