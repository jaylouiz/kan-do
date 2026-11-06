/**
 * @module reloadApp
 * @description The one place that reloads the window after the data file was replaced underneath the
 * stores (restore, import, "Ihre laden", folder switch). The stores re-hydrate from `data_load`; older
 * schemas go through the normal migration chain on that load.
 */
export function reloadApp(): void {
  // typeof check (not import.meta.client) so it also runs under Vitest/jsdom.
  if (typeof window !== 'undefined') window.location.reload()
}
