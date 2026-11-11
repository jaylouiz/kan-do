<!--
@component TaskSheetHost
@kind block
@category overlay
@description The one host of the task sheet: opens it while a nested route of the page is active and wires its close flow (kd#179)
@usage Mount once in a page that has task child routes (`pages/tasks.vue` with `/tasks/:id` and `/tasks/add`, `pages/statistics.vue` with `/statistics/:id`) and put the page's `<NuxtPage />` in the default slot.
@avoid Not a dialog host; other overlays use ResponsiveOverlay or AppDialog directly. The sheet itself is TaskSheet.
@responsibility
- Open while a nested route is active and the sheet is not dismissed; every close goes through `useTaskSheet` (the sheet animates out first, then the route returns to the host page)
- Dim the page behind the sheet when the host is not the board (the board dims itself, `sheet.css`)
- Title: the add route's title (visible), else the task's title (screen-reader only on the detail route, where the body holds the editable title)
- Render the footer actions a route registered through `useModalFooter` (the add form's secondary, tertiary and primary buttons and its `lead` line)
- Re-arm the sheet when the route changes (`resetTaskSheet`)
-->

<template>
  <TaskSheet
    :open="isSheetOpen"
    :title="modalTitle"
    :hide-title="route.name !== 'tasks-add'"
    :flush-body="route.name !== 'tasks-add'"
    :dims-page="!isBoardPage"
    @update:open="handleSheetOpenChange"
    @after-leave="handleSheetAfterLeave"
  >
    <slot />

    <template v-if="hasFooterActions" #footer>
      <div class="flex w-full flex-col gap-3">
        <!-- Quiet line above the button row, registered by the route (the add form's "Speichern in", #321) -->
        <component :is="modalFooter.footerConfig.value.lead" v-if="modalFooter.footerConfig.value.lead" />
        <div class="flex w-full items-center justify-between">
          <!-- Secondary actions (left-aligned, e.g., cancel) -->
          <div class="flex items-center gap-2">
            <UButton
              v-for="action in modalFooter.footerConfig.value.secondary"
              :key="action.key"
              :color="action.color ?? 'neutral'"
              :variant="action.variant ?? 'soft'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
          </div>
          <!-- Tertiary + Primary actions (right-aligned) -->
          <div class="flex items-center gap-2">
            <UButton
              v-for="action in modalFooter.footerConfig.value.tertiary"
              :key="action.key"
              :color="action.color ?? 'error'"
              :variant="action.variant ?? 'soft'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
            <UButton
              v-for="action in modalFooter.footerConfig.value.primary"
              :key="action.key"
              size="lg"
              :color="action.color ?? 'primary'"
              :variant="action.variant ?? 'solid'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </TaskSheet>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'nuxt/app';
import { useTasksStore } from '~/store/tasks';
import { useModalFooter } from '~/composables/useModalFooter';
import { useTaskSheet } from '~/composables/useTaskSheet';
import TaskSheet from '~/components/task/TaskSheet.vue';

defineOptions({ name: 'TaskSheetHost' });

const { t } = useI18n();
const route = useRoute();
const tasksStore = useTasksStore();
const modalFooter = useModalFooter();
const taskSheet = useTaskSheet();

/** A nested route of the hosting page (`/tasks/:id`, `/tasks/add`, `/statistics/:id`) is active. */
const isNestedRoute = computed(() => route.matched.length > 1);

/** The board dims itself under the sheet (sheet.css); any other host page is dimmed by the sheet's overlay. */
const isBoardPage = computed(() => route.path === '/tasks' || route.path.startsWith('/tasks/'));

/** The task of the detail route (null on the add route and on a page without a nested route). */
const task = computed(() => (isNestedRoute.value ? tasksStore.task(route.params.id as string) : null));

const modalTitle = computed(() => {
  if (route.name === 'tasks-add') {
    return route.query.mode === 'adhoc' ? t('task.createAdHoc') : t('task.createNew');
  }
  return task.value?.title || t('task.fallbackTitle');
});

const hasFooterActions = computed(() => {
  const config = modalFooter.footerConfig.value;
  return config.secondary.length > 0 || config.tertiary.length > 0 || config.primary.length > 0;
});

/**
 * The sheet stays mounted; it is open while a nested route is active.
 * Every close (Escape, overlay, swipe, in-sheet actions) goes through
 * useTaskSheet: the sheet animates out first, then the route returns to the host page.
 */
const isSheetOpen = computed(() => isNestedRoute.value && !taskSheet.isDismissed.value);

const handleSheetOpenChange = (open: boolean) => {
  if (!open) void taskSheet.closeTaskSheet();
};

const handleSheetAfterLeave = () => void taskSheet.finishClose();

watch(() => route.fullPath, () => taskSheet.resetTaskSheet());
</script>
