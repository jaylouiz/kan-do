import { ref, readonly, type Component } from 'vue';
import type { ButtonProps } from '@nuxt/ui';

/**
 * Configuration for a modal footer action button
 */
export interface ModalFooterAction {
  /** Unique key for the action */
  key: string;
  /** Button label (German UI) */
  label: string;
  /** Phosphor icon name (e.g., 'i-ph-play') */
  icon?: string;
  /** Button color */
  color?: ButtonProps['color'];
  /** Button variant */
  variant?: ButtonProps['variant'];
  /** Whether the button is in loading state */
  loading?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick: () => void;
}

/**
 * Footer configuration with semantic action groups
 */
export interface ModalFooterConfig {
  /** Secondary actions (left-aligned, e.g., cancel, back) */
  secondary: ModalFooterAction[];
  /** Primary actions (right-aligned, e.g., save, submit) */
  primary: ModalFooterAction[];
  /** Tertiary actions (right-aligned before primary, e.g., delete) */
  tertiary: ModalFooterAction[];
  /** A `markRaw` component rendered above the button row (the add form's "Speichern in" switch, #321) */
  lead?: Component;
}

// Shared reactive state (singleton pattern for same modal context)
const footerConfig = ref<ModalFooterConfig>({ secondary: [], primary: [], tertiary: [] });

/**
 * Composable for managing modal footer actions
 * 
 * @description Allows child pages to define their modal footer buttons,
 * while the parent modal controls rendering. Supports cancel, save, delete,
 * and custom actions with consistent styling.
 * 
 * @example
 * // In child page (e.g., pages/tasks/[id].vue)
 * const { setFooter, clearFooter } = useModalFooter();
 * 
 * onMounted(() => {
 *   setFooter({
 *     secondary: [{ key: 'close', label: 'Schließen', onClick: () => navigateTo('/tasks') }],
 *     tertiary: [{ key: 'delete', label: 'Löschen', color: 'error', onClick: handleDelete }],
 *     primary: [],
 *   });
 * });
 * 
 * onUnmounted(() => clearFooter());
 * 
 * // In parent modal (e.g., pages/tasks.vue)
 * const { footerConfig } = useModalFooter();
 * // Render footerConfig.value.left and footerConfig.value.right
 */
export function useModalFooter() {
  /**
   * Sets the footer configuration
   * @param config - The footer configuration with left and right actions
   */
  const setFooter = (config: ModalFooterConfig) => {
    footerConfig.value = config;
  };

  /**
   * Clears the footer configuration (call in onUnmounted)
   */
  const clearFooter = () => {
    footerConfig.value = { secondary: [], primary: [], tertiary: [] };
  };

  /**
   * Updates a specific action's properties (e.g., loading state)
   * @param key - The action key to update
   * @param updates - Partial properties to update
   */
  const updateAction = (key: string, updates: Partial<Omit<ModalFooterAction, 'key' | 'onClick'>>) => {
    const updateInArray = (actions: ModalFooterAction[]) => {
      const index = actions.findIndex(a => a.key === key);
      const current = actions[index];
      if (index !== -1 && current) {
        actions[index] = {
          key: current.key,
          label: updates.label ?? current.label,
          icon: updates.icon ?? current.icon,
          color: updates.color ?? current.color,
          variant: updates.variant ?? current.variant,
          loading: updates.loading ?? current.loading,
          disabled: updates.disabled ?? current.disabled,
          onClick: current.onClick,
        };
      }
    };
    
    updateInArray(footerConfig.value.secondary);
    updateInArray(footerConfig.value.tertiary);
    updateInArray(footerConfig.value.primary);
  };

  return {
    /** Readonly footer configuration for rendering */
    footerConfig: readonly(footerConfig),
    /** Set the complete footer configuration */
    setFooter,
    /** Clear footer configuration */
    clearFooter,
    /** Update a specific action's properties */
    updateAction,
  };
}
