<!--
@component TaskSheetActions
@kind component
@category action
@description Action row at the bottom of the task sheet (#244): open in source, move to source, Delete
@usage <TaskSheetActions :delete-label="…" :open-label="…" :move-targets="targets" @delete="…" @open="…" @move="…" /> in the sheet's footer
@avoid Only the task sheet's bottom row; card actions are TaskCardContextMenu.
@responsibility
- Quiet ghost buttons for the source actions (open in source, move to source with a dropdown of the targets, disabled ones as in the card menu), Delete last: soft error tone, trash icon, right-aligned
- Open and move only exist on boards with a connected source; a Local board shows Delete alone
- Delete only emits: the host runs the one shared, confirmed delete flow (never deletes by itself)
- Wraps at 390 px, labels stay readable; DOM order is the keyboard order, Delete last
-->
<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="task-sheet-actions">
    <UButton
      v-if="openLabel"
      color="neutral"
      variant="ghost"
      :icon="ICONS.external"
      data-testid="task-open-source"
      @click="emit('open')"
    >
      {{ openLabel }}
    </UButton>

    <UDropdownMenu v-if="moveTargets.length > 0" :items="moveItems" :content="{ sideOffset: 4 }">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-ph-swap"
        trailing-icon="i-ph-caret-down"
        data-testid="task-move-source"
      >
        {{ t('task.contextMenu.moveToSource') }}
      </UButton>
    </UDropdownMenu>

    <UButton
      color="error"
      variant="soft"
      :icon="ICONS.delete"
      class="ms-auto"
      data-testid="task-delete"
      @click="emit('delete')"
    >
      {{ deleteLabel }}
    </UButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ICONS } from '~/lib/icons'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'TaskSheetActions' })

const props = defineProps<{
  /** "In Notion öffnen"; null or empty when the task has no link to open */
  openLabel?: string | null
  /** The other sources the task can move to; empty on a single-source board */
  moveTargets: MoveTarget[]
  deleteLabel: string
}>()

const emit = defineEmits<{
  open: []
  move: [source: SourceId]
  delete: []
}>()

const { t } = useI18n()

const moveItems = computed(() => [
  props.moveTargets.map(target => ({
    label: target.name,
    icon: target.icon,
    ...(target.hint ? { description: target.hint } : {}),
    disabled: target.disabled,
    onSelect: () => emit('move', target.source),
  })),
])
</script>
