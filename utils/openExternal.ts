import { useErrorHandler } from '~/composables/useErrorHandler';
import { isTauri } from '~/utils/isTauri';

/**
 * Opens a page outside the app (#71): the system browser through tauri-plugin-opener on desktop (a webview's own
 * `window.open` is not the user's browser), a new tab on web. The one implementation behind `ExternalLink` and the
 * menu items that open a source page; an opener failure goes through `useErrorHandler` (context `external_link`),
 * never silently.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (error) {
    useErrorHandler().handleError(error instanceof Error ? error : String(error), 'external_link');
  }
}
