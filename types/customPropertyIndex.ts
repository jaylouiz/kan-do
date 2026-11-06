import type { CustomPropertyType } from "~/types/notion";
import type { TaskCustomValue } from "~/types/task";

/**
 * Index structure for efficient custom property queries
 */
export interface CustomPropertyIndex {
  propertyKey: string;
  valueType: CustomPropertyType;
  taskIdsByValue: Record<string, string[]>; // Changed from Map<string, Set<string>>
}

/**
 * Extract a string key from a custom property value for indexing
 */
export function extractValueKey(value: TaskCustomValue): string {
  switch (value.type) {
    case 'select':
      return value.value?.name ?? '';
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return value.value ?? '';
    case 'number':
      return String(value.value ?? 0);
    case 'checkbox':
      return String(value.value);
    case 'date':
      return value.value?.start ?? '';
    case 'multi_select':
      return value.value.map(v => v.name).join(',');
    default:
      return '';
  }
}

/**
 * Create an empty index for a property
 */
export function createCustomPropertyIndex(
  propertyKey: string,
  valueType: CustomPropertyType
): CustomPropertyIndex {
  return {
    propertyKey,
    valueType,
    taskIdsByValue: {}, // Changed from new Map()
  };
}
