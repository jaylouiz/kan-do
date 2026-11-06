/**
 * Router configuration for custom scroll behavior
 * Preserves scroll position when navigating to nested task detail routes
 */
import type { RouterConfig } from '@nuxt/schema'

// Store scroll position when navigating away from board to task detail
let boardScrollPosition = { left: 0, top: 0 };

export default <RouterConfig> {
  scrollBehavior(to, from, savedPosition) {
    // When opening a task detail modal (navigating from board to detail)
    // Save the current scroll position
    if (to.path.startsWith('/tasks/') && from.path === '/tasks') {
      boardScrollPosition = { left: window.scrollX, top: window.scrollY };
      // Keep current scroll visual for the transition
      return { left: window.scrollX, top: window.scrollY, behavior: 'instant' };
    }

    // When closing the modal (navigating back to /tasks)
    // Restore the saved scroll position
    if (to.path === '/tasks' && from.path.startsWith('/tasks/')) {
      return { ...boardScrollPosition, behavior: 'instant' };
    }
    
    // For all other navigations, use saved position or scroll to top
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0, left: 0 };
  }
}
