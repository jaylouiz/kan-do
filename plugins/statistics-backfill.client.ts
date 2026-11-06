import { useStatisticsBackfill } from '~/composables/useStatisticsBackfill';

/**
 * Plugin to handle scheduled statistics backfill operations
 * 
 * This plugin runs on client-side initialization and sets up
 * periodic checking for daily backfill requirements.
 */
export default defineNuxtPlugin((nuxtApp) => {
  // Only run on client side
  if (import.meta.server) {
    return;
  }

  const { runDailyBackfill, shouldRunDailyBackfill } = useStatisticsBackfill();

  // Run daily backfill on app startup if needed
  const runStartupBackfill = async () => {
    try {
      if (shouldRunDailyBackfill()) {
        console.log('[StatisticsBackfill] Running startup daily backfill');
        await runDailyBackfill();
      }
    } catch (error) {
      console.warn('Failed to run startup statistics backfill:', error);
    }
  };

  // Wait a bit after app startup before running backfill
  // to avoid interfering with critical initialization
  setTimeout(runStartupBackfill, 5000); // 5 seconds delay

  // Set up periodic checking (every 6 hours)
  const intervalId = setInterval(async () => {
    try {
      if (shouldRunDailyBackfill()) {
        console.log('[StatisticsBackfill] Running scheduled daily backfill');
        await runDailyBackfill();
      }
    } catch (error) {
      console.warn('Failed to run scheduled statistics backfill:', error);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds

  // Clean up interval when the app is closed/unmounted using Nuxt hook
  nuxtApp.hook('app:beforeMount', () => {
    // Register cleanup on window unload for browser tab close
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearInterval(intervalId);
      });
    }
  });

  return {
    provide: {
      statisticsBackfill: {
        runDailyBackfill,
      }
    }
  };
});
