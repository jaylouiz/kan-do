/**
 * @module reloadApp
 * @description The one place that reloads the window after the data file was replaced underneath the
 * stores (restore, import, "Ihre laden", folder switch). The stores re-hydrate from `data_load`; older
 * schemas go through the normal migration chain on that load. With a `path` it loads that route instead (reset, kd#227).
 */
export function reloadApp(path?: string): void {
  // typeof check (not import.meta.client) so it also runs under Vitest/jsdom.
  if (typeof window === 'undefined') return
  // A reset lands on the welcome page: a plain reload would stay on the settings page it was started from.
  if (path) window.location.replace(path)
  else window.location.reload()
}
