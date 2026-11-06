<!--
@component TokenStep
@description Step for entering and validating a Notion API token
@usage Used in the Notion setup wizard as the initial step
@responsibility
- Collects and validates Notion integration token
- Provides feedback on token validity
- Manages token input state and validation process
- Offers links to Notion integration setup
-->
<template>
  <div>
    <h2 class="mb-4 text-2xl">{{ t('notion.token.heading') }}</h2>
    <div v-if="infoMessage" class="mb-4">
      <UAlert
        color="warning"
        variant="soft"
        icon="i-ph-warning"
        :title="t('notion.token.hintTitle')"
        :description="infoMessage"
      />
    </div>
    <form @submit.prevent="validateAndProceed">
      <UFormField
        :label="t('notion.token.fieldLabel')"
        :state="inputState"
        :message="inputMessage"
      >
        <UInput
          id="notionToken"
          v-model="token"
          class="w-full"
          type="password"
          :placeholder="t('notion.token.placeholder')"
          :loading="isValidating"
          :state="inputState"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          @paste="handlePaste"
        />
        <template #help>
          <i18n-t keypath="notion.token.help" tag="span">
            <template #link>
              <ExternalLink href="https://www.notion.so/my-integrations">{{ t('notion.token.helpLink') }}</ExternalLink>
            </template>
          </i18n-t>
        </template>
      </UFormField>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import ExternalLink from "~/components/ui/ExternalLink.vue";
import { useI18n } from "vue-i18n";
import { LocalizedError, getDisplayMessage } from "~/lib/errorMessages";
import { translate } from "~/lib/i18n";

/** Mirrors NOTION_STUB_API_KEY from server/utils/notionStub.ts — allowed in dev/preview */
const NOTION_STUB_TOKEN = 'notion_test_stub';
/** The sentinel or a session-scoped variant (`notion_test_stub:<session>`, used by E2E seeds) */
const isStubTokenValue = (value: string) =>
  __NOTION_STUB_ALLOWED__ && (value === NOTION_STUB_TOKEN || value.startsWith(`${NOTION_STUB_TOKEN}:`));

defineOptions({ name: 'NotionTokenStep' });

/**
 * Props
 * @prop {string} modelValue Current token value (v-model)
 * @prop {string=} infoMessage Optional info banner to display when integration is broken
 */
const props = defineProps<{
  /** Current token value (v-model) */
  modelValue: string;
  /** Optional info banner to display when integration is broken */
  infoMessage?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "next"): void;
}>();

const { t } = useI18n();

const token = ref(props.modelValue);
const isValidating = ref(false);
const inputState = ref<"default" | "valid" | "error">("default");
const inputMessage = ref("");
const lastChangeWasPaste = ref(false);

watch(
  () => props.modelValue,
  (newValue) => {
    token.value = newValue;
  },
);

watch(token, (newValue) => {
  emit("update:modelValue", newValue);
  // Only auto-validate if the change was from a paste event
  const isValidFormat = newValue.startsWith("ntn_") || isStubTokenValue(newValue);
  if (lastChangeWasPaste.value && isValidFormat) {
    validateAndProceed();
  } else if (!lastChangeWasPaste.value) {
    // Only reset states when typing, not during validation
    inputState.value = "default";
    inputMessage.value = "";
  }
  lastChangeWasPaste.value = false;
});

/**
 * Handles paste events to trigger automatic validation
 */
const handlePaste = () => {
  lastChangeWasPaste.value = true;
};

/**
 * Validates the token against the Notion API and proceeds if valid
 */
const validateAndProceed = async () => {
  if (!token.value || isValidating.value) return;

  isValidating.value = true;
  inputState.value = "default";
  inputMessage.value = "";

  try {
    // Basic format validation — also accept the stub sentinel in dev/preview
    const isStubToken = isStubTokenValue(token.value);
    if (!token.value.startsWith("ntn_") && !isStubToken) {
      throw new LocalizedError("errors.invalidTokenFormat");
    }
    // Simulate a quick API check (we'll do a real check in the next step)
    await new Promise((resolve) => setTimeout(resolve, 800));

    inputState.value = "valid";
    inputMessage.value = t('notion.token.validated');

    // Brief pause to show success state
    await new Promise((resolve) => setTimeout(resolve, 400));

    emit("next");
  } catch (error) {
    inputState.value = "error";
    inputMessage.value = getDisplayMessage(error, translate("errors.invalidToken"));
  } finally {
    isValidating.value = false;
  }
};

defineExpose({
  validateAndProceed,
  isValidating,
  token,
});
</script>
