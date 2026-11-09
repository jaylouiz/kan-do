/**
 * @composable useIsDesktop
 * @description The one desktop breakpoint (`lib/breakpoints.ts`, 768px) ("desktop" = the viewport is at least 768px wide) as a live ref.
 * @responsibility
 * - Single source for the modal-or-drawer choice: `ResponsiveOverlay`, the task detail layout and the topic editor
 * - `useOverlayIsDesktop()` follows the enclosing overlay's variant when there is one, the live query otherwise
 * - Read synchronously on the client (SPA, SSR is off), so the first render already has the right variant
 */

import { inject, type InjectionKey, type Ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { BREAKPOINT_QUERIES } from '~/lib/breakpoints';

export const DESKTOP_QUERY = BREAKPOINT_QUERIES.desktop;

/**
 * Provided by `ResponsiveOverlay`: the variant it actually renders (modal/slideover vs drawer).
 * It is fixed while the overlay is open, so the content never disagrees with its shell after a resize (#199).
 */
export const OVERLAY_DESKTOP_KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol('overlay-desktop');

/** Live: follows the viewport. Call in setup. */
export const useIsDesktop = (): Readonly<Ref<boolean>> => useMediaQuery(DESKTOP_QUERY);

/**
 * For content hosted by a `ResponsiveOverlay`: the overlay's frozen variant, or the live query when the content
 * is rendered outside one (a preview, a settings page). Call in setup.
 */
export const useOverlayIsDesktop = (): Readonly<Ref<boolean>> => inject(OVERLAY_DESKTOP_KEY, null) ?? useIsDesktop();
