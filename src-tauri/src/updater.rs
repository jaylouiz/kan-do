//! Self-updater for the public `jaylouiz/kan-do` releases (#225, ADR 009).
//!
//! `update_check` resolves the id of the `latest.json` release asset through the pinned GitHub
//! client, then lets `tauri-plugin-updater` fetch the manifest from the asset's API URL, compare
//! versions and verify the minisign signature. `Accept: application/octet-stream` (and
//! `Authorization` when a token is stored) are set once on the updater builder, so manifest and bundle
//! download use the same headers (reqwest drops `Authorization` on the cross-host redirect to the
//! signed storage URL).
//!
//! The token is optional: the repository is public, so without one the check runs unauthenticated
//! (GitHub allows 60 such API requests per hour and IP; a limit answers `rate-limited`, "try later").
//! A stored token (Keychain entry `github-updates`, e.g. the maintainer's) is still sent and only
//! raises that limit. It is read here and never leaves this module: it is not logged, not part of any
//! result or error, and JS has no `updater:*` permission. Every log line carries status names,
//! versions and error kinds only.
//!
//! The pure parts (asset selection, status mapping, the data guard, the install order) are unit
//! tested; the glue that needs a running app is thin. Manifest URL and headers live in
//! [`engine_headers`] and [`manifest_url`], so the documented fallback (a manifest on a branch) stays
//! a local change.

use std::future::Future;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::http::{HeaderMap, HeaderValue, header};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::data_file::backup::BackupKind;
use crate::data_file::{DataError, DataFile, Status as DataStatus};
use crate::github::{self, API_BASE, REPO};
use crate::secrets::{SecretEntry, SecretError, Secrets};

/// The public key shipped until the user pastes theirs (`docs/release.md`); the updater is off while it is set.
pub const PLACEHOLDER_PUBKEY: &str = "REPLACE_WITH_UPDATER_PUBLIC_KEY";
/// Name of the manifest among the release assets.
const MANIFEST_ASSET: &str = "latest.json";
/// Cap for the manifest request (the download itself has no total timeout, only progress events).
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Progress event for the download: `{ downloaded, total? }`.
pub const PROGRESS_EVENT: &str = "update://progress";

// ---------------------------------------------------------------------------------------------
// Results

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    UpToDate,
    Available,
    /// A stored token was refused (401, or a 403 that is not a rate limit). Never without a token.
    Rejected,
    Offline,
    /// GitHub answers 404 for "no release yet" (and for a token without access to the repository).
    NoReleaseOrAccess,
    /// 429, a 403 with `x-ratelimit-remaining: 0`, or any 403 to an unauthenticated request: try later.
    RateLimited,
    NotConfigured,
    Error,
}

/// Why a check ended in [`CheckStatus::Error`]. Fixed names, never provider text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorReason {
    /// The latest release has no `latest.json` asset.
    ManifestMissing,
    /// The manifest could not be fetched or parsed.
    ManifestInvalid,
    /// The manifest has no entry for this platform.
    NoPlatform,
    Keychain,
    /// GitHub answered with something unexpected (5xx, malformed body).
    Api,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub status: CheckStatus,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    /// RFC 3339 timestamp of the manifest's `pub_date`.
    pub published_at: Option<String>,
    pub reason: Option<ErrorReason>,
}

impl CheckResult {
    fn plain(status: CheckStatus, current_version: &str) -> Self {
        CheckResult {
            status,
            current_version: current_version.to_owned(),
            version: None,
            notes: None,
            published_at: None,
            reason: None,
        }
    }

    fn failed(reason: ErrorReason, current_version: &str) -> Self {
        CheckResult { reason: Some(reason), ..CheckResult::plain(CheckStatus::Error, current_version) }
    }
}

/// What `update_state` reports: the last check plus whether an install is running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSnapshot {
    pub last: Option<CheckResult>,
    pub last_checked_at: Option<String>,
    pub installing: bool,
}

/// Why `update_install` stopped. The app is untouched and not restarted in every case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallError {
    /// No update was found by a check in this session.
    NoUpdate,
    /// Another check or install is running.
    Busy,
    /// The data file is in a state where updating would put data at risk.
    DataBlocked { reason: BlockReason },
    FlushFailed,
    /// The mandatory `pre-update` backup could not be taken (#224); nothing was installed.
    BackupFailed,
    /// Download, signature check or swap failed. The installed app is unchanged.
    InstallFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlockReason {
    /// The data folder or file is not reachable (`missing-file`, `write-failed`, `folder-unavailable`).
    FolderUnavailable,
    /// The data file exists but cannot be read (`read-only-corrupt`).
    Unreadable,
    /// The data file was changed elsewhere and waits for a decision (`conflict`, #224).
    Conflict,
}

/// `read-only-newer-schema` does not block: updating is the cure.
pub fn data_guard(status: DataStatus) -> Result<(), InstallError> {
    match status {
        DataStatus::Ok | DataStatus::ReadOnlyNewerSchema => Ok(()),
        DataStatus::MissingFile | DataStatus::WriteFailed | DataStatus::FolderUnavailable => {
            Err(InstallError::DataBlocked { reason: BlockReason::FolderUnavailable })
        }
        DataStatus::ReadOnlyCorrupt => Err(InstallError::DataBlocked { reason: BlockReason::Unreadable }),
        DataStatus::Conflict => Err(InstallError::DataBlocked { reason: BlockReason::Conflict }),
    }
}

// ---------------------------------------------------------------------------------------------
// Manifest lookup

/// The API URL of the `latest.json` asset of a `releases/latest` answer, built from the asset id so the
/// request (and a stored token) can only ever go to the pinned host and repository.
pub fn manifest_url(base: &str, release: &Value) -> Result<String, ErrorReason> {
    let assets = release.get("assets").and_then(Value::as_array).ok_or(ErrorReason::Api)?;
    let asset = assets
        .iter()
        .find(|asset| asset.get("name").and_then(Value::as_str) == Some(MANIFEST_ASSET))
        .ok_or(ErrorReason::ManifestMissing)?;
    let id = asset.get("id").and_then(Value::as_u64).ok_or(ErrorReason::Api)?;
    Ok(format!("{base}/repos/{REPO}/releases/assets/{id}"))
}

/// Maps a `releases/latest` answer that is not a 2xx. `None` means "not a token, access or limit problem".
/// `authenticated` says whether a token was sent: without one, a 403 can only be a (secondary) rate
/// limit and a 401 is unexpected, never a rejected token.
pub fn map_status(status: u16, rate_limit_remaining: Option<u64>, authenticated: bool) -> Option<CheckStatus> {
    match status {
        401 if authenticated => Some(CheckStatus::Rejected),
        403 if rate_limit_remaining == Some(0) || !authenticated => Some(CheckStatus::RateLimited),
        403 => Some(CheckStatus::Rejected),
        404 => Some(CheckStatus::NoReleaseOrAccess),
        429 => Some(CheckStatus::RateLimited),
        _ => None,
    }
}

/// The headers for manifest and bundle download: set once, applied to both by the plugin.
/// `Authorization` only when a token is stored.
pub fn engine_headers(token: Option<&str>) -> Option<HeaderMap> {
    let mut headers = HeaderMap::new();
    if let Some(token) = token {
        let mut auth = HeaderValue::from_str(&format!("Bearer {token}")).ok()?;
        auth.set_sensitive(true);
        headers.insert(header::AUTHORIZATION, auth);
    }
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/octet-stream"));
    Some(headers)
}

/// True when the configured public key is still the placeholder (or empty).
pub fn is_placeholder_pubkey(pubkey: &str) -> bool {
    let key = pubkey.trim();
    key.is_empty() || key == PLACEHOLDER_PUBKEY
}

/// What the plugin found, minus the plugin types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    /// Where the plugin will download the bundle from, as announced by the (unsigned) manifest.
    pub download_url: String,
}

/// True only for `<base>/repos/<repo>/releases/assets/<id>`: the one shape the manifest's bundle URL may
/// have. The plugin sends the builder's `Authorization` to whatever URL the manifest names, so this is
/// checked before an `Update` is kept; anything else (another host, `browser_download_url`, a query
/// or a path trick) never gets the token.
pub fn is_pinned_asset_url(base: &str, url: &str) -> bool {
    let prefix = format!("{base}/repos/{REPO}/releases/assets/");
    url.strip_prefix(&prefix)
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
}

/// Failure of the manifest step, classified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineError {
    Offline,
    Reason(ErrorReason),
}

/// The step that talks to the updater plugin. A trait so the flow is testable without an app.
pub trait Engine: Sync {
    type Handle: Send;

    fn check(
        &self,
        manifest_url: &str,
        headers: HeaderMap,
    ) -> impl Future<Output = Result<Option<(Found, Self::Handle)>, EngineError>> + Send;
}

/// The whole check, in order: placeholder key, rejected flag, the optional token, `releases/latest`
/// (authenticated with a token, anonymous without), the plugin. Returns the result and, when an update is available, the handle to install it.
pub async fn run_check<E: Engine>(
    engine: &E,
    secrets: &Secrets,
    base: &str,
    current_version: &str,
    pubkey: &str,
) -> (CheckResult, Option<E::Handle>) {
    let plain = |status| (CheckResult::plain(status, current_version), None);
    if is_placeholder_pubkey(pubkey) {
        return plain(CheckStatus::NotConfigured);
    }
    // After a 401 the flag answers before the Keychain is touched.
    if secrets.is_rejected(SecretEntry::GithubUpdates) {
        return plain(CheckStatus::Rejected);
    }
    let token = match secrets.get(SecretEntry::GithubUpdates) {
        Ok(token) => token,
        Err(_) => return (CheckResult::failed(ErrorReason::Keychain, current_version), None),
    };

    let path = format!("/repos/{REPO}/releases/latest");
    let response = match token.as_deref() {
        // The stored token is passed as a "candidate" so it is read from the Keychain once per check;
        // the rejected flag is handled here.
        Some(token) => {
            github::execute_with(secrets, base, SecretEntry::GithubUpdates, "GET", &path, None, Some(token)).await
        }
        None => github::get_public(base, &path).await,
    };
    let response = match response {
        Ok(response) => response,
        Err(SecretError::Rejected) => {
            secrets.mark_rejected(SecretEntry::GithubUpdates);
            return plain(CheckStatus::Rejected);
        }
        Err(SecretError::Network | SecretError::Timeout) => return plain(CheckStatus::Offline),
        Err(_) => return (CheckResult::failed(ErrorReason::Api, current_version), None),
    };
    if !(200..300).contains(&response.status) {
        return match map_status(response.status, response.rate_limit_remaining, token.is_some()) {
            Some(status) => {
                if status == CheckStatus::Rejected {
                    secrets.mark_rejected(SecretEntry::GithubUpdates);
                }
                plain(status)
            }
            None => (CheckResult::failed(ErrorReason::Api, current_version), None),
        };
    }
    let url = match manifest_url(base, &response.body) {
        Ok(url) => url,
        Err(reason) => return (CheckResult::failed(reason, current_version), None),
    };
    let Some(headers) = engine_headers(token.as_deref()) else {
        return (CheckResult::failed(ErrorReason::Unknown, current_version), None);
    };

    match engine.check(&url, headers).await {
        Ok(None) => plain(CheckStatus::UpToDate),
        Ok(Some((found, _))) if !is_pinned_asset_url(base, &found.download_url) => {
            log::warn!("update refused: the manifest names a bundle outside {REPO}'s release assets");
            (CheckResult::failed(ErrorReason::ManifestInvalid, current_version), None)
        }
        Ok(Some((found, handle))) => (
            CheckResult {
                status: CheckStatus::Available,
                current_version: current_version.to_owned(),
                version: Some(found.version),
                notes: found.notes,
                published_at: found.published_at,
                reason: None,
            },
            Some(handle),
        ),
        Err(EngineError::Offline) => plain(CheckStatus::Offline),
        Err(EngineError::Reason(reason)) => (CheckResult::failed(reason, current_version), None),
    }
}

// ---------------------------------------------------------------------------------------------
// Install

/// The side effects of an install, in the order [`run_install`] calls them.
pub trait InstallSteps: Sync {
    fn data_status(&self) -> DataStatus;
    fn flush(&self) -> Result<(), InstallError>;
    /// The mandatory `pre-update` backup (#224): a failure stops the install.
    fn backup(&self) -> Result<(), InstallError>;
    fn download_and_install(&self) -> impl Future<Output = Result<(), InstallError>> + Send;
    /// Relaunches the app: on macOS it asks the event loop to quit and returns (a helper reopens the
    /// bundle, #276); elsewhere it does not return.
    fn restart(&self);
}

/// (1) data guard, (2) flush, (3) backup, (4) download and install, (5) restart. Stops at the first
/// failing step; the restart happens only after every step succeeded.
pub async fn run_install<S: InstallSteps>(steps: &S) -> Result<(), InstallError> {
    data_guard(steps.data_status())?;
    steps.flush()?;
    steps.backup()?;
    steps.download_and_install().await?;
    steps.restart();
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Tauri glue

#[derive(Default)]
struct Inner {
    last: Option<CheckResult>,
    last_checked_at: Option<String>,
    found: Option<tauri_plugin_updater::Update>,
}

/// Managed state: the last result, the found update and the busy flag.
#[derive(Default)]
pub struct UpdaterState {
    inner: Mutex<Inner>,
    /// A check or an install is running; the other command answers `Busy`.
    busy: AtomicBool,
    /// An install (not a check) is running: what `update_state` reports.
    installing: AtomicBool,
}

impl UpdaterState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Claims the busy flag; false when a check or install already runs.
    fn begin(&self, installing: bool) -> bool {
        if self.busy.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.installing.store(installing, Ordering::SeqCst);
        true
    }

    fn end(&self) {
        self.installing.store(false, Ordering::SeqCst);
        self.busy.store(false, Ordering::SeqCst);
    }

    fn snapshot(&self) -> StateSnapshot {
        let inner = self.lock();
        StateSnapshot {
            last: inner.last.clone(),
            last_checked_at: inner.last_checked_at.clone(),
            installing: self.installing.load(Ordering::SeqCst),
        }
    }
}

fn now_rfc3339() -> Option<String> {
    OffsetDateTime::now_utc().format(&Rfc3339).ok()
}

struct PluginEngine<'a> {
    app: &'a AppHandle,
}

impl Engine for PluginEngine<'_> {
    type Handle = tauri_plugin_updater::Update;

    async fn check(
        &self,
        manifest_url: &str,
        headers: HeaderMap,
    ) -> Result<Option<(Found, Self::Handle)>, EngineError> {
        let url = manifest_url.parse().map_err(|_| EngineError::Reason(ErrorReason::Unknown))?;
        let updater = self
            .app
            .updater_builder()
            .endpoints(vec![url])
            .and_then(|builder| builder.headers(headers).build())
            .map_err(|_| EngineError::Reason(ErrorReason::Unknown))?;
        // Not the builder's own timeout: the plugin would apply it to the whole bundle download too.
        let outcome = tokio::time::timeout(MANIFEST_TIMEOUT, updater.check())
            .await
            .map_err(|_| EngineError::Offline)?;
        match outcome {
            Ok(None) => Ok(None),
            Ok(Some(update)) => {
                let found = Found {
                    version: update.version.clone(),
                    notes: update.body.clone().filter(|body| !body.trim().is_empty()),
                    published_at: update.date.and_then(|date| date.format(&Rfc3339).ok()),
                    download_url: update.download_url.to_string(),
                };
                Ok(Some((found, update)))
            }
            Err(error) => Err(classify_plugin_error(&error)),
        }
    }
}

/// Maps a plugin error to a fixed reason. Only the variant is looked at, never its text.
fn classify_plugin_error(error: &tauri_plugin_updater::Error) -> EngineError {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(source) if source.is_connect() || source.is_timeout() => EngineError::Offline,
        Error::Reqwest(_) | Error::Serialization(_) | Error::ReleaseNotFound => {
            EngineError::Reason(ErrorReason::ManifestInvalid)
        }
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => EngineError::Reason(ErrorReason::NoPlatform),
        _ => EngineError::Reason(ErrorReason::Unknown),
    }
}

fn configured_pubkey(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    secrets: State<'_, Secrets>,
    state: State<'_, UpdaterState>,
) -> Result<CheckResult, InstallError> {
    // A check during an install would replace the found update under it.
    if !state.begin(false) {
        return Err(InstallError::Busy);
    }
    let current = app.package_info().version.to_string();
    log::info!("update check started (current {current})");
    let (result, handle) = run_check(
        &PluginEngine { app: &app },
        &secrets,
        API_BASE,
        &current,
        &configured_pubkey(&app),
    )
    .await;
    log::info!(
        "update check finished: status={:?} version={:?} reason={:?}",
        result.status,
        result.version,
        result.reason
    );
    {
        let mut inner = state.lock();
        inner.last = Some(result.clone());
        inner.last_checked_at = now_rfc3339();
        inner.found = handle;
    }
    state.end();
    Ok(result)
}

#[tauri::command]
pub async fn update_state(state: State<'_, UpdaterState>) -> Result<StateSnapshot, ()> {
    Ok(state.snapshot())
}

#[derive(Debug, Clone, Copy, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Copies the data file into `backups/` as `pre-update` (pending edits are written first). Any failure,
/// including a state that cannot be backed up, stops the install: the update must never run without it.
fn pre_update_backup(data: &DataFile) -> Result<(), InstallError> {
    match data.backup(BackupKind::PreUpdate) {
        Ok(name) => {
            log::info!("pre-update backup taken: {name}");
            Ok(())
        }
        Err(error) => {
            log::error!("pre-update backup failed: {}", describe(&error));
            Err(InstallError::BackupFailed)
        }
    }
}

fn describe(error: &DataError) -> String {
    match error {
        DataError::BackupFailed { message } | DataError::Io { message } | DataError::Unavailable { message } => message.clone(),
        other => format!("{other:?}"),
    }
}

struct AppSteps<'a> {
    app: &'a AppHandle,
    data: &'a DataFile,
    update: tauri_plugin_updater::Update,
}

impl InstallSteps for AppSteps<'_> {
    fn data_status(&self) -> DataStatus {
        self.data.status().status
    }

    fn flush(&self) -> Result<(), InstallError> {
        self.data.flush().map_err(|_| InstallError::FlushFailed)
    }

    fn backup(&self) -> Result<(), InstallError> {
        pre_update_backup(self.data)
    }

    async fn download_and_install(&self) -> Result<(), InstallError> {
        let mut downloaded: u64 = 0;
        let app = self.app.clone();
        self.update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = app.emit(PROGRESS_EVENT, Progress { downloaded, total });
                },
                || log::info!("update downloaded"),
            )
            .await
            .map_err(|error| {
                log::error!("update install failed: {:?}", classify_plugin_error(&error));
                InstallError::InstallFailed
            })
    }

    fn restart(&self) {
        // Edits made while the download ran are written before the process is replaced.
        self.data.flush_on_exit(false);
        log::info!("update installed, restarting");
        // macOS: quit normally and let a helper open the bundle once this process is gone, so there is
        // never a second instance (#276). Elsewhere, or when the helper cannot start, Tauri's restart.
        #[cfg(target_os = "macos")]
        if let Ok(executable) = std::env::current_exe() {
            if crate::relaunch::spawn_helper(&executable) {
                self.app.exit(0);
                return;
            }
        }
        self.app.restart();
    }
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    data: State<'_, DataFile>,
    state: State<'_, UpdaterState>,
) -> Result<(), InstallError> {
    if !state.begin(true) {
        return Err(InstallError::Busy);
    }
    let update = state.lock().found.clone();
    let Some(update) = update else {
        state.end();
        return Err(InstallError::NoUpdate);
    };
    log::info!("update install started (to {})", update.version);
    let steps = AppSteps { app: &app, data: &data, update };
    let outcome = run_install(&steps).await;
    if let Err(error) = &outcome {
        log::warn!("update install stopped: {error:?}");
    }
    state.end();
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::test_support::memory_secrets;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex as StdMutex;

    const TOKEN: &str = "ghp_recognisableSecret1234";
    const PUBKEY: &str = "real-key";

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// Serves one canned response and reports the raw request.
    fn serve_once(response: String) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (base, handle)
    }

    fn http(status_line: &str, extra: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\n{extra}content-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn release_json(with_manifest: bool) -> String {
        let mut assets = vec![
            json!({ "id": 11, "name": "kan-do_0.2.0_aarch64.dmg" }),
            json!({ "id": 12, "name": "kan-do_0.2.0_aarch64.app.tar.gz" }),
        ];
        if with_manifest {
            assets.push(json!({ "id": 99, "name": "latest.json" }));
        }
        json!({ "tag_name": "v0.2.0", "assets": assets }).to_string()
    }

    /// Records its calls; answers what it was told to.
    struct FakeEngine {
        calls: StdMutex<Vec<(String, HeaderMap)>>,
        answer: Result<Option<Found>, EngineError>,
    }

    impl FakeEngine {
        fn answering(answer: Result<Option<Found>, EngineError>) -> Self {
            FakeEngine { calls: StdMutex::new(Vec::new()), answer }
        }
        fn calls(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    impl Engine for FakeEngine {
        type Handle = u8;
        async fn check(
            &self,
            manifest_url: &str,
            headers: HeaderMap,
        ) -> Result<Option<(Found, u8)>, EngineError> {
            self.calls.lock().unwrap().push((manifest_url.to_owned(), headers));
            let bundle = manifest_url.replace("/assets/99", "/assets/12");
            self.answer.clone().map(|found| {
                found.map(|mut found| {
                    if found.download_url.is_empty() {
                        found.download_url = bundle;
                    }
                    (found, 7)
                })
            })
        }
    }

    fn available() -> Found {
        Found {
            version: "0.2.0".into(),
            notes: Some("Notes".into()),
            published_at: Some("2026-10-27T09:00:00Z".into()),
            // Empty: `FakeEngine` fills in the bundle asset on the host it was asked about.
            download_url: String::new(),
        }
    }

    fn run(secrets: &Secrets, base: &str, engine: &FakeEngine) -> (CheckResult, Option<u8>) {
        block_on(run_check(engine, secrets, base, "0.1.0", PUBKEY))
    }

    #[test]
    fn the_manifest_asset_is_picked_by_exact_name_and_addressed_by_id() {
        let release: Value = serde_json::from_str(&release_json(true)).unwrap();
        assert_eq!(
            manifest_url(API_BASE, &release).unwrap(),
            "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/99"
        );
        let decoy = json!({ "assets": [{ "id": 1, "name": "latest.json.sig" }, { "id": 2, "name": "old-latest.json" }] });
        assert_eq!(manifest_url(API_BASE, &decoy), Err(ErrorReason::ManifestMissing));
        let none: Value = serde_json::from_str(&release_json(false)).unwrap();
        assert_eq!(manifest_url(API_BASE, &none), Err(ErrorReason::ManifestMissing));
        assert_eq!(manifest_url(API_BASE, &json!({})), Err(ErrorReason::Api));
        // A `url` field in the answer is never trusted: only the id is used.
        let sneaky = json!({ "assets": [{ "id": 5, "name": "latest.json", "url": "https://evil.example/x" }] });
        assert!(manifest_url(API_BASE, &sneaky).unwrap().starts_with("https://api.github.com/repos/jaylouiz/kan-do/"));
    }

    #[test]
    fn only_api_asset_urls_of_this_repo_are_pinned() {
        let good = "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/12";
        assert!(is_pinned_asset_url(API_BASE, good));
        for bad in [
            "https://evil.example/repos/jaylouiz/kan-do/releases/assets/12",
            "https://api.github.com.evil.example/repos/jaylouiz/kan-do/releases/assets/12",
            "https://api.github.com@evil.example/repos/jaylouiz/kan-do/releases/assets/12",
            "http://api.github.com/repos/jaylouiz/kan-do/releases/assets/12",
            "https://api.github.com/repos/other/kan-do/releases/assets/12",
            "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/12?x=1",
            "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/12/../13",
            "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/",
            "https://api.github.com/repos/jaylouiz/kan-do/releases/assets/abc",
            "https://github.com/jaylouiz/kan-do/releases/download/v0.2.0/kan-do.app.tar.gz",
            "",
        ] {
            assert!(!is_pinned_asset_url(API_BASE, bad), "{bad}");
        }
    }

    #[test]
    fn a_manifest_naming_another_bundle_host_is_refused_before_any_download() {
        for url in [
            "https://evil.example/repos/jaylouiz/kan-do/releases/assets/12",
            "https://github.com/jaylouiz/kan-do/releases/download/v0.2.0/kan-do.app.tar.gz",
        ] {
            let (secrets, _) = memory_secrets();
            secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
            let (base, server) = serve_once(http("200 OK", "", &release_json(true)));
            let engine = FakeEngine::answering(Ok(Some(Found { download_url: url.into(), ..available() })));
            let (result, handle) = run(&secrets, &base, &engine);
            server.join().unwrap();
            assert_eq!((result.status, result.reason), (CheckStatus::Error, Some(ErrorReason::ManifestInvalid)), "{url}");
            assert_eq!(result.version, None);
            assert!(handle.is_none(), "{url}");
        }
    }

    #[test]
    fn the_updater_config_refuses_a_bundle_signed_for_another_version() {
        // A crafted manifest can pair a new version with an older, validly signed bundle; the plugin
        // only catches that when the signature must carry the announced version.
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let config: tauri_plugin_updater::Config =
            serde_json::from_value(conf["plugins"]["updater"].clone()).unwrap();
        assert!(config.require_signed_version);
        assert!(!config.allow_downgrades);
        assert!(!config.dangerous_insecure_transport_protocol);
        assert!(!config.dangerous_accept_invalid_certs);
        assert!(!config.dangerous_accept_invalid_hostnames);
    }

    #[test]
    fn update_state_reports_installing_only_for_an_install_not_a_check() {
        let state = UpdaterState::default();
        assert!(state.begin(false)); // a check
        assert!(!state.snapshot().installing);
        assert!(!state.begin(true), "busy: no second command starts");
        state.end();
        assert!(state.begin(true)); // an install
        assert!(state.snapshot().installing);
        state.end();
        assert!(!state.snapshot().installing);
        assert!(state.begin(false), "free again");
    }

    #[test]
    fn http_statuses_map_to_check_statuses() {
        // With a token.
        assert_eq!(map_status(401, None, true), Some(CheckStatus::Rejected));
        assert_eq!(map_status(403, Some(0), true), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(403, Some(12), true), Some(CheckStatus::Rejected));
        assert_eq!(map_status(403, None, true), Some(CheckStatus::Rejected));
        assert_eq!(map_status(404, None, true), Some(CheckStatus::NoReleaseOrAccess));
        assert_eq!(map_status(429, None, true), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(500, None, true), None);
        // Without one: a 403 is a limit ("try later"), never a rejected token.
        assert_eq!(map_status(401, None, false), None);
        assert_eq!(map_status(403, Some(0), false), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(403, Some(12), false), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(403, None, false), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(404, None, false), Some(CheckStatus::NoReleaseOrAccess));
        assert_eq!(map_status(429, None, false), Some(CheckStatus::RateLimited));
        assert_eq!(map_status(500, None, false), None);
    }

    #[test]
    fn a_placeholder_pubkey_disables_the_updater_without_touching_keychain_or_network() {
        let (secrets, backend) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        *backend.fail.lock().unwrap() = true; // any Keychain read would show up as an `error`
        let engine = FakeEngine::answering(Ok(None));
        for key in [PLACEHOLDER_PUBKEY, "", "  "] {
            let (result, _) = block_on(run_check(&engine, &secrets, "http://127.0.0.1:9", "0.1.0", key));
            assert_eq!(result.status, CheckStatus::NotConfigured, "{key:?}");
        }
        assert_eq!(engine.calls(), 0);
    }

    #[test]
    fn without_a_token_the_check_runs_unauthenticated() {
        let (secrets, _) = memory_secrets();
        let (base, server) = serve_once(http("200 OK", "", &release_json(true)));
        let engine = FakeEngine::answering(Ok(Some(available())));
        let (result, handle) = run(&secrets, &base, &engine);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /repos/jaylouiz/kan-do/releases/latest http/1.1"));
        assert!(!request.contains("authorization:"), "{request}");

        assert_eq!(result.status, CheckStatus::Available);
        assert_eq!(handle, Some(7));
        let calls = engine.calls.lock().unwrap();
        let (url, headers) = &calls[0];
        assert_eq!(url, &format!("{base}/repos/jaylouiz/kan-do/releases/assets/99"));
        assert!(headers.get(header::AUTHORIZATION).is_none());
        assert_eq!(headers.get(header::ACCEPT).unwrap(), "application/octet-stream");
    }

    #[test]
    fn without_a_token_a_limit_is_try_later_and_an_unreachable_host_offline() {
        for limited in [
            http("403 Forbidden", "x-ratelimit-remaining: 0\r\n", "{}"),
            http("403 Forbidden", "", "{\"message\":\"secondary rate limit\"}"),
            http("429 Too Many Requests", "retry-after: 60\r\n", "{}"),
        ] {
            let (secrets, _) = memory_secrets();
            assert_eq!(status_after(limited, &secrets), CheckStatus::RateLimited);
            assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
        }
        let (secrets, _) = memory_secrets();
        assert_eq!(status_after(http("404 Not Found", "", "{}"), &secrets), CheckStatus::NoReleaseOrAccess);
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(&secrets, "http://127.0.0.1:9", &engine);
        assert_eq!(result.status, CheckStatus::Offline);
    }

    #[test]
    fn a_429_with_a_token_is_try_later_and_keeps_the_token() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        assert_eq!(status_after(http("429 Too Many Requests", "", "{}"), &secrets), CheckStatus::RateLimited);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_rejected_flag_fails_fast_without_a_network_call() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        secrets.mark_rejected(SecretEntry::GithubUpdates);
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(&secrets, "http://127.0.0.1:9", &engine);
        assert_eq!(result.status, CheckStatus::Rejected);
        assert_eq!(engine.calls(), 0);
    }

    fn status_after(answer: String, secrets: &Secrets) -> CheckStatus {
        let (base, server) = serve_once(answer);
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(secrets, &base, &engine);
        server.join().unwrap();
        assert_eq!(engine.calls(), 0);
        result.status
    }

    #[test]
    fn a_401_marks_the_token_rejected() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        assert_eq!(status_after(http("401 Unauthorized", "", "{}"), &secrets), CheckStatus::Rejected);
        assert!(secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_rate_limited_403_is_not_a_rejected_token() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let limited = http("403 Forbidden", "x-ratelimit-remaining: 0\r\n", "{}");
        assert_eq!(status_after(limited, &secrets), CheckStatus::RateLimited);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn another_403_marks_the_token_rejected() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let denied = http("403 Forbidden", "x-ratelimit-remaining: 4999\r\n", "{}");
        assert_eq!(status_after(denied, &secrets), CheckStatus::Rejected);
        assert!(secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_404_is_no_release_or_access_and_never_rejects_the_token() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        assert_eq!(status_after(http("404 Not Found", "", "{}"), &secrets), CheckStatus::NoReleaseOrAccess);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_server_error_is_an_api_error() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, server) = serve_once(http("502 Bad Gateway", "", "{}"));
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(&secrets, &base, &engine);
        server.join().unwrap();
        assert_eq!((result.status, result.reason), (CheckStatus::Error, Some(ErrorReason::Api)));
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn an_unreachable_host_is_offline() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(&secrets, "http://127.0.0.1:9", &engine);
        assert_eq!(result.status, CheckStatus::Offline);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_release_without_latest_json_is_a_typed_error() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, server) = serve_once(http("200 OK", "", &release_json(false)));
        let engine = FakeEngine::answering(Ok(None));
        let (result, _) = run(&secrets, &base, &engine);
        server.join().unwrap();
        assert_eq!((result.status, result.reason), (CheckStatus::Error, Some(ErrorReason::ManifestMissing)));
        assert_eq!(engine.calls(), 0);
    }

    #[test]
    fn the_engine_gets_the_asset_url_and_both_headers() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, server) = serve_once(http("200 OK", "", &release_json(true)));
        let engine = FakeEngine::answering(Ok(Some(available())));
        let (result, handle) = run(&secrets, &base, &engine);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /repos/jaylouiz/kan-do/releases/latest http/1.1"));
        assert!(request.contains(&format!("authorization: bearer {}", TOKEN.to_ascii_lowercase())));

        assert_eq!(result.status, CheckStatus::Available);
        assert_eq!(result.version.as_deref(), Some("0.2.0"));
        assert_eq!(result.notes.as_deref(), Some("Notes"));
        assert_eq!(handle, Some(7));
        let calls = engine.calls.lock().unwrap();
        let (url, headers) = &calls[0];
        assert_eq!(url, &format!("{base}/repos/jaylouiz/kan-do/releases/assets/99"));
        assert_eq!(headers.get(header::AUTHORIZATION).unwrap().to_str().unwrap(), format!("Bearer {TOKEN}"));
        assert!(headers.get(header::AUTHORIZATION).unwrap().is_sensitive());
        assert_eq!(headers.get(header::ACCEPT).unwrap(), "application/octet-stream");
    }

    #[test]
    fn engine_answers_become_statuses() {
        let cases = [
            (Ok(None), CheckStatus::UpToDate, None),
            (Err(EngineError::Offline), CheckStatus::Offline, None),
            (
                Err(EngineError::Reason(ErrorReason::ManifestInvalid)),
                CheckStatus::Error,
                Some(ErrorReason::ManifestInvalid),
            ),
        ];
        for (answer, status, reason) in cases {
            let (secrets, _) = memory_secrets();
            secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
            let (base, server) = serve_once(http("200 OK", "", &release_json(true)));
            let engine = FakeEngine::answering(answer);
            let (result, handle) = run(&secrets, &base, &engine);
            server.join().unwrap();
            assert_eq!((result.status, result.reason), (status, reason));
            assert!(handle.is_none());
        }
    }

    #[test]
    fn the_token_appears_in_no_result_error_or_log_text() {
        let answers = [
            http("200 OK", "", &release_json(true)),
            http("200 OK", "", &release_json(false)),
            http("401 Unauthorized", "", "{\"message\":\"Bad credentials\"}"),
            http("403 Forbidden", "x-ratelimit-remaining: 0\r\n", "{}"),
            http("404 Not Found", "", "{}"),
            http("502 Bad Gateway", "", "{}"),
        ];
        let mut texts: Vec<String> = Vec::new();
        for answer in answers {
            let (secrets, _) = memory_secrets();
            secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
            let (base, server) = serve_once(answer);
            let engine = FakeEngine::answering(Ok(Some(available())));
            let (result, handle) = run(&secrets, &base, &engine);
            server.join().unwrap();
            texts.push(format!("{result:?} {handle:?}"));
            texts.push(serde_json::to_string(&result).unwrap());
            texts.push(serde_json::to_string(&StateSnapshot {
                last: Some(result),
                last_checked_at: None,
                installing: false,
            })
            .unwrap());
        }
        for error in [
            InstallError::NoUpdate,
            InstallError::Busy,
            InstallError::DataBlocked { reason: BlockReason::FolderUnavailable },
            InstallError::FlushFailed,
            InstallError::BackupFailed,
            InstallError::InstallFailed,
        ] {
            texts.push(format!("{error:?} {}", serde_json::to_string(&error).unwrap()));
        }
        // The headers hold the token by design, but their Debug output hides it.
        texts.push(format!("{:?}", engine_headers(Some(TOKEN)).unwrap()));
        for text in texts {
            assert!(!text.contains("recognisableSecret"), "{text}");
        }
    }

    // --- install order ---------------------------------------------------------------------

    struct FakeSteps {
        calls: StdMutex<Vec<&'static str>>,
        data: DataStatus,
        fail_at: Option<(&'static str, InstallError)>,
    }

    impl FakeSteps {
        fn new(data: DataStatus, fail_at: Option<(&'static str, InstallError)>) -> Self {
            FakeSteps { calls: StdMutex::new(Vec::new()), data, fail_at }
        }
        fn step(&self, name: &'static str) -> Result<(), InstallError> {
            self.calls.lock().unwrap().push(name);
            match self.fail_at {
                Some((at, error)) if at == name => Err(error),
                _ => Ok(()),
            }
        }
        fn calls(&self) -> Vec<&'static str> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl InstallSteps for FakeSteps {
        fn data_status(&self) -> DataStatus {
            self.calls.lock().unwrap().push("guard");
            self.data
        }
        fn flush(&self) -> Result<(), InstallError> {
            self.step("flush")
        }
        fn backup(&self) -> Result<(), InstallError> {
            self.step("backup")
        }
        async fn download_and_install(&self) -> Result<(), InstallError> {
            self.step("install")
        }
        fn restart(&self) {
            self.calls.lock().unwrap().push("restart");
        }
    }

    #[test]
    fn install_runs_guard_flush_backup_install_restart_in_order() {
        let steps = FakeSteps::new(DataStatus::Ok, None);
        assert_eq!(block_on(run_install(&steps)), Ok(()));
        assert_eq!(steps.calls(), ["guard", "flush", "backup", "install", "restart"]);
    }

    #[test]
    fn install_stops_at_the_first_failing_step_and_never_restarts() {
        let cases = [
            ("flush", InstallError::FlushFailed, vec!["guard", "flush"]),
            ("backup", InstallError::BackupFailed, vec!["guard", "flush", "backup"]),
            ("install", InstallError::InstallFailed, vec!["guard", "flush", "backup", "install"]),
        ];
        for (at, error, expected) in cases {
            let steps = FakeSteps::new(DataStatus::Ok, Some((at, error)));
            assert_eq!(block_on(run_install(&steps)), Err(error), "{at}");
            assert_eq!(steps.calls(), expected, "{at}");
        }
    }

    #[test]
    fn a_blocked_data_state_refuses_before_anything_is_written() {
        let cases = [
            (DataStatus::MissingFile, BlockReason::FolderUnavailable),
            (DataStatus::WriteFailed, BlockReason::FolderUnavailable),
            (DataStatus::ReadOnlyCorrupt, BlockReason::Unreadable),
            (DataStatus::FolderUnavailable, BlockReason::FolderUnavailable),
            (DataStatus::Conflict, BlockReason::Conflict),
        ];
        for (status, reason) in cases {
            let steps = FakeSteps::new(status, None);
            assert_eq!(block_on(run_install(&steps)), Err(InstallError::DataBlocked { reason }), "{status:?}");
            assert_eq!(steps.calls(), ["guard"], "{status:?}");
        }
    }

    /// A real data file in a temp folder, for the pre-update hook.
    fn data_in(folder: &std::path::Path, config: &std::path::Path) -> DataFile {
        let data = DataFile::new(
            config.to_path_buf(),
            folder.to_path_buf(),
            "9.9.9".into(),
            crate::data_file::Timing::default(),
            Box::new(|_| {}),
        );
        assert!(data.load().needs_init);
        data.init(serde_json::Map::from_iter([("tasks-store".to_string(), json!({ "tasks": [1, 2] }))])).unwrap();
        data
    }

    fn pre_update_files(folder: &std::path::Path) -> Vec<String> {
        crate::data_file::backup::backup_names(&crate::data_file::backup::backup_dir(folder))
            .unwrap()
            .into_iter()
            .filter(|name| name.contains("-pre-update-"))
            .collect()
    }

    #[test]
    fn the_pre_update_hook_flushes_edits_and_takes_a_pre_update_backup() {
        let root = tempfile::TempDir::new().unwrap();
        let (folder, config) = (root.path().join("data"), root.path().join("config"));
        std::fs::create_dir_all(&folder).unwrap();
        let data = data_in(&folder, &config);
        data.set_versioned("tasks-store", json!({ "tasks": [1, 2, 3] }), data.load().generation, 1).unwrap();

        assert_eq!(pre_update_backup(&data), Ok(()));
        let taken = pre_update_files(&folder);
        assert_eq!(taken.len(), 1);
        let copy = std::fs::read_to_string(crate::data_file::backup::backup_dir(&folder).join(&taken[0])).unwrap();
        assert!(copy.contains("\"tasks\": [\n        1,\n        2,\n        3"), "the backup holds the edits made just before");
    }

    #[test]
    fn a_failing_pre_update_backup_blocks_the_install() {
        let root = tempfile::TempDir::new().unwrap();
        let (folder, config) = (root.path().join("data"), root.path().join("config"));
        std::fs::create_dir_all(&folder).unwrap();
        let data = data_in(&folder, &config);
        std::fs::write(crate::data_file::backup::backup_dir(&folder), b"in the way").unwrap();
        assert_eq!(pre_update_backup(&data), Err(InstallError::BackupFailed));
    }

    #[test]
    fn a_conflict_or_unavailable_folder_never_reaches_the_backup() {
        let root = tempfile::TempDir::new().unwrap();
        let (folder, config) = (root.path().join("data"), root.path().join("config"));
        std::fs::create_dir_all(&folder).unwrap();
        let data = data_in(&folder, &config);
        std::fs::write(folder.join("kan-do-data.json"), b"{\"schemaVersion\":1,\"writtenBy\":\"other\",\"stores\":{}}").unwrap();
        assert_eq!(data.check_now().status, DataStatus::Conflict);
        assert_eq!(data_guard(DataStatus::Conflict), Err(InstallError::DataBlocked { reason: BlockReason::Conflict }));
        assert_eq!(pre_update_backup(&data), Err(InstallError::BackupFailed));
        assert!(pre_update_files(&folder).is_empty());
    }

    #[test]
    fn a_newer_schema_file_does_not_block_the_update() {
        let steps = FakeSteps::new(DataStatus::ReadOnlyNewerSchema, None);
        assert_eq!(block_on(run_install(&steps)), Ok(()));
    }

    #[test]
    fn plugin_errors_are_classified_by_variant() {
        use tauri_plugin_updater::Error;
        assert_eq!(
            classify_plugin_error(&Error::TargetNotFound("darwin-aarch64".into())),
            EngineError::Reason(ErrorReason::NoPlatform)
        );
        assert_eq!(classify_plugin_error(&Error::ReleaseNotFound), EngineError::Reason(ErrorReason::ManifestInvalid));
        assert_eq!(classify_plugin_error(&Error::EmptyEndpoints), EngineError::Reason(ErrorReason::Unknown));
    }

    #[test]
    fn results_serialize_for_the_frontend() {
        let result = CheckResult {
            status: CheckStatus::NoReleaseOrAccess,
            ..CheckResult::plain(CheckStatus::UpToDate, "0.1.0")
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["status"], "no-release-or-access");
        assert_eq!(value["currentVersion"], "0.1.0");
        assert_eq!(
            serde_json::to_value(InstallError::DataBlocked { reason: BlockReason::FolderUnavailable }).unwrap(),
            json!({ "kind": "data_blocked", "reason": "folder-unavailable" })
        );
    }
}
