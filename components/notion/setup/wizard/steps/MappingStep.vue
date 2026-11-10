<!--
@component MappingStep
@kind component
@category input
@description Setup wizard step for mapping Notion database properties to kan-do task fields
@usage Used in the Notion setup wizard flow as a dedicated step for property mapping configuration
@avoid Only a step of the Notion setup wizard.
@responsibility
- Wraps the PropertyMapper component
- Handles saving and emitting mapping configuration
- Provides an exposed save method for parent components
-->
<template>
  <div class="space-y-4">
    <PropertyMapper
      ref="propertyMapper"
      :database-schema="databaseSchema"
      :default-mapping="defaultMapping"
      @saved="$emit('saved', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import PropertyMapper from "../../mapping/PropertyMapper.vue";
import type { NotionDatabaseSchema, NotionPropertyMapping } from "~/types/notion";

defineOptions({ name: 'NotionMappingStep' });

defineProps<{
  /** Database schema containing available Notion properties */ databaseSchema: NotionDatabaseSchema;
  /** Optional initial mapping configuration */ defaultMapping?: NotionPropertyMapping;
}>();

defineEmits<{
  /** Emitted when mapping is saved and validated */
  (e: "saved", mapping: NotionPropertyMapping): void;
}>();

const propertyMapper = ref<InstanceType<typeof PropertyMapper> | null>(null);

/**
 * Triggers save on the PropertyMapper component
 */
function save() {
  propertyMapper.value?.save();
}

/** True once every mandatory field is mapped; false while the schema is still loading */
const isMappingValid = computed(() => propertyMapper.value?.isMappingValid ?? false);

defineExpose({
  save,
  isMappingValid,
});
</script>
