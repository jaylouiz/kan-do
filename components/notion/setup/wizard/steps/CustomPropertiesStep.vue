<!--
@component CustomPropertiesStep
@kind component
@category form-structure
@description Dedicated step to select additional (read-only) Notion properties to import
@usage Part of the Notion setup wizard after core property mapping
@avoid Only a step of the Notion setup wizard; not for editing mappings later outside the wizard.
@responsibility
- Lists eligible Notion properties that are not already mapped as core fields
- Allows enabling/disabling and labeling of each custom property
- Emits selected custom properties on save
-->
<template>
  <div class="space-y-4">
    <div class="text-sm text-muted">
      {{ t('notion.customProps.intro') }}
    </div>

    <div class="divide-y divide-default rounded-md border border-default bg-elevated/50">
      <div
        v-for="prop in eligibleCustomProps"
        :key="prop.name"
        class="flex items-center justify-between gap-4 p-4"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ prop.name }}</span>
            <UBadge color="neutral" variant="subtle" size="xs">{{ prop.type }}</UBadge>
          </div>
          <div class="mt-1 truncate text-xs text-muted">{{ t('notion.customProps.keyLabel', { key: customSelections[prop.name]?.key }) }}</div>
        </div>
        
        <div class="flex shrink-0 items-center gap-3">
          <transition 
            enter-active-class="transition duration-(--duration-base) ease-out"
            enter-from-class="opacity-0 translate-x-2"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition duration-(--duration-fast) ease-in"
            leave-from-class="opacity-100 translate-x-0"
            leave-to-class="opacity-0 translate-x-2"
          >
            <div v-if="customSelections[prop.name]?.enabled" class="w-48">
              <UInput 
                v-model="customSelections[prop.name]!.label" 
                :placeholder="t('notion.customProps.labelPlaceholder')" 
                size="sm" 
                class="w-full" 
              />
            </div>
          </transition>
          <USwitch v-model="customSelections[prop.name]!.enabled" />
        </div>
      </div>

      <EmptyNote v-if="eligibleCustomProps.length === 0" class="p-6 text-center">
        {{ t('notion.customProps.empty') }}
      </EmptyNote>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import type { NotionCustomPropertyConfig, NotionDatabaseSchema, NotionPropertyMapping, CustomPropertyType } from '~/types/notion'

defineOptions({ name: 'NotionCustomPropertiesStep' })

/**
 * Props
 * @prop {NotionDatabaseSchema} databaseSchema Database schema containing available Notion properties
 * @prop {NotionPropertyMapping=} defaultMapping Mapping from previous step, used to exclude core fields and prefill selections
 */
const props = defineProps<{ 
  /** Database schema containing available Notion properties */ databaseSchema: NotionDatabaseSchema,
  /** Mapping from previous step, used to exclude core fields and prefill selections */ defaultMapping?: NotionPropertyMapping
}>()

const emit = defineEmits<{ (e: 'saved', config: NotionCustomPropertyConfig[]): void }>()

// Core field set for exclusion - dynamically collect all fields mapped to standard properties
const CORE_FIELD_NAMES = computed(() => {
  if (!props.defaultMapping) return new Set<string>()
  
  const mappedFields = new Set<string>()
  
  // Collect all non-null/non-undefined values from standard property mappings
  for (const value of Object.values(props.defaultMapping)) {
    if (typeof value === 'string' && value.length > 0) {
      mappedFields.add(value)
    }
  }
  
  return mappedFields
})

// Normalize Notion property types to our custom type union
const normalizeNotionType = (t: string): CustomPropertyType | null => {
  switch (t) {
    case 'title':
    case 'rich_text':
      return 'text'
    case 'number':
      return 'number'
    case 'select':
      return 'select'
    case 'multi_select':
      return 'multi_select'
    case 'date':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'url':
      return 'url'
    case 'email':
      return 'email'
    case 'phone_number':
      return 'phone_number'
    default:
      return null
  }
}

const { t } = useI18n()
const { compareText } = useLocaleFormat()

type EligibleProp = { name: string; type: CustomPropertyType }

const eligibleCustomProps = computed<EligibleProp[]>(() => {
  if (!props.databaseSchema) return []
  const out: EligibleProp[] = []
  const core = CORE_FIELD_NAMES.value
  for (const [name, p] of Object.entries(props.databaseSchema)) {
    if (!name || !p || core.has(name)) continue
    const norm = normalizeNotionType(p.type)
    if (norm) out.push({ name, type: norm })
  }
  return out.sort((a, b) => compareText(a.name, b.name))
})

// Local UI state keyed by Notion property name
const customSelections = ref<Record<string, { enabled: boolean; label: string; key: string; type: CustomPropertyType }>>({})

const slugify = (s: string) => s
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')

// Initialize from defaults and eligible props
function initCustomSelections() {
  const current = props.defaultMapping?.customProperties || []
  const byName = new Map(current.map(c => [c.name, c]))
  const byKey = new Map(current.map(c => [c.key, c]))
  const bySlug = new Map(current.map(c => [slugify(c.name), c]))
  const tmp: Record<string, { enabled: boolean; label: string; key: string; type: CustomPropertyType }> = {}

  for (const prop of eligibleCustomProps.value) {
    // Prefer exact name match
    let existing = byName.get(prop.name)
    // Try slug-of-name match to be robust to accents/emoji/case
    if (!existing) {
      const slug = slugify(prop.name)
      existing = bySlug.get(slug) || byKey.get(slug)
    }
    // Final fallback: case-insensitive comparison
    if (!existing) {
      const lower = prop.name.toLowerCase()
      existing = current.find(c => c.name.toLowerCase() === lower)
    }

    const key = existing?.key || slugify(prop.name)
    tmp[prop.name] = {
      enabled: existing?.enabled ?? false,
      label: existing?.label || prop.name,
      key,
      type: prop.type,
    }
  }

  customSelections.value = tmp
}

watch(eligibleCustomProps, initCustomSelections, { immediate: true })
watch(CORE_FIELD_NAMES, initCustomSelections)
watch(() => props.defaultMapping, initCustomSelections, { deep: true })

function buildCustomProperties(): NotionCustomPropertyConfig[] {
  const list: NotionCustomPropertyConfig[] = []
  for (const prop of eligibleCustomProps.value) {
    const sel = customSelections.value[prop.name]
    if (!sel) continue
    list.push({
      name: prop.name,
      type: sel.type,
      enabled: !!sel.enabled,
      label: sel.label || prop.name,
      key: sel.key
    })
  }
  return list
}

function save() {
  const customs = buildCustomProperties()
  emit('saved', customs)
}

defineExpose({ save })
</script>
