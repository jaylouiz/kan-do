import { useAppConfig } from "#app";
import type { FeatureFlags } from "~/types/featureFlags";

/**
 * Accessor for globally configured feature flags.
 */
export const useFeatureFlags = (): FeatureFlags => {
  const { featureFlags } = useAppConfig();
  return featureFlags as FeatureFlags;
};
