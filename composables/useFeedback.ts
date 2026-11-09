/**
 * @composable useFeedback
 * @description In-app feedback (#227): the draft, the dialog steps and the send. One dialog per app,
 * opened from the command palette (desktop only), mounted once in pages/tasks.vue.
 * @responsibility
 * - The draft lives in module memory only: never browser storage, never a persisted store, so it can
 *   never reach the synced data folder. Closing keeps it for the session; "Entwurf verwerfen" drops it.
 * - Picking dismisses the dialog first (it is never in the way), runs `useElementPicker`, reopens it
 * - Review shows exactly what is sent; every context item can be removed (absent, not blank)
 * - Send goes through `useSecrets().githubRequest('github-feedback', ...)` only: the page never reads
 *   the token and never calls `fetch` for GitHub. Without a token (or after a 401) the primary action
 *   opens a prefilled `issues/new` link through the opener plugin instead.
 * - Errors keep the draft; there is no automatic retry
 * Screenshot (#247, ADR 014), all in module memory, never storage or a persisted store:
 * - "Screenshot hinzufügen" dismisses the dialog like the picker does, `useScreenshotCapture` takes the native
 *   snapshot, the dialog reopens at the `annotate` step. "Fertig" (or "Weiter") flattens the marks into one
 *   PNG (redactions burned in) and drops the raw capture and the strokes; cancel, discard and send do too.
 * - Send order with a token that may write contents: ensure the orphan `feedback-assets` branch, `PUT` the PNG,
 *   then `POST /issues`. `assetPath` is remembered after the PUT, so a retry never uploads twice. A 403/404
 *   from the upload stops before any issue exists, remembers `uploadDenied` for the session and turns the
 *   primary action into "Ohne Bild senden" (clipboard first, then the issue without the image).
 * - Without a token (or after a 401) the prefilled link opens and the PNG goes to the clipboard.
 * Public repository (owner decision 2026-11-06, ADR 010): the browser path is the normal path for everyone but the
 * owner: in-app send needs a token whose user may write to the repo (`checkWriteAccess`), not just any stored token.
 * The token state is read on `open()` so the form can say that sending needs a GitHub account; after the link
 * opens a toast says what to do on GitHub (paste the screenshot, send the issue).
 */
import { ICONS } from '~/lib/icons'
import { computed, hasInjectionContext, reactive, readonly, ref, shallowRef } from 'vue'
import { useNuxtApp, useToast } from '#imports'
import { translate, getActiveLocale } from '~/lib/i18n'
import { buildIssueBody } from '~/lib/feedback/buildIssueBody'
import { buildPrefilledUrl, type PrefilledUrl } from '~/lib/feedback/trimPrefilledUrl'
import {
  DESCRIPTION_MAX, FEEDBACK_ASSETS_BRANCH, FEEDBACK_REPO, TITLE_MAX,
  type ElementInfo, type EnvironmentInfo, type IssueBodyInput, type ScreenshotDelivery, type VersionInfo,
} from '~/lib/feedback/types'
import { classifyUploadStatus } from '~/lib/feedback/uploadAccess'
import { flattenToPng, isMark, readAnnotationColors, type Annotation } from '~/lib/feedback/flattenCanvas'
import { toSecretError, useSecrets } from '~/composables/useSecrets'
import { useTasksStore } from '~/store/tasks'
import { useElementPicker } from '~/composables/useElementPicker'
import { CaptureError, useScreenshotCapture, type CaptureFailureKind } from '~/composables/useScreenshotCapture'
import { useErrorHandler } from '~/composables/useErrorHandler'

export type FeedbackStep = 'form' | 'annotate' | 'review'
/** `present`: a token whose user may write to the repo (owner, collaborator). `readOnly`: a token without that right. */
export type TokenState = 'unknown' | 'present' | 'absent' | 'rejected' | 'readOnly'
/** What went wrong with the last send. The draft is kept in every case. */
export type SendProblem = 'offline' | 'rejected' | 'blocked' | 'server' | 'unexpected' | 'uploadDenied'
/** Which request of a send is running (plain text in the review step). */
export type SendPhase = 'idle' | 'uploading' | 'creating'

const ISSUES_URL_PREFIX = `https://github.com/${FEEDBACK_REPO}/issues/`

// Module-level: one dialog and one draft per app. Never persisted.
const isOpen = ref(false)
const step = ref<FeedbackStep>('form')
const draft = reactive({
  title: '',
  description: '',
  element: null as ElementInfo | null,
  include: { element: true, environment: true, version: true, log: true, taskTitle: false, screenshot: true },
})
const environment = ref<EnvironmentInfo | null>(null)
const versionInfo = ref<VersionInfo | null>(null)
/** Last lines of the app log file (#225); empty until `log_tail` answers or when the file is absent. */
const logTail = ref('')
const tokenState = ref<TokenState>('unknown')
const sending = ref(false)
/** The draft as it was before "Entwurf verwerfen"; offered back until the dialog closes. */
const discarded = ref<{ title: string, description: string, element: ElementInfo | null, include: typeof draft.include } | null>(null)
const problem = ref<SendProblem | null>(null)
/** Set while the dialog is hidden for the element picker. */
const picking = ref(false)
/** The raw native capture, only while it is being annotated. */
const rawShot = shallowRef<ImageBitmap | null>(null)
const annotations = ref<Annotation[]>([])
/** "Aufgabentexte schwärzen": mask private text for the capture. Toggling re-captures. */
const maskPrivate = ref(true)
/** Whether `rawShot` was captured with the mask on. The toggle and the image must never disagree (privacy). */
let rawShotMasked: boolean | null = null
/** "Fertig" is running: flattening reads and then drops the raw capture, so it must not run twice. */
let finishing = false
/** The flattened PNG with its repo path: what the review shows and what is uploaded. */
const flat = shallowRef<{ bitmap: ImageBitmap, blob: Blob, path: string } | null>(null)
/** Set while the dialog is hidden for the screenshot. */
const capturePending = ref(false)
const captureFailure = ref<CaptureFailureKind | null>(null)
const sendPhase = ref<SendPhase>('idle')
/** The upload of this session was refused (403/404): the image goes to the clipboard instead. */
const uploadDenied = ref(false)
/** The clipboard write of the last send or link failed. */
const clipboardFailed = ref(false)
/** Repo path of the PNG once it is on the feedback branch; a retry reuses it. */
let assetPath: string | null = null
/** What identifies the stored token for the session (`uploadDenied` resets when it changes). */
let tokenFingerprint: string | null = null
/** Write access of a token's user per fingerprint, asked once per session (`checkWriteAccess`). */
const writeAccess = new Map<string, Promise<'write' | 'readOnly' | 'rejected'>>()
let returnFocusTo: HTMLElement | null = null
const LOG_TAIL_LINES = 30
/** The app version does not change within a session: asked once, then reused by every snapshot. */
let appVersion: string | null = null
/** Bumped by `resetFeedbackState`; a native answer that arrives after a reset is ignored. */
let snapshotGeneration = 0

/** OS name from the user agent; #225 added no `app_info` command, so there is no version or arch. */
function detectOs(): string | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Mac/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

function snapshotContext() {
  environment.value = {
    route: window.location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    locale: getActiveLocale(),
  }
  versionInfo.value = { version: appVersion, os: detectOs() }
}

/**
 * The real app version (`getVersion`, as the updates page shows it) and the log tail (`log_tail`, secrets
 * dropped in Rust). Both are best effort: the dialog works without them. Asked once per `open()`; the
 * values survive later context snapshots (picker return, review step).
 */
async function loadNativeContext(): Promise<void> {
  const generation = snapshotGeneration
  if (appVersion === null) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
    } catch {
      // Not running in Tauri (dev in a browser): the version stays unknown rather than guessed.
    }
  }
  if (generation === snapshotGeneration && versionInfo.value) versionInfo.value = { ...versionInfo.value, version: appVersion }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const tail = await invoke<string>('log_tail', { lines: LOG_TAIL_LINES })
    if (generation === snapshotGeneration) logTail.value = tail
  } catch {
    logTail.value = ''
  }
}

/** The issue-body input after the user's context choices: what is not included is absent. */
function issueInput(): IssueBodyInput {
  const input: IssueBodyInput = { description: draft.description }
  if (draft.element && draft.include.element) {
    input.element = draft.element
    if (draft.include.taskTitle && taskTitle.value) input.taskTitle = taskTitle.value
  }
  if (environment.value && draft.include.environment) input.environment = environment.value
  if (versionInfo.value && draft.include.version) input.versionInfo = versionInfo.value
  if (draft.include.log && logTail.value.trim()) input.logTail = logTail.value
  if (flat.value && draft.include.screenshot) input.screenshot = { delivery: screenshotDelivery.value, path: flat.value.path }
  return input
}

/** Title of the task behind the picked element; only sent when the user ticks "Titel einfügen". */
const taskTitle = computed(() => (draft.element?.taskId ? useTasksStore().task(draft.element.taskId)?.title ?? '' : ''))
const trimmedTitle = computed(() => draft.title.trim())
const titleValid = computed(() => trimmedTitle.value.length > 0 && trimmedTitle.value.length <= TITLE_MAX)
const hasDraft = computed(() => !!(trimmedTitle.value || draft.description.trim() || draft.element || flat.value || rawShot.value))
const body = computed(() => buildIssueBody(issueInput()))
/** Present token: send through Rust. Anything else: open the prefilled link. */
const canSend = computed(() => tokenState.value === 'present')
/** The image goes into the repo only with a token that may write contents; otherwise the author pastes it. */
const screenshotDelivery = computed<ScreenshotDelivery>(() => (canSend.value && !uploadDenied.value ? 'upload' : 'clipboard'))
const wantsImage = computed(() => !!flat.value && draft.include.screenshot)
/** Token without Contents: write (found out): the primary action sends the report without the image. */
const sendsWithoutImage = computed(() => canSend.value && wantsImage.value && uploadDenied.value)
const prefilled = computed<PrefilledUrl>(() => buildPrefilledUrl(trimmedTitle.value, issueInput()))
/** One line for the form: what gets added automatically. */
const contextSummary = computed(() => {
  const parts = [
    versionInfo.value?.version ? `v${versionInfo.value.version}` : null,
    versionInfo.value?.os ?? null,
    environment.value?.route ?? null,
  ].filter(Boolean)
  return parts.join(' · ')
})

function restoreFocus(): void {
  if (typeof document === 'undefined') return
  const trigger = returnFocusTo
  returnFocusTo = null
  if (trigger?.isConnected && trigger !== document.body) {
    trigger.focus({ preventScroll: true })
    return
  }
  const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
  if (!board) return
  board.setAttribute('tabindex', '-1')
  board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
  board.focus({ preventScroll: true })
}

/** Drops the raw capture and the strokes: after "Fertig", on cancel, discard and send. */
function dropRawShot(): void {
  rawShot.value?.close()
  rawShot.value = null
  rawShotMasked = null
  annotations.value = []
}

/** Drops the flattened image too (discard, send, "Entfernen", a new capture). */
function dropScreenshot(): void {
  dropRawShot()
  flat.value?.bitmap.close()
  flat.value = null
  assetPath = null
  captureFailure.value = null
  clipboardFailed.value = false
}

function resetDraft(): void {
  draft.title = ''
  draft.description = ''
  draft.element = null
  draft.include = { element: true, environment: true, version: true, log: true, taskTitle: false, screenshot: true }
  dropScreenshot()
  step.value = 'form'
  problem.value = null
}

/** Repo path of a new image, fixed when it is flattened so the review shows the exact body. */
function newAssetPath(): string {
  const now = new Date()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `feedback/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.png`
}

/** Standard base64 of binary data, in chunks so large PNGs do not overflow the call stack. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function httpProblem(status: number): SendProblem {
  if (status === 403 || status === 429) return 'blocked'
  if (status >= 500) return 'server'
  return 'unexpected'
}

export function useFeedback() {
  const secrets = useSecrets()
  const picker = useElementPicker()
  const screenshotCapture = useScreenshotCapture()
  const { handleError } = useErrorHandler()

  function open(): void {
    if (typeof window === 'undefined' || isOpen.value) return
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    snapshotContext()
    logTail.value = ''
    void loadNativeContext()
    // The form already says whether sending needs the user's own GitHub account (browser path) or not.
    void refreshTokenState()
    step.value = 'form'
    problem.value = null
    isOpen.value = true
  }

  /** Close keeps the draft for this session. Ignored while a send runs: its outcome must stay visible. */
  function close(): void {
    if (sending.value) return
    discarded.value = null
    // Closing is cancelling the annotation: the raw capture and the strokes never outlive the dialog.
    dropRawShot()
    if (step.value === 'annotate') step.value = 'form'
    isOpen.value = false
  }

  /**
   * Drops the draft at once. While the dialog stays open and nothing new is typed, "Rückgängig" in the
   * footer puts it back (an inline undo: a toast would sit behind the modal's focus trap).
   */
  function discard(): void {
    discarded.value = {
      title: draft.title,
      description: draft.description,
      element: draft.element,
      include: { ...draft.include },
    }
    resetDraft()
  }

  function undoDiscard(): void {
    const snapshot = discarded.value
    if (!snapshot) return
    draft.title = snapshot.title
    draft.description = snapshot.description
    draft.element = snapshot.element
    draft.include = snapshot.include
    discarded.value = null
  }

  /**
   * Takes the capture while the dialog is hidden. The old image stays when it fails, and then the toggle goes
   * back to how that image was taken: it must never read "masked" over an image that still shows private text.
   * Always reopens the dialog: the failure is shown inline, the rest of the report still works.
   */
  async function runCapture(): Promise<void> {
    captureFailure.value = null
    // Switching the mask re-captures the same window: marks (not private data) stay where they were.
    const keptMarks = rawShot.value ? annotations.value : []
    const mask = maskPrivate.value
    try {
      const bitmap = await screenshotCapture.capture({ mask })
      dropScreenshot()
      rawShot.value = bitmap
      rawShotMasked = mask
      annotations.value = keptMarks
      step.value = 'annotate'
    } catch (error) {
      captureFailure.value = error instanceof CaptureError ? error.kind : 'failed'
      if (rawShot.value && rawShotMasked !== null) maskPrivate.value = rawShotMasked
    } finally {
      capturePending.value = false
      snapshotContext()
      isOpen.value = true
    }
  }

  /** Called after the dialog's leave animation: runs a pending capture or pick, else restores focus. */
  async function onDialogLeft(): Promise<void> {
    if (capturePending.value) {
      await runCapture()
      return
    }
    if (!picking.value) {
      restoreFocus()
      return
    }
    const info = await picker.start()
    if (info) {
      draft.element = info
      draft.include.element = true
      draft.include.taskTitle = false
    }
    picking.value = false
    snapshotContext()
    isOpen.value = true
  }

  /** Hides the dialog, lets the user pick, reopens with the result (or unchanged on Esc). */
  function startPick(): void {
    picking.value = true
    isOpen.value = false
  }

  /** "Screenshot hinzufügen" / re-capture: the dialog leaves first, so none of it ends up in the image. */
  function startCapture(): void {
    if (capturePending.value || sending.value) return
    capturePending.value = true
    isOpen.value = false
  }

  /** The toggle "Aufgabentexte schwärzen" re-captures, because the mask is applied to the live page. */
  function setMaskPrivate(value: boolean): void {
    if (capturePending.value || sending.value) return
    maskPrivate.value = value
    if (rawShot.value) startCapture()
  }

  function toAnnotate(): void {
    if (rawShot.value) step.value = 'annotate'
  }

  function addAnnotation(annotation: Annotation): void {
    if (isMark(annotation)) annotations.value = [...annotations.value, annotation]
  }

  function undoAnnotation(): void {
    annotations.value = annotations.value.slice(0, -1)
  }

  function clearAnnotations(): void {
    annotations.value = []
  }

  function removeScreenshot(): void {
    dropScreenshot()
  }

  /** Burns the marks into one PNG, then drops the raw capture and the strokes. False: nothing to flatten or too large. */
  async function flatten(): Promise<boolean> {
    const source = rawShot.value
    if (!source) return !!flat.value
    // Last line of defence: an image that does not match the toggle is never flattened, so never uploaded.
    if (rawShotMasked !== maskPrivate.value) {
      captureFailure.value = 'failed'
      return false
    }
    const result = await flattenToPng(source, annotations.value, readAnnotationColors())
    if (!result) {
      captureFailure.value = 'too_large'
      return false
    }
    const bitmap = await createImageBitmap(result.blob)
    dropScreenshot()
    flat.value = { bitmap, blob: result.blob, path: newAssetPath() }
    return true
  }

  /** "Fertig": flatten, then the review (needs a title; without one the form shows the image). A second click is ignored. */
  async function finishAnnotate(): Promise<void> {
    if (finishing) return
    finishing = true
    try {
      if (!(await flatten())) {
        step.value = 'form'
        return
      }
      if (titleValid.value) await toReview()
      else step.value = 'form'
    } finally {
      finishing = false
    }
  }

  /**
   * Whether the stored token's user may write to the repository (`permissions.push` of `GET /repos/<repo>`): the
   * owner and collaborators send in-app and upload the image; anyone else takes the browser path. Asked once per
   * token and session. Only a clear answer without write access switches to the browser path: a failed check
   * (offline, rate limit, 5xx) keeps the in-app send, whose own errors are shown and retried as before.
   */
  function checkWriteAccess(fingerprint: string): Promise<'write' | 'readOnly' | 'rejected'> {
    const cached = writeAccess.get(fingerprint)
    if (cached) return cached
    const check = gh<{ permissions?: { push?: boolean } }>('GET', '')
      .then((response): 'write' | 'readOnly' => {
        const push = response.body?.permissions?.push
        return response.status === 200 && push === false ? 'readOnly' : 'write'
      })
      .catch((error: unknown): 'write' | 'rejected' => {
        writeAccess.delete(fingerprint)
        return toSecretError(error).kind === 'rejected' ? 'rejected' : 'write'
      })
    writeAccess.set(fingerprint, check)
    return check
  }

  async function refreshTokenState(): Promise<void> {
    try {
      const status = (await secrets.status(['github-feedback']))['github-feedback']
      // A different token may have other rights: the earlier refusal does not carry over.
      const fingerprint = status?.state === 'ok' ? `${status.present}:${status.last4}` : null
      if (fingerprint !== tokenFingerprint) uploadDenied.value = false
      tokenFingerprint = fingerprint
      if (status?.state !== 'ok') tokenState.value = 'absent'
      else if (status.rejected) tokenState.value = 'rejected'
      else if (!status.present) tokenState.value = 'absent'
      else {
        const access = await checkWriteAccess(fingerprint!)
        if (fingerprint === tokenFingerprint) tokenState.value = access === 'write' ? 'present' : access
      }
    }
    catch {
      tokenState.value = 'absent'
    }
  }

  async function toReview(): Promise<void> {
    if (!titleValid.value) return
    // "Weiter" without "Fertig": the marks made so far are flattened as they are.
    if (rawShot.value && !(await flatten())) return
    snapshotContext()
    problem.value = null
    step.value = 'review'
    await refreshTokenState()
  }

  function toForm(): void {
    problem.value = null
    step.value = 'form'
  }

  async function openExternal(url: string): Promise<void> {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  }

  function notifySent(number: number, url: string): void {
    const toast = hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast())
    toast.add({
      title: translate('feedback.sentToast', { number }),
      icon: 'i-ph-chat-teardrop-text',
      color: 'neutral',
      actions: [{
        label: translate('feedback.review.openInBrowser'),
        color: 'neutral',
        variant: 'outline',
        onClick: () => { void openExternal(url).catch(error => handleError(error as Error, 'feedback')) },
      }],
    })
  }

  /**
   * Writes the flattened PNG to the clipboard. Call it first thing in a click handler, with nothing awaited
   * before: the browser only allows the write inside the user gesture. The blob is prepared already.
   */
  function copyImage(): Promise<boolean> {
    const image = flat.value
    if (!image) return Promise.resolve(true)
    try {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]).then(() => true, () => false)
    }
    catch {
      return Promise.resolve(false)
    }
  }

  /** Browser path: the dialog is gone, so the next step (paste the image, send the issue) is said on the board. */
  function notifyOpened(withImage: boolean): void {
    const toast = hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast())
    toast.add({
      title: translate(withImage ? 'feedback.openedToastImage' : 'feedback.openedToast'),
      icon: ICONS.external,
      color: 'neutral',
    })
  }

  function notifyClipboardFailed(): void {
    const toast = hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast())
    toast.add({ title: translate('feedback.screenshot.clipboardFailedToast'), icon: 'i-ph-warning-circle', color: 'warning' })
  }

  const gh = <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, requestBody?: unknown) =>
    secrets.githubRequest<T>('github-feedback', method, `/repos/${FEEDBACK_REPO}${path}`, requestBody)

  /** `denied`: the token may not write contents (404, or a 403 that says so; not a rate limit). `stopped`: another problem is set, the draft stays. */
  type StepResult = 'ok' | 'denied' | 'stopped'

  function judge(status: number, accepted: number[], answer?: unknown): StepResult {
    if (accepted.includes(status)) return 'ok'
    // A rate limit is also a 403: only a refusal that names the missing permission denies uploads.
    if (classifyUploadStatus(status, answer) === 'denied') return 'denied'
    problem.value = httpProblem(status)
    if (problem.value === 'unexpected') handleError(new Error(`feedback: upload step answered ${status}`), 'feedback')
    return 'stopped'
  }

  /** The orphan branch: no parents, one README. Created on the first screenshot, found afterwards. */
  async function ensureAssetsBranch(): Promise<StepResult> {
    const ref = await gh('GET', `/git/ref/heads/${FEEDBACK_ASSETS_BRANCH}`)
    if (ref.status === 200) return 'ok'
    if (ref.status !== 404) return judge(ref.status, [], ref.body)
    const blob = await gh<{ sha?: string }>('POST', '/git/blobs', { content: translate('feedback.screenshot.branchReadme'), encoding: 'utf-8' })
    const blobStep = judge(blob.status, [201], blob.body)
    if (blobStep !== 'ok' || !blob.body?.sha) return blobStep === 'ok' ? judge(500, []) : blobStep
    const tree = await gh<{ sha?: string }>('POST', '/git/trees', { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.body.sha }] })
    const treeStep = judge(tree.status, [201], tree.body)
    if (treeStep !== 'ok' || !tree.body?.sha) return treeStep === 'ok' ? judge(500, []) : treeStep
    const commit = await gh<{ sha?: string }>('POST', '/git/commits', { message: 'chore(feedback): create the screenshot branch', tree: tree.body.sha, parents: [] })
    const commitStep = judge(commit.status, [201], commit.body)
    if (commitStep !== 'ok' || !commit.body?.sha) return commitStep === 'ok' ? judge(500, []) : commitStep
    // 422: another report created the branch in the meantime. Fine.
    const created = await gh('POST', '/git/refs', { ref: `refs/heads/${FEEDBACK_ASSETS_BRANCH}`, sha: commit.body.sha })
    return judge(created.status, [201, 422], created.body)
  }

  /** Branch, then the PNG on it. A new uuid per image: never an overwrite, so no `sha` is sent. */
  async function uploadImage(): Promise<StepResult> {
    const image = flat.value
    if (!image) return 'ok'
    const branch = await ensureAssetsBranch()
    if (branch !== 'ok') return branch
    const put = await gh('PUT', `/contents/${image.path}`, {
      message: `chore(feedback): screenshot ${image.path.split('/').pop()?.replace('.png', '') ?? ''}`,
      content: await toBase64(image.blob),
      branch: FEEDBACK_ASSETS_BRANCH,
    })
    const result = judge(put.status, [200, 201], put.body)
    if (result === 'ok') assetPath = image.path
    return result
  }

  function handleSendError(error: unknown): void {
    const { kind } = toSecretError(error)
    if (kind === 'rejected') {
      tokenState.value = 'rejected'
      problem.value = 'rejected'
    }
    else if (kind === 'not_configured') {
      tokenState.value = 'absent'
    }
    else if (kind === 'network' || kind === 'timeout') {
      problem.value = 'offline'
    }
    else {
      problem.value = 'unexpected'
      handleError(error as Error, 'feedback')
    }
  }

  /**
   * Upload (when there is an image and the token may write), then the issue through Rust. Success clears the
   * draft and closes the dialog. With `uploadDenied` the primary action is "Ohne Bild senden": the image is
   * copied first (user gesture), the issue carries the paste line instead of the image.
   */
  async function send(): Promise<void> {
    if (sending.value || !titleValid.value) return
    if (!canSend.value) return
    const copied = sendsWithoutImage.value ? copyImage() : null
    sending.value = true
    problem.value = null
    clipboardFailed.value = false
    try {
      if (wantsImage.value && !uploadDenied.value && assetPath !== flat.value?.path) {
        sendPhase.value = 'uploading'
        const uploaded = await uploadImage()
        if (uploaded === 'denied') {
          uploadDenied.value = true
          problem.value = 'uploadDenied'
          return
        }
        if (uploaded === 'stopped') return
      }
      sendPhase.value = 'creating'
      const response = await secrets.githubRequest<{ number?: number, html_url?: string }>(
        'github-feedback',
        'POST',
        `/repos/${FEEDBACK_REPO}/issues`,
        { title: trimmedTitle.value, body: body.value, labels: ['inbox'] },
      )
      const copyFailed = copied ? !(await copied) : false
      if (response.status === 201 && typeof response.body?.number === 'number') {
        const number = response.body.number
        const url = response.body.html_url?.startsWith(ISSUES_URL_PREFIX) ? response.body.html_url : `${ISSUES_URL_PREFIX}${number}`
        resetDraft()
        discarded.value = null
        isOpen.value = false
        notifySent(number, url)
        if (copyFailed) notifyClipboardFailed()
        return
      }
      clipboardFailed.value = copyFailed
      problem.value = httpProblem(response.status)
      if (problem.value === 'unexpected') handleError(new Error(`feedback: issue create answered ${response.status}`), 'feedback')
    }
    catch (error) {
      handleSendError(error)
    }
    finally {
      sending.value = false
      sendPhase.value = 'idle'
    }
  }

  /** No-token path: opens the prefilled issue form in the browser; the image is on the clipboard for pasting. */
  async function openInBrowser(): Promise<void> {
    if (sending.value || !titleValid.value) return
    const copied = wantsImage.value ? copyImage() : null
    clipboardFailed.value = false
    try {
      await openExternal(prefilled.value.url)
    }
    catch (error) {
      handleError(error as Error, 'feedback')
      return
    }
    const copyFailed = copied ? !(await copied) : false
    // A link that is known to be too long still opens, but the draft stays so nothing is lost.
    if (prefilled.value.overflow) {
      clipboardFailed.value = copyFailed
      return
    }
    resetDraft()
    discarded.value = null
    isOpen.value = false
    if (copyFailed) notifyClipboardFailed()
    else notifyOpened(!!copied)
  }

  return {
    isOpen: readonly(isOpen),
    step: readonly(step),
    draft,
    picking: readonly(picking),
    sending: readonly(sending),
    problem: readonly(problem),
    tokenState: readonly(tokenState),
    titleValid,
    taskTitle,
    hasDraft,
    canUndoDiscard: computed(() => !!discarded.value && !hasDraft.value),
    body,
    prefilled,
    canSend,
    screenshotDelivery,
    wantsImage,
    sendsWithoutImage,
    contextSummary,
    limits: { title: TITLE_MAX, description: DESCRIPTION_MAX },
    open, close, discard, undoDiscard, startPick, onDialogLeft, toReview, toForm, send, openInBrowser,
    startCapture, setMaskPrivate, toAnnotate, addAnnotation, undoAnnotation, clearAnnotations, removeScreenshot, finishAnnotate,
    // computed, not readonly(): a deep readonly proxy around an ImageBitmap cannot be passed to drawImage
    rawShot: computed(() => rawShot.value),
    flat: computed(() => flat.value),
    annotations: readonly(annotations),
    maskPrivate: readonly(maskPrivate),
    capturePending: readonly(capturePending),
    captureFailure: readonly(captureFailure),
    sendPhase: readonly(sendPhase),
    uploadDenied: readonly(uploadDenied),
    clipboardFailed: readonly(clipboardFailed),
    captureAvailable: screenshotCapture.available,
    environment: readonly(environment),
    versionInfo: readonly(versionInfo),
    logTail: readonly(logTail),
  }
}

/** Test helper: back to a closed dialog with an empty draft. */
export function resetFeedbackState(): void {
  resetDraft()
  isOpen.value = false
  discarded.value = null
  picking.value = false
  sending.value = false
  tokenState.value = 'unknown'
  environment.value = null
  versionInfo.value = null
  appVersion = null
  logTail.value = ''
  snapshotGeneration += 1
  returnFocusTo = null
  capturePending.value = false
  maskPrivate.value = true
  uploadDenied.value = false
  tokenFingerprint = null
  writeAccess.clear()
  sendPhase.value = 'idle'
  finishing = false
}

/** The Settings upload probe said the token may write contents: forget an earlier refusal. */
export function clearUploadDenied(): void {
  uploadDenied.value = false
}
