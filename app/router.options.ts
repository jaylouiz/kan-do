/**
 * Router configuration for custom scroll behavior
 * Preserves scroll position when navigating to nested task detail routes
 */
import type { RouterConfig } from '@nuxt/schema'

// Store scroll position when navigating away from board to task detail
let boardScrollPosition = { left: 0, top: 0 };

/** Pages that host the task sheet as a child route (`/tasks/:id`, `/statistics/:id`). */
const SHEET_HOSTS = ['/tasks', '/statistics'];

/** The sheet host of a path, when the path is the host page or one of its child routes. */
const sheetHostOf = (path: string) => SHEET_HOSTS.find(host => path === host || path.startsWith(`${host}/`));

export default <RouterConfig> {
  scrollBehavior(to, from, savedPosition) {
    const toHost = sheetHostOf(to.path);
    const fromHost = sheetHostOf(from.path);

    // Opening a task (host page -> child route): keep the page where it is under the sheet
    if (toHost && toHost === fromHost && from.path === toHost && to.path !== toHost) {
      boardScrollPosition = { left: window.scrollX, top: window.scrollY };
      return { left: window.scrollX, top: window.scrollY, behavior: 'instant' };
    }

    // Closing the sheet (child route -> host page): restore the saved scroll position
    if (toHost && toHost === fromHost && to.path === toHost && from.path !== toHost) {
      return { ...boardScrollPosition, behavior: 'instant' };
    }

    // For all other navigations, use saved position or scroll to top
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0, left: 0 };
  }
}
