//! Keychain-backed secret store (#223, ADR 007).
//!
//! Four fixed entries live under the service `com.julius.kan-do`. The Notion and Todoist tokens
//! can be read back by the webview (their client code needs the string). The two GitHub tokens
//! are write-only for JS: it can set, delete and ask for status, and `github::github_request`
//! performs the calls. Rust code in this process reads them through [`get`].
//!
//! Token values never leave this module except through `secret_get` (Notion/Todoist), the last
//! four characters in a status, and [`get`]. Errors are mapped to fixed messages: the platform
//! error text is never forwarded, because some variants carry the raw secret bytes.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Keychain service name. Equals the bundle identifier and must not change.
pub const SERVICE: &str = "com.julius.kan-do";

/// The only account names the store accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecretEntry {
    NotionToken,
    TodoistToken,
    GithubUpdates,
    GithubFeedback,
}

impl SecretEntry {
    pub const ALL: [SecretEntry; 4] = [
        SecretEntry::NotionToken,
        SecretEntry::TodoistToken,
        SecretEntry::GithubUpdates,
        SecretEntry::GithubFeedback,
    ];

    pub fn account(self) -> &'static str {
        match self {
            SecretEntry::NotionToken => "notion-token",
            SecretEntry::TodoistToken => "todoist-token",
            SecretEntry::GithubUpdates => "github-updates",
            SecretEntry::GithubFeedback => "github-feedback",
        }
    }

    /// Parses an account name; anything outside the allow-list is rejected.
    pub fn parse(name: &str) -> Result<SecretEntry, SecretError> {
        SecretEntry::ALL
            .into_iter()
            .find(|entry| entry.account() == name)
            .ok_or(SecretError::InvalidEntry)
    }

    /// True for the entries JS may read back.
    pub fn is_readable_from_js(self) -> bool {
        matches!(self, SecretEntry::NotionToken | SecretEntry::TodoistToken)
    }

    pub fn is_github(self) -> bool {
        !self.is_readable_from_js()
    }
}

/// Typed error returned to the frontend as `{ kind, message }`. Messages are fixed strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum SecretError {
    /// Account name outside the allow-list, or an entry that does not fit the command.
    InvalidEntry,
    /// Read-back of a write-only entry was requested.
    ReadForbidden,
    /// The value to store was empty.
    EmptyValue,
    /// The Keychain refused or failed (denied, locked, unavailable). Never means "missing".
    Keychain,
    /// This target has no secret store.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// The entry is not set.
    NotConfigured,
    /// GitHub answered 401 earlier in this session; no request was made.
    Rejected,
    /// Method, path or body not allowed by the GitHub pin.
    InvalidRequest,
    /// The request body or response exceeded the size cap.
    TooLarge,
    /// No connection to GitHub.
    Network,
    /// GitHub did not answer within the timeout.
    Timeout,
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            SecretError::InvalidEntry => "unknown secret entry",
            SecretError::ReadForbidden => "this secret cannot be read back",
            SecretError::EmptyValue => "empty secret value",
            SecretError::Keychain => "keychain unavailable",
            SecretError::Unsupported => "secret store unsupported on this platform",
            SecretError::NotConfigured => "secret not set",
            SecretError::Rejected => "token rejected by GitHub",
            SecretError::InvalidRequest => "request not allowed",
            SecretError::TooLarge => "payload too large",
            SecretError::Network => "no connection",
            SecretError::Timeout => "request timed out",
        };
        f.write_str(text)
    }
}

impl std::error::Error for SecretError {}

/// Storage behind [`Secrets`]. A missing entry is `Ok(None)`; `Err` is always a real failure.
pub trait Backend: Send + Sync {
    fn get(&self, entry: SecretEntry) -> Result<Option<String>, SecretError>;
    fn set(&self, entry: SecretEntry, value: &str) -> Result<(), SecretError>;
    /// Deleting a missing entry succeeds.
    fn delete(&self, entry: SecretEntry) -> Result<(), SecretError>;
}

/// Backend for targets without a secret store.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub struct UnsupportedBackend;

impl Backend for UnsupportedBackend {
    fn get(&self, _: SecretEntry) -> Result<Option<String>, SecretError> {
        Err(SecretError::Unsupported)
    }
    fn set(&self, _: SecretEntry, _: &str) -> Result<(), SecretError> {
        Err(SecretError::Unsupported)
    }
    fn delete(&self, _: SecretEntry) -> Result<(), SecretError> {
        Err(SecretError::Unsupported)
    }
}

/// Backend over any `keyring-core` credential store (the macOS Keychain in production, the mock
/// store in tests).
#[cfg(target_os = "macos")]
pub struct KeyringBackend {
    store: std::sync::Arc<keyring_core::api::CredentialStore>,
}

#[cfg(target_os = "macos")]
impl KeyringBackend {
    pub fn new(store: std::sync::Arc<keyring_core::api::CredentialStore>) -> Self {
        Self { store }
    }

    /// The login Keychain via the native macOS store.
    pub fn native() -> Result<Self, SecretError> {
        let store = apple_native_keyring_store::keychain::Store::new()
            .map_err(|_| SecretError::Keychain)?;
        Ok(Self::new(store))
    }

    fn entry(&self, entry: SecretEntry) -> Result<keyring_core::Entry, SecretError> {
        self.store
            .build(SERVICE, entry.account(), None)
            .map_err(|_| SecretError::Keychain)
    }
}

#[cfg(target_os = "macos")]
impl Backend for KeyringBackend {
    fn get(&self, entry: SecretEntry) -> Result<Option<String>, SecretError> {
        match self.entry(entry)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretError::Keychain),
        }
    }

    fn set(&self, entry: SecretEntry, value: &str) -> Result<(), SecretError> {
        self.entry(entry)?
            .set_password(value)
            .map_err(|_| SecretError::Keychain)
    }

    fn delete(&self, entry: SecretEntry) -> Result<(), SecretError> {
        match self.entry(entry)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretError::Keychain),
        }
    }
}

/// What the frontend may know about an entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum EntryStatus {
    Ok {
        present: bool,
        last4: Option<String>,
        rejected: bool,
    },
    /// The Keychain could not be read. Distinct from `present: false`.
    Error { kind: SecretError },
}

/// Cached facts about an entry; never the value itself.
#[derive(Debug, Clone)]
struct Known {
    present: bool,
    last4: Option<String>,
}

#[derive(Default)]
struct Inner {
    known: HashMap<SecretEntry, Known>,
    rejected: HashMap<SecretEntry, bool>,
    /// Bumped by every `set` and `delete`: identifies which stored token a request was made with.
    epoch: HashMap<SecretEntry, u64>,
}

/// Managed state: the backend plus the in-memory status cache and `rejected` flags.
pub struct Secrets {
    backend: Box<dyn Backend>,
    state: Mutex<Inner>,
}

fn last4_of(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

impl Secrets {
    pub fn new(backend: Box<dyn Backend>) -> Self {
        Self {
            backend,
            state: Mutex::new(Inner::default()),
        }
    }

    /// The native store on macOS, the unsupported stub elsewhere.
    pub fn native() -> Self {
        #[cfg(target_os = "macos")]
        let backend: Box<dyn Backend> = match KeyringBackend::native() {
            Ok(backend) => Box::new(backend),
            Err(_) => Box::new(FailingBackend),
        };
        #[cfg(not(target_os = "macos"))]
        let backend: Box<dyn Backend> = Box::new(UnsupportedBackend);
        Self::new(backend)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A poisoned lock only means another command panicked; the maps stay consistent.
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Reads a value for an in-process consumer (any entry). `Ok(None)` means missing.
    pub fn get(&self, entry: SecretEntry) -> Result<Option<String>, SecretError> {
        let value = self.backend.get(entry)?;
        self.remember(entry, value.as_deref());
        Ok(value)
    }

    /// `secret_get` for the webview: only the readable entries.
    pub fn get_for_js(&self, entry: SecretEntry) -> Result<Option<String>, SecretError> {
        if !entry.is_readable_from_js() {
            return Err(SecretError::ReadForbidden);
        }
        self.get(entry)
    }

    /// Stores a value and clears the `rejected` flag of that entry.
    pub fn set(&self, entry: SecretEntry, value: &str) -> Result<(), SecretError> {
        if value.is_empty() {
            return Err(SecretError::EmptyValue);
        }
        self.backend.set(entry, value)?;
        self.remember(entry, Some(value));
        self.replaced(entry);
        Ok(())
    }

    pub fn delete(&self, entry: SecretEntry) -> Result<(), SecretError> {
        self.backend.delete(entry)?;
        self.remember(entry, None);
        self.replaced(entry);
        Ok(())
    }

    /// The stored token changed: clears the `rejected` flag and bumps the epoch.
    fn replaced(&self, entry: SecretEntry) {
        let mut inner = self.lock();
        inner.rejected.remove(&entry);
        *inner.epoch.entry(entry).or_insert(0) += 1;
    }

    /// Like [`Secrets::get`], plus the entry's epoch. The epoch is read first: a `set` that lands
    /// between the two reads only makes the epoch stale, so its token can never be flagged by this request.
    pub fn get_with_epoch(&self, entry: SecretEntry) -> Result<(Option<String>, u64), SecretError> {
        let epoch = self.lock().epoch.get(&entry).copied().unwrap_or(0);
        Ok((self.get(entry)?, epoch))
    }

    /// Records that GitHub answered 401 for this entry.
    pub fn mark_rejected(&self, entry: SecretEntry) {
        self.lock().rejected.insert(entry, true);
    }

    /// Like [`Secrets::mark_rejected`], but only when no `set` or `delete` happened since `epoch` was read.
    pub fn mark_rejected_if(&self, entry: SecretEntry, epoch: u64) {
        let mut inner = self.lock();
        if inner.epoch.get(&entry).copied().unwrap_or(0) == epoch {
            inner.rejected.insert(entry, true);
        }
    }

    pub fn is_rejected(&self, entry: SecretEntry) -> bool {
        self.lock().rejected.get(&entry).copied().unwrap_or(false)
    }

    /// Status of one entry. The Keychain is read once; later calls answer from the cache.
    pub fn status(&self, entry: SecretEntry) -> EntryStatus {
        let cached = self.lock().known.get(&entry).cloned();
        let known = match cached {
            Some(known) => known,
            None => {
                if let Err(kind) = self.get(entry) {
                    return EntryStatus::Error { kind };
                }
                match self.lock().known.get(&entry).cloned() {
                    Some(known) => known,
                    None => return EntryStatus::Error { kind: SecretError::Keychain },
                }
            }
        };
        EntryStatus::Ok {
            present: known.present,
            last4: known.last4,
            rejected: self.is_rejected(entry),
        }
    }

    fn remember(&self, entry: SecretEntry, value: Option<&str>) {
        let known = Known {
            present: value.is_some(),
            last4: value.map(last4_of),
        };
        self.lock().known.insert(entry, known);
    }
}

/// Stand-in when the native store could not even be opened: every call is a Keychain error.
#[cfg(target_os = "macos")]
struct FailingBackend;

#[cfg(target_os = "macos")]
impl Backend for FailingBackend {
    fn get(&self, _: SecretEntry) -> Result<Option<String>, SecretError> {
        Err(SecretError::Keychain)
    }
    fn set(&self, _: SecretEntry, _: &str) -> Result<(), SecretError> {
        Err(SecretError::Keychain)
    }
    fn delete(&self, _: SecretEntry) -> Result<(), SecretError> {
        Err(SecretError::Keychain)
    }
}

/// In-process read for consumers such as the updater (#225).
#[allow(dead_code)]
pub fn get(app: &AppHandle, entry: SecretEntry) -> Result<Option<String>, SecretError> {
    app.state::<Secrets>().get(entry)
}

/// In-process 401 hook for consumers such as the updater (#225).
#[allow(dead_code)]
pub fn mark_rejected(app: &AppHandle, entry: SecretEntry) {
    app.state::<Secrets>().mark_rejected(entry);
}

#[tauri::command]
pub async fn secret_set(
    secrets: State<'_, Secrets>,
    entry: String,
    value: String,
) -> Result<(), SecretError> {
    secrets.set(SecretEntry::parse(&entry)?, &value)
}

#[tauri::command]
pub async fn secret_delete(secrets: State<'_, Secrets>, entry: String) -> Result<(), SecretError> {
    secrets.delete(SecretEntry::parse(&entry)?)
}

/// Status of the named entries (all four when `entries` is omitted). Reading is lazy: callers
/// pass only what they need, which limits Keychain prompts.
#[tauri::command]
pub async fn secret_status(
    secrets: State<'_, Secrets>,
    entries: Option<Vec<String>>,
) -> Result<HashMap<String, EntryStatus>, SecretError> {
    let wanted = match entries {
        Some(names) => names
            .iter()
            .map(|name| SecretEntry::parse(name))
            .collect::<Result<Vec<_>, _>>()?,
        None => SecretEntry::ALL.to_vec(),
    };
    Ok(wanted
        .into_iter()
        .map(|entry| (entry.account().to_string(), secrets.status(entry)))
        .collect())
}

/// Read-back for Notion and Todoist only. `None` means the entry is missing; a Keychain failure
/// is an `Err`.
#[tauri::command]
pub async fn secret_get(
    secrets: State<'_, Secrets>,
    entry: String,
) -> Result<Option<String>, SecretError> {
    secrets.get_for_js(SecretEntry::parse(&entry)?)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// In-memory backend with switchable failure, for tests on every target.
    #[derive(Default)]
    pub struct MemoryBackend {
        pub values: Mutex<HashMap<SecretEntry, String>>,
        pub fail: Mutex<bool>,
    }

    impl Backend for std::sync::Arc<MemoryBackend> {
        fn get(&self, entry: SecretEntry) -> Result<Option<String>, SecretError> {
            if *self.fail.lock().unwrap() {
                return Err(SecretError::Keychain);
            }
            Ok(self.values.lock().unwrap().get(&entry).cloned())
        }
        fn set(&self, entry: SecretEntry, value: &str) -> Result<(), SecretError> {
            if *self.fail.lock().unwrap() {
                return Err(SecretError::Keychain);
            }
            self.values.lock().unwrap().insert(entry, value.to_string());
            Ok(())
        }
        fn delete(&self, entry: SecretEntry) -> Result<(), SecretError> {
            if *self.fail.lock().unwrap() {
                return Err(SecretError::Keychain);
            }
            self.values.lock().unwrap().remove(&entry);
            Ok(())
        }
    }

    pub fn memory_secrets() -> (Secrets, std::sync::Arc<MemoryBackend>) {
        let backend = std::sync::Arc::new(MemoryBackend::default());
        (Secrets::new(Box::new(backend.clone())), backend)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::memory_secrets;
    use super::*;

    const TOKEN: &str = "ghp_secretvalue1234";

    #[test]
    fn only_the_four_accounts_parse() {
        for name in ["notion-token", "todoist-token", "github-updates", "github-feedback"] {
            assert!(SecretEntry::parse(name).is_ok(), "{name}");
        }
        for name in ["", "github", "Notion-Token", "notion-token ", "../notion-token", "other"] {
            assert_eq!(SecretEntry::parse(name), Err(SecretError::InvalidEntry), "{name}");
        }
    }

    #[test]
    fn service_is_the_bundle_identifier() {
        assert_eq!(SERVICE, "com.julius.kan-do");
    }

    #[test]
    fn github_entries_refuse_read_back_for_js() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        assert_eq!(secrets.get_for_js(SecretEntry::GithubUpdates), Err(SecretError::ReadForbidden));
        assert_eq!(secrets.get_for_js(SecretEntry::GithubFeedback), Err(SecretError::ReadForbidden));
        // Rust consumers can still read them.
        assert_eq!(secrets.get(SecretEntry::GithubUpdates), Ok(Some(TOKEN.to_string())));
    }

    #[test]
    fn mark_rejected_if_ignores_a_stale_epoch() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (_, epoch) = secrets.get_with_epoch(SecretEntry::GithubUpdates).unwrap();
        secrets.mark_rejected_if(SecretEntry::GithubUpdates, epoch);
        assert!(secrets.is_rejected(SecretEntry::GithubUpdates));

        secrets.set(SecretEntry::GithubUpdates, "ghp_other5678").unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
        secrets.mark_rejected_if(SecretEntry::GithubUpdates, epoch);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates), "the old epoch must not flag the new token");

        secrets.delete(SecretEntry::GithubUpdates).unwrap();
        secrets.mark_rejected_if(SecretEntry::GithubUpdates, epoch);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn the_public_mark_rejected_still_flags_unconditionally() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        secrets.mark_rejected(SecretEntry::GithubUpdates);
        assert!(secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn notion_and_todoist_read_back() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::NotionToken, "ntn_abc").unwrap();
        assert_eq!(secrets.get_for_js(SecretEntry::NotionToken), Ok(Some("ntn_abc".into())));
        assert_eq!(secrets.get_for_js(SecretEntry::TodoistToken), Ok(None));
    }

    #[test]
    fn missing_and_keychain_error_are_distinct() {
        let (secrets, backend) = memory_secrets();
        assert_eq!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: false, last4: None, rejected: false }
        );
        *backend.fail.lock().unwrap() = true;
        assert_eq!(
            secrets.status(SecretEntry::GithubFeedback),
            EntryStatus::Error { kind: SecretError::Keychain }
        );
        assert_eq!(secrets.get_for_js(SecretEntry::NotionToken), Err(SecretError::Keychain));
    }

    #[test]
    fn status_reports_last4_and_serves_from_cache() {
        let (secrets, backend) = memory_secrets();
        backend.values.lock().unwrap().insert(SecretEntry::GithubUpdates, TOKEN.to_string());
        assert_eq!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: true, last4: Some("1234".into()), rejected: false }
        );
        // After the first read the Keychain is not consulted again.
        *backend.fail.lock().unwrap() = true;
        assert_eq!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: true, last4: Some("1234".into()), rejected: false }
        );
    }

    #[test]
    fn failed_read_is_not_cached_as_missing() {
        let (secrets, backend) = memory_secrets();
        backend.values.lock().unwrap().insert(SecretEntry::GithubUpdates, TOKEN.to_string());
        *backend.fail.lock().unwrap() = true;
        assert!(matches!(secrets.status(SecretEntry::GithubUpdates), EntryStatus::Error { .. }));
        *backend.fail.lock().unwrap() = false;
        assert!(matches!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: true, .. }
        ));
    }

    #[test]
    fn rejected_flag_lifecycle() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
        secrets.mark_rejected(SecretEntry::GithubFeedback);
        assert!(matches!(
            secrets.status(SecretEntry::GithubFeedback),
            EntryStatus::Ok { rejected: true, .. }
        ));
        // The flag is per entry.
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
        // Saving a new token clears it.
        secrets.set(SecretEntry::GithubFeedback, "ghp_newtoken5678").unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
        // So does removing the entry.
        secrets.mark_rejected(SecretEntry::GithubFeedback);
        secrets.delete(SecretEntry::GithubFeedback).unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
    }

    #[test]
    fn set_and_delete_keep_the_cache_current() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        assert!(matches!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: true, last4: Some(ref l), .. } if l == "1234"
        ));
        secrets.delete(SecretEntry::GithubUpdates).unwrap();
        assert_eq!(
            secrets.status(SecretEntry::GithubUpdates),
            EntryStatus::Ok { present: false, last4: None, rejected: false }
        );
    }

    #[test]
    fn deleting_a_missing_entry_succeeds_and_empty_values_are_refused() {
        let (secrets, _) = memory_secrets();
        assert_eq!(secrets.delete(SecretEntry::TodoistToken), Ok(()));
        assert_eq!(secrets.set(SecretEntry::TodoistToken, ""), Err(SecretError::EmptyValue));
    }

    #[test]
    fn short_values_expose_at_most_their_own_length() {
        assert_eq!(last4_of("ab"), "ab");
        assert_eq!(last4_of("abcdef"), "cdef");
        assert_eq!(last4_of("äöüßx"), "öüßx");
    }

    #[test]
    fn serialized_errors_and_statuses_never_contain_the_token() {
        let (secrets, backend) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let mut outputs = vec![
            serde_json::to_string(&secrets.get_for_js(SecretEntry::GithubUpdates).unwrap_err()).unwrap(),
            serde_json::to_string(&secrets.status(SecretEntry::GithubUpdates)).unwrap(),
        ];
        *backend.fail.lock().unwrap() = true;
        outputs.push(serde_json::to_string(&secrets.status(SecretEntry::GithubFeedback)).unwrap());
        for error in [
            SecretError::InvalidEntry, SecretError::ReadForbidden, SecretError::EmptyValue,
            SecretError::Keychain, SecretError::Unsupported, SecretError::NotConfigured,
            SecretError::Rejected, SecretError::InvalidRequest, SecretError::TooLarge,
            SecretError::Network, SecretError::Timeout,
        ] {
            outputs.push(serde_json::to_string(&error).unwrap());
            outputs.push(error.to_string());
        }
        for output in outputs {
            assert!(!output.contains("secretvalue"), "{output}");
        }
    }

    #[test]
    fn unsupported_backend_answers_unsupported() {
        let secrets = Secrets::new(Box::new(UnsupportedBackend));
        assert_eq!(secrets.set(SecretEntry::NotionToken, "x"), Err(SecretError::Unsupported));
        assert_eq!(
            secrets.status(SecretEntry::NotionToken),
            EntryStatus::Error { kind: SecretError::Unsupported }
        );
    }

    #[cfg(target_os = "macos")]
    mod keyring {
        use super::*;
        use keyring_core::api::CredentialStoreApi;
        use keyring_core::mock::{Cred, Store};

        fn backend() -> (KeyringBackend, std::sync::Arc<Store>) {
            let store = Store::new().unwrap();
            (KeyringBackend::new(store.clone()), store)
        }

        #[test]
        fn round_trip_under_the_fixed_service() {
            let (backend, store) = backend();
            backend.set(SecretEntry::NotionToken, "ntn_abc").unwrap();
            assert_eq!(backend.get(SecretEntry::NotionToken), Ok(Some("ntn_abc".into())));
            // The entry exists under the pinned service and account.
            let entry = store.build(SERVICE, "notion-token", None).unwrap();
            assert_eq!(entry.get_password().unwrap(), "ntn_abc");
            backend.delete(SecretEntry::NotionToken).unwrap();
            assert_eq!(backend.get(SecretEntry::NotionToken), Ok(None));
            assert_eq!(backend.delete(SecretEntry::NotionToken), Ok(()));
        }

        #[test]
        fn platform_errors_are_keychain_errors_not_missing() {
            for error in [
                keyring_core::Error::NoStorageAccess("denied".to_string().into()),
                keyring_core::Error::PlatformFailure("boom".to_string().into()),
            ] {
                let (backend, store) = backend();
                backend.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
                let entry = store.build(SERVICE, "github-updates", None).unwrap();
                entry.as_any().downcast_ref::<Cred>().unwrap().set_error(error);
                assert_eq!(backend.get(SecretEntry::GithubUpdates), Err(SecretError::Keychain));
            }
        }

        /// Real login Keychain, a throwaway service so no real entry is touched. Run manually:
        /// `cargo test native_keychain_round_trip -- --ignored`.
        #[test]
        #[ignore = "touches the real macOS login Keychain"]
        fn native_keychain_round_trip() {
            let store = KeyringBackend::native().expect("native store").store;
            let entry = store.build("com.julius.kan-do.test", "round-trip", None).unwrap();
            entry.set_password("ntn_round_trip_1234").unwrap();
            assert_eq!(entry.get_password().unwrap(), "ntn_round_trip_1234");
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(keyring_core::Error::NoEntry)));
        }

        #[test]
        fn bad_encoding_error_does_not_leak_bytes() {
            let (backend, store) = backend();
            let entry = store.build(SERVICE, "github-updates", None).unwrap();
            entry.set_secret(&[0xff, 0xfe, b'z', b'z', b'q']).unwrap();
            let error = backend.get(SecretEntry::GithubUpdates).unwrap_err();
            assert_eq!(error, SecretError::Keychain);
            assert!(!format!("{error:?}{error}").contains("zzq"));
        }
    }
}
