import { isTauri } from '~/utils/isTauri';

/**
 * Desktop-only routes (e.g. /settings/github): the web build has no Keychain, so the route does not
 * exist there and redirects to the board.
 */
export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return;
  if (!isTauri()) return navigateTo('/tasks', { replace: true });
});
