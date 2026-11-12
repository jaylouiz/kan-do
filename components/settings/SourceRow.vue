<!--
@component SourceRow
@kind component
@category display
@description One connected task source on the "Verbindungen" page (#324): icon, name with the quiet
"Standard" badge, a status line and the actions that source offers. A hairline-divided list item, no card.
@usage <SourceRow v-for="row in connected" :key="row.id" :row="row" @set-default="..." @repair="..." @open-settings="..." @disconnect="..." />
@avoid Only a connected source on the Verbindungen page.
@responsibility
- Show the badge as text on the default row, "Als Standard festlegen" on every other row
- Status line: muted, warning tone for "Verbindung prüfen" (never an error colour, never a toast); the time
  text is plain, a separate visually hidden live region announces only the warning, so the 30 s refresh of
  "vor 3 Min." never interrupts a screen reader
- Offer repair / settings / disconnect only where the row data allows them (Local has none)
- Actions sit right-aligned and wrap under the name on a phone; every button is 44px high there
- Every button name contains the source ("Notion als Standard festlegen") so rows are told apart
-->
<template>
  <ListRow
    class="gap-y-3"
    :data-testid="`source-row-${row.id}`"
  >
    <UIcon :name="row.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
    <div class="min-w-0 flex-1 basis-40">
      <p class="flex items-center gap-2 text-default">
        {{ row.name }}
        <UBadge
          v-if="row.isDefault"
          color="neutral"
          variant="soft"
          :data-testid="`source-default-${row.id}`"
        >
          {{ t('sources.row.default') }}
        </UBadge>
      </p>
      <p
        class="text-sm"
        :class="row.statusTone === 'warning' ? 'text-warning-700' : 'text-muted'"
        :data-testid="`source-status-${row.id}`"
      >
        {{ row.statusText }}
      </p>
      <span class="sr-only" role="status">{{ announcement }}</span>
    </div>
    <div v-if="hasActions" class="flex flex-wrap gap-2">
      <UButton
        v-if="row.canSetDefault"
        color="neutral"
        :variant="row.canRepair ? 'ghost' : 'soft'"
        :aria-label="t('sources.row.setDefaultNamed', { source: row.name })"
        :data-testid="`source-set-default-${row.id}`"
        @click="emit('setDefault', row.id)"
      >
        {{ t('sources.row.setDefault') }}
      </UButton>
      <UButton
        v-if="row.canRepair"
        color="neutral"
        variant="soft"
        :aria-label="t('sources.row.repairNamed', { source: row.name })"
        :data-testid="`source-repair-${row.id}`"
        @click="emit('repair', row.id)"
      >
        {{ t('sources.row.repair') }}
      </UButton>
      <UButton
        v-if="row.canConfigure"
        color="neutral"
        variant="ghost"
        :data-testid="`source-settings-${row.id}`"
        @click="emit('openSettings', row.id)"
      >
        {{ t('sources.row.settings', { source: row.name }) }}
      </UButton>
      <UButton
        v-if="row.canConfigure"
        color="neutral"
        variant="ghost"
        :aria-label="t('sources.row.disconnectNamed', { source: row.name })"
        :data-testid="`source-disconnect-${row.id}`"
        @click="emit('disconnect', row.id)"
      >
        {{ t('sources.row.disconnect') }}
      </UButton>
    </div>
  </ListRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ListRow from '~/components/ui/ListRow.vue'
import { useI18n } from 'vue-i18n'
import type { ConnectedSourceRow } from '~/composables/useSourceList'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'SourceRow' })

interface Props {
  row: ConnectedSourceRow
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'setDefault' | 'repair' | 'openSettings' | 'disconnect', id: SourceId): void
}>()

const { t } = useI18n()

/** Only a warning is announced: the live region changes on a real status change, not when "vor 3 Min." counts up */
const announcement = computed(() => (props.row.statusTone === 'warning' ? props.row.statusText : ''))

const hasActions = computed(() => props.row.canSetDefault || props.row.canRepair || props.row.canConfigure)
</script>
