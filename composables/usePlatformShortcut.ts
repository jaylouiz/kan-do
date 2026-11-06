/**
 * Platform-aware shortcut hint (#161): macOS shows Cmd, everywhere else Strg/Ctrl.
 * The key handlers accept both `metaKey` and `ctrlKey` (see `isSubmitShortcut`), so a shortcut
 * never depends on a successful platform guess; the guess only picks the key named in the UI.
 */
import { useI18n } from 'vue-i18n';

/** Apple platforms (Mac, iPad with keyboard) use Cmd as the primary modifier. */
export function isApplePlatform(): boolean {
  // typeof guard instead of import.meta.client (false in Vitest), so the unit tests run the same path
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** True for Cmd+Enter (macOS) and Ctrl+Enter (elsewhere); the other modifier is accepted too. */
export function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

export function usePlatformShortcut() {
  const { t } = useI18n();
  const isApple = isApplePlatform();
  /** "Cmd" on macOS, "Strg" / "Ctrl" (by locale) elsewhere */
  const modifierLabel = isApple ? t('shortcut.cmd') : t('shortcut.ctrl');
  /** e.g. "Cmd + Enter" */
  const submitShortcut = t('shortcut.withEnter', { key: modifierLabel });
  return { isApple, modifierLabel, submitShortcut };
}
