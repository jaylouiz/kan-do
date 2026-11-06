import { useBoardStore } from "~/store/board";
import { useTasksStore } from "~/store/tasks";
import { useIntegrationManager } from "~/composables/useIntegrationManager";
import { useSecrets } from "~/composables/useSecrets";
import { useErrorHandler } from "~/composables/useErrorHandler";
import { isTauri } from "~/utils/isTauri";

// Web-only: the token exchange needs the Nitro route and a server-held client secret, neither of which
// exists in the static Tauri bundle (ADR 007).
// Delegates the OAuth token exchange to the server to keep credentials out of the browser bundle
async function requestTodoistToken(code: string): Promise<string | null> {
  try {
    const data = await $fetch('/api/todoist/token', {
      method: 'POST',
      body: { code },
    }) as { access_token?: string }
    return data.access_token ?? null
  } catch (error) {
    useErrorHandler().handleError(error as Error, "todoist_setup");
    return null;
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || isTauri()) return;

  const boardStore = useBoardStore();
  const integrationManager = useIntegrationManager();

  const { code } = to.query; // code gets returned by Todoist OAuth redirect
  if (to.path === "/welcome" && code) {
    if (code && typeof code == "string") {
      const todoistApiToken = await requestTodoistToken(code);
      if (todoistApiToken) {
        const secrets = useSecrets();
        // Desktop: the Keychain write comes first; without it the token would not survive a restart.
        if (secrets.available) {
          try {
            await secrets.set("todoist-token", todoistApiToken);
          } catch (error) {
            useErrorHandler().handleError(error as Error, "secrets");
            return;
          }
        }
        boardStore.setTodoistApiToken(todoistApiToken);
        useTasksStore().beginSourceSwitch("todoist");
        await integrationManager.fetchTasks();
        return navigateTo("/tasks", { redirectCode: 301 }); // redirects without parameters because not specified in options argument
      }
    }
  }
});
