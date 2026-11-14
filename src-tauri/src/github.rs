//! `github_request`: the only way the webview talks to GitHub (#223, ADR 007).
//!
//! The GitHub tokens never reach JS. Host and repository are pinned here, so even a compromised
//! webview script cannot aim a stored token at another endpoint. The `Authorization` header is
//! set in Rust, a 401 marks the entry as rejected for the rest of the session, and every error is
//! a fixed-text [`SecretError`].

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tauri_plugin_http::reqwest;

use crate::secrets::{SecretEntry, SecretError, Secrets};

/// The only host the token is ever sent to.
pub const API_BASE: &str = "https://api.github.com";
/// The only repository (`owner/name`) the requests may address.
pub const REPO: &str = "jaylouiz/kan-do";
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Cap for request and response bodies. #227 (screenshots) may raise it.
pub const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
/// The only branch the feedback entry may write to (#247, ADR 014). Orphan branch with the report screenshots.
pub const FEEDBACK_BRANCH: &str = "feedback-assets";
const USER_AGENT: &str = "kan-do-desktop";

#[derive(Debug, Serialize)]
pub struct GithubResponse {
    pub status: u16,
    /// Parsed JSON, or the raw text when GitHub did not answer with JSON, or `null` when empty.
    pub body: Value,
    /// `x-ratelimit-remaining` of the answer. Rust-side only (the updater tells a rate limit from a
    /// refusal with it, #225); never sent to JS.
    #[serde(skip)]
    pub rate_limit_remaining: Option<u64>,
}

/// Accepts `/repos/jaylouiz/kan-do[/...][?query]` only.
///
/// Refused: absolute URLs, other repositories (including look-alike prefixes), dot segments in
/// plain or percent-encoded form, encoded separators, backslashes, fragments, userinfo and
/// whitespace or control characters.
pub fn validate_path(path: &str) -> Result<(), SecretError> {
    let invalid = Err(SecretError::InvalidRequest);
    if path.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\' || c == '#' || c == '@') {
        return invalid;
    }
    let (route, _query) = path.split_once('?').unwrap_or((path, ""));
    let pinned = format!("/repos/{REPO}");
    let rest = match route.strip_prefix(&pinned) {
        Some(rest) => rest,
        None => return invalid,
    };
    if !(rest.is_empty() || rest.starts_with('/')) {
        return invalid;
    }
    let lowered = route.to_ascii_lowercase();
    if lowered.contains("%2f") || lowered.contains("%5c") || lowered.contains("%00") {
        return invalid;
    }
    for segment in route.split('/') {
        let decoded = segment.to_ascii_lowercase().replace("%2e", ".");
        if decoded == ".." || decoded == "." {
            return invalid;
        }
    }
    if route.contains("//") {
        return invalid;
    }
    Ok(())
}

/// Write policy of the feedback entry (#247, ADR 014): its token carries Contents: write so the
/// screenshot can be uploaded, and the app must never be able to use that to touch `main` or any
/// other branch. Reads are not restricted. Every write must be one of:
/// - `POST /issues` (the report itself),
/// - `POST /git/blobs|trees|commits` (unreferenced objects, they move no branch),
/// - `POST /git/refs` with `ref` = `refs/heads/feedback-assets`,
/// - `PATCH /git/refs/heads/feedback-assets`,
/// - `PUT /contents/<path>` with `branch` = `feedback-assets` (an absent branch means the default branch).
///
/// Anything else (merges, other refs or branches, tags, releases, ...) is refused before the token is read.
/// The path is already validated by [`validate_path`].
pub fn validate_feedback_write(method: &reqwest::Method, path: &str, body: Option<&Value>) -> Result<(), SecretError> {
    if method == reqwest::Method::GET {
        return Ok(());
    }
    let refused = Err(SecretError::InvalidRequest);
    let route = path.split_once('?').map_or(path, |(route, _)| route);
    let Some(rest) = route.strip_prefix(&format!("/repos/{REPO}/")) else {
        return refused;
    };
    let field = |name: &str| body.and_then(|value| value.get(name)).and_then(Value::as_str);
    let on_feedback_branch = match rest {
        "issues" => method == reqwest::Method::POST,
        "git/blobs" | "git/trees" | "git/commits" => method == reqwest::Method::POST,
        "git/refs" => method == reqwest::Method::POST && field("ref") == Some(&format!("refs/heads/{FEEDBACK_BRANCH}")),
        _ if rest == format!("git/refs/heads/{FEEDBACK_BRANCH}") => method == reqwest::Method::PATCH,
        _ => {
            method == reqwest::Method::PUT
                && rest.strip_prefix("contents/").is_some_and(|file| !file.is_empty())
                && field("branch") == Some(FEEDBACK_BRANCH)
        }
    };
    if on_feedback_branch { Ok(()) } else { refused }
}

fn parse_method(method: &str) -> Result<reqwest::Method, SecretError> {
    match method {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        _ => Err(SecretError::InvalidRequest),
    }
}

fn map_transport_error(error: &reqwest::Error) -> SecretError {
    if error.is_timeout() {
        SecretError::Timeout
    } else {
        SecretError::Network
    }
}

/// Runs a request against `base` (the pinned [`API_BASE`] in production, a local server in
/// tests) with the stored token of `entry`. All validation happens before the token is read.
/// Production goes through [`execute_with`] directly; this shorthand is for tests.
#[cfg(test)]
pub async fn execute(
    secrets: &Secrets,
    base: &str,
    entry: SecretEntry,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<GithubResponse, SecretError> {
    execute_with(secrets, base, entry, method, path, body, None).await
}

/// Like [`execute`]. With `candidate`, that token is used instead of the stored one, so a new token can
/// be checked before it replaces a working one: the rejected flag is neither consulted nor set, and
/// nothing is written to the Keychain. The candidate goes only where the stored token would.
pub async fn execute_with(
    secrets: &Secrets,
    base: &str,
    entry: SecretEntry,
    method: &str,
    path: &str,
    body: Option<Value>,
    candidate: Option<&str>,
) -> Result<GithubResponse, SecretError> {
    if !entry.is_github() {
        return Err(SecretError::InvalidEntry);
    }
    let method = parse_method(method)?;
    validate_path(path)?;
    if entry == SecretEntry::GithubFeedback {
        validate_feedback_write(&method, path, body.as_ref())?;
    }
    let payload = match body {
        Some(value) => {
            let bytes = serde_json::to_vec(&value).map_err(|_| SecretError::InvalidRequest)?;
            if bytes.len() > MAX_BODY_BYTES {
                return Err(SecretError::TooLarge);
            }
            Some(bytes)
        }
        None => None,
    };
    // `epoch` identifies the stored token this request was made with (none for a candidate), so a late
    // 401 cannot flag a token saved while the request was in flight.
    let (token, epoch) = match candidate {
        Some(token) if token.trim().is_empty() => return Err(SecretError::InvalidRequest),
        Some(token) => (token.to_owned(), None),
        None => {
            // Fail fast after a 401 without touching the Keychain or the network.
            if secrets.is_rejected(entry) {
                return Err(SecretError::Rejected);
            }
            let (value, epoch) = secrets.get_with_epoch(entry)?;
            (value.ok_or(SecretError::NotConfigured)?, Some(epoch))
        }
    };

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        // The token must not follow a redirect anywhere.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| SecretError::Network)?;
    let mut auth = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| SecretError::InvalidRequest)?;
    auth.set_sensitive(true);
    let mut request = client
        .request(method, format!("{base}{path}"))
        .header(reqwest::header::AUTHORIZATION, auth)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(bytes) = payload {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(bytes);
    }

    let response = request.send().await.map_err(|e| map_transport_error(&e))?;
    let status = response.status().as_u16();
    let rate_limit_remaining = response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok());
    if status == 401 {
        if let Some(epoch) = epoch {
            secrets.mark_rejected_if(entry, epoch);
        }
        return Err(SecretError::Rejected);
    }
    read_response(response, status, rate_limit_remaining).await
}

/// Reads a capped body (JSON, raw text, or `null` when empty) into a [`GithubResponse`].
async fn read_response(
    mut response: reqwest::Response,
    status: u16,
    rate_limit_remaining: Option<u64>,
) -> Result<GithubResponse, SecretError> {
    if response.content_length().is_some_and(|len| len > MAX_BODY_BYTES as u64) {
        return Err(SecretError::TooLarge);
    }
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| map_transport_error(&e))? {
        if buffer.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(SecretError::TooLarge);
        }
        buffer.extend_from_slice(&chunk);
    }
    let body = if buffer.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&buffer)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&buffer).into_owned()))
    };
    Ok(GithubResponse { status, body, rate_limit_remaining })
}

/// An unauthenticated `GET` against the pinned repository: the updater's path when no token is stored
/// (the repository is public, so `releases/latest` needs none). Same path pinning, timeout, no-redirect
/// policy and body cap as [`execute_with`]; a 401 is just a status here, there is no token to reject.
pub async fn get_public(base: &str, path: &str) -> Result<GithubResponse, SecretError> {
    validate_path(path)?;
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| SecretError::Network)?;
    let response = client
        .get(format!("{base}{path}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| map_transport_error(&e))?;
    let status = response.status().as_u16();
    let rate_limit_remaining = response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok());
    read_response(response, status, rate_limit_remaining).await
}

#[tauri::command]
pub async fn github_request(
    secrets: State<'_, Secrets>,
    entry: String,
    method: String,
    path: String,
    body: Option<Value>,
    token: Option<String>,
) -> Result<GithubResponse, SecretError> {
    let entry = SecretEntry::parse(&entry)?;
    execute_with(&secrets, API_BASE, entry, &method, &path, body, token.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::test_support::memory_secrets;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const TOKEN: &str = "ghp_secretvalue1234";

    #[test]
    fn accepts_paths_inside_the_pinned_repo() {
        for path in [
            "/repos/jaylouiz/kan-do",
            "/repos/jaylouiz/kan-do/releases?per_page=1",
            "/repos/jaylouiz/kan-do/issues",
            "/repos/jaylouiz/kan-do/contents/docs/a.png",
        ] {
            assert_eq!(validate_path(path), Ok(()), "{path}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for path in [
            "",
            "https://api.github.com/repos/jaylouiz/kan-do/issues",
            "https://evil.example/repos/jaylouiz/kan-do/issues",
            "//evil.example/repos/jaylouiz/kan-do/issues",
            "repos/jaylouiz/kan-do/issues",
            "/user",
            "/repos/other/repo/issues",
            "/repos/jaylouiz/kan-do-evil/issues",
            "/repos/jaylouiz/other/issues",
            "/repos/jaylouiz/kan-do/../other/issues",
            "/repos/jaylouiz/kan-do/%2e%2e/other",
            "/repos/jaylouiz/kan-do/%2E%2E/other",
            "/repos/jaylouiz/kan-do/./issues",
            "/repos/jaylouiz/kan-do/a%2fb",
            "/repos/jaylouiz/kan-do/a%5cb",
            "/repos/jaylouiz/kan-do\\..\\x",
            "/repos/jaylouiz/kan-do//issues",
            "/repos/jaylouiz/kan-do/issues#frag",
            "/repos/jaylouiz/kan-do/issues x",
            "/repos/jaylouiz/kan-do@evil.example/issues",
            "/repos/jaylouiz/kan-do/issues\n",
        ] {
            assert_eq!(validate_path(path), Err(SecretError::InvalidRequest), "{path:?}");
        }
    }

    #[test]
    fn only_four_methods_are_allowed() {
        for method in ["GET", "POST", "PUT", "PATCH"] {
            assert!(parse_method(method).is_ok());
        }
        for method in ["DELETE", "HEAD", "OPTIONS", "get", ""] {
            assert_eq!(parse_method(method), Err(SecretError::InvalidRequest), "{method}");
        }
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// Serves one canned response and reports the raw request it received.
    fn serve_once(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
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

    #[test]
    fn sends_auth_headers_and_returns_status_and_body() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, server) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 9\r\nconnection: close\r\n\r\n[{\"a\":1}]",
        );
        let response = block_on(execute(
            &secrets,
            &base,
            SecretEntry::GithubUpdates,
            "GET",
            "/repos/jaylouiz/kan-do/releases?per_page=1",
            None,
        ))
        .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, serde_json::json!([{"a": 1}]));
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /repos/jaylouiz/kan-do/releases?per_page=1 http/1.1"));
        assert!(request.contains(&format!("authorization: bearer {}", TOKEN.to_ascii_lowercase())));
        assert!(request.contains("accept: application/vnd.github+json"));
        assert!(request.contains("user-agent: kan-do-desktop"));
    }

    #[test]
    fn a_401_marks_the_entry_rejected_and_later_calls_fail_fast() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        let (base, server) = serve_once(
            "HTTP/1.1 401 Unauthorized\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
        );
        let first = block_on(execute(
            &secrets, &base, SecretEntry::GithubFeedback, "GET",
            "/repos/jaylouiz/kan-do/issues?per_page=1", None,
        ));
        assert_eq!(first.unwrap_err(), SecretError::Rejected);
        server.join().unwrap();
        assert!(secrets.is_rejected(SecretEntry::GithubFeedback));
        // Nothing listens on this port any more: a network attempt would be `Network`, not `Rejected`.
        let second = block_on(execute(
            &secrets, &base, SecretEntry::GithubFeedback, "GET",
            "/repos/jaylouiz/kan-do/issues?per_page=1", None,
        ));
        assert_eq!(second.unwrap_err(), SecretError::Rejected);
        // A new token clears the flag.
        secrets.set(SecretEntry::GithubFeedback, "ghp_other5678").unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
    }

    /// Like [`serve_once`], but holds the answer until the test releases it, so a test can act while the
    /// request is in flight. `requested` fires once the request has arrived.
    fn serve_gated(
        response: &'static str,
    ) -> (String, std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (requested_tx, requested_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf).unwrap();
            requested_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            stream.write_all(response.as_bytes()).unwrap();
        });
        (base, requested_rx, release_tx, handle)
    }

    const UNAUTHORIZED: &str = "HTTP/1.1 401 Unauthorized\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}";

    #[test]
    fn a_late_401_for_the_old_token_does_not_flag_a_token_saved_in_between() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, requested, release, server) = serve_gated(UNAUTHORIZED);
        let answer = std::thread::scope(|scope| {
            let call = scope.spawn(|| {
                block_on(execute(
                    &secrets, &base, SecretEntry::GithubUpdates, "GET",
                    "/repos/jaylouiz/kan-do/releases?per_page=1", None,
                ))
            });
            requested.recv().unwrap();
            // The user saves a new token while the request with the old one is still in flight.
            secrets.set(SecretEntry::GithubUpdates, "ghp_replacement5678").unwrap();
            release.send(()).unwrap();
            call.join().unwrap()
        });
        server.join().unwrap();
        assert_eq!(answer.unwrap_err(), SecretError::Rejected);
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_late_401_after_a_delete_does_not_flag_the_entry_either() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, requested, release, server) = serve_gated(UNAUTHORIZED);
        std::thread::scope(|scope| {
            let call = scope.spawn(|| {
                block_on(execute(
                    &secrets, &base, SecretEntry::GithubUpdates, "GET",
                    "/repos/jaylouiz/kan-do/releases?per_page=1", None,
                ))
            });
            requested.recv().unwrap();
            secrets.delete(SecretEntry::GithubUpdates).unwrap();
            release.send(()).unwrap();
            let _ = call.join().unwrap();
        });
        server.join().unwrap();
        assert!(!secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_401_without_an_intervening_set_still_flags() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, requested, release, server) = serve_gated(UNAUTHORIZED);
        std::thread::scope(|scope| {
            let call = scope.spawn(|| {
                block_on(execute(
                    &secrets, &base, SecretEntry::GithubUpdates, "GET",
                    "/repos/jaylouiz/kan-do/releases?per_page=1", None,
                ))
            });
            requested.recv().unwrap();
            release.send(()).unwrap();
            let _ = call.join().unwrap();
        });
        server.join().unwrap();
        assert!(secrets.is_rejected(SecretEntry::GithubUpdates));
    }

    #[test]
    fn a_candidate_token_is_checked_without_touching_the_stored_one() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        let (base, server) = serve_once(
            "HTTP/1.1 401 Unauthorized\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
        );
        let result = block_on(execute_with(
            &secrets, &base, SecretEntry::GithubFeedback, "GET",
            "/repos/jaylouiz/kan-do/issues?per_page=1", None, Some("ghp_candidate9999"),
        ));
        assert_eq!(result.unwrap_err(), SecretError::Rejected);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("authorization: bearer ghp_candidate9999"));
        assert!(!request.contains(&TOKEN.to_ascii_lowercase()));
        // The stored token keeps working: a bad candidate does not flag it.
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
        assert_eq!(secrets.get(SecretEntry::GithubFeedback).unwrap().as_deref(), Some(TOKEN));
    }

    #[test]
    fn a_candidate_ignores_the_rejected_flag_and_an_empty_one_is_refused() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        secrets.mark_rejected(SecretEntry::GithubUpdates);
        let (base, server) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n[]",
        );
        let ok = block_on(execute_with(
            &secrets, &base, SecretEntry::GithubUpdates, "GET",
            "/repos/jaylouiz/kan-do/releases?per_page=1", None, Some("ghp_fresh1234"),
        ))
        .unwrap();
        server.join().unwrap();
        assert_eq!(ok.status, 200);
        let empty = block_on(execute_with(
            &secrets, "http://127.0.0.1:9", SecretEntry::GithubUpdates, "GET",
            "/repos/jaylouiz/kan-do/releases", None, Some("  "),
        ));
        assert_eq!(empty.unwrap_err(), SecretError::InvalidRequest);
    }

    #[test]
    fn non_401_errors_are_returned_as_a_status() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        let (base, server) = serve_once(
            "HTTP/1.1 403 Forbidden\r\ncontent-length: 17\r\nconnection: close\r\n\r\n{\"message\":\"no\"}\n",
        );
        let response = block_on(execute(
            &secrets, &base, SecretEntry::GithubFeedback, "GET",
            "/repos/jaylouiz/kan-do/issues", None,
        ))
        .unwrap();
        server.join().unwrap();
        assert_eq!(response.status, 403);
        assert!(!secrets.is_rejected(SecretEntry::GithubFeedback));
    }

    #[test]
    fn refused_requests_never_reach_the_network_or_the_keychain() {
        let (secrets, backend) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        *backend.fail.lock().unwrap() = true; // a Keychain read would surface as `Keychain`
        let base = "http://127.0.0.1:9";
        let cases: [(SecretEntry, &str, &str); 5] = [
            (SecretEntry::GithubUpdates, "GET", "/repos/other/repo/issues"),
            (SecretEntry::GithubUpdates, "GET", "/repos/jaylouiz/kan-do/../x"),
            (SecretEntry::GithubUpdates, "GET", "https://evil.example/repos/jaylouiz/kan-do"),
            (SecretEntry::GithubUpdates, "DELETE", "/repos/jaylouiz/kan-do/issues"),
            (SecretEntry::NotionToken, "GET", "/repos/jaylouiz/kan-do/issues"),
        ];
        for (entry, method, path) in cases {
            let error = block_on(execute(&secrets, base, entry, method, path, None)).unwrap_err();
            assert!(
                matches!(error, SecretError::InvalidRequest | SecretError::InvalidEntry),
                "{method} {path}: {error:?}"
            );
        }
    }

    fn feedback_write(method: &str, path: &str, body: Value) -> Result<(), SecretError> {
        validate_feedback_write(&parse_method(method).unwrap(), path, Some(&body))
    }

    #[test]
    fn the_feedback_entry_may_write_only_the_report_and_the_feedback_assets_branch() {
        let repo = "/repos/jaylouiz/kan-do";
        let ok: [(&str, String, Value); 8] = [
            ("POST", format!("{repo}/issues"), serde_json::json!({"title": "t"})),
            ("POST", format!("{repo}/git/blobs"), serde_json::json!({"content": ""})),
            ("POST", format!("{repo}/git/trees"), serde_json::json!({})),
            ("POST", format!("{repo}/git/commits"), serde_json::json!({"parents": []})),
            ("POST", format!("{repo}/git/refs"), serde_json::json!({"ref": "refs/heads/feedback-assets", "sha": "abc"})),
            ("PATCH", format!("{repo}/git/refs/heads/feedback-assets"), serde_json::json!({"sha": "abc"})),
            ("PUT", format!("{repo}/contents/feedback/2026/10/a.png"), serde_json::json!({"branch": "feedback-assets", "content": "AA=="})),
            ("GET", format!("{repo}/git/ref/heads/main"), Value::Null),
        ];
        for (method, path, body) in ok {
            assert_eq!(feedback_write(method, &path, body), Ok(()), "{method} {path}");
        }
    }

    #[test]
    fn the_feedback_entry_cannot_write_main_or_any_other_branch() {
        let repo = "/repos/jaylouiz/kan-do";
        let refused: [(&str, String, Value); 16] = [
            // Contents: no branch means the default branch, any other branch is refused
            ("PUT", format!("{repo}/contents/README.md"), serde_json::json!({"content": "AA==", "message": "m"})),
            ("PUT", format!("{repo}/contents/README.md"), serde_json::json!({"branch": "main"})),
            ("PUT", format!("{repo}/contents/README.md"), serde_json::json!({"branch": "feedback-assets-2"})),
            ("PUT", format!("{repo}/contents/README.md"), serde_json::json!({"branch": "Feedback-Assets"})),
            ("PUT", format!("{repo}/contents/"), serde_json::json!({"branch": "feedback-assets"})),
            ("POST", format!("{repo}/contents/a.png"), serde_json::json!({"branch": "feedback-assets"})),
            // Git data: refs only for the feedback branch
            ("POST", format!("{repo}/git/refs"), serde_json::json!({"ref": "refs/heads/main", "sha": "abc"})),
            ("POST", format!("{repo}/git/refs"), serde_json::json!({"ref": "refs/heads/feedback-assets-evil", "sha": "abc"})),
            ("POST", format!("{repo}/git/refs"), serde_json::json!({"sha": "abc"})),
            ("PATCH", format!("{repo}/git/refs/heads/main"), serde_json::json!({"sha": "abc", "force": true})),
            ("PATCH", format!("{repo}/git/refs/heads/feedback-assets/x"), serde_json::json!({"sha": "abc"})),
            ("POST", format!("{repo}/git/tags"), serde_json::json!({})),
            ("PUT", format!("{repo}/git/refs/heads/feedback-assets"), serde_json::json!({"sha": "abc"})),
            // Other write routes that can move a branch
            ("POST", format!("{repo}/merges"), serde_json::json!({"base": "main", "head": "feedback-assets"})),
            ("POST", format!("{repo}/branches/main/rename"), serde_json::json!({"new_name": "x"})),
            ("POST", format!("{repo}/issues/1/comments"), serde_json::json!({"body": "x"})),
        ];
        for (method, path, body) in refused {
            assert_eq!(feedback_write(method, &path, body), Err(SecretError::InvalidRequest), "{method} {path}");
        }
    }

    #[test]
    fn a_refused_feedback_write_never_reads_the_keychain_or_the_network() {
        let (secrets, backend) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        *backend.fail.lock().unwrap() = true; // a Keychain read would surface as `Keychain`
        for (method, path, body) in [
            ("PUT", "/repos/jaylouiz/kan-do/contents/x.md", serde_json::json!({"branch": "main"})),
            ("POST", "/repos/jaylouiz/kan-do/git/refs", serde_json::json!({"ref": "refs/heads/main"})),
            ("PATCH", "/repos/jaylouiz/kan-do/git/refs/heads/main", serde_json::json!({"sha": "a"})),
        ] {
            let error = block_on(execute(&secrets, "http://127.0.0.1:9", SecretEntry::GithubFeedback, method, path, Some(body)))
                .unwrap_err();
            assert_eq!(error, SecretError::InvalidRequest, "{method} {path}");
        }
    }

    #[test]
    fn an_allowed_feedback_write_carries_branch_and_token_to_the_server() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        let (base, server) = serve_once(
            "HTTP/1.1 201 Created\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
        );
        let response = block_on(execute(
            &secrets, &base, SecretEntry::GithubFeedback, "PUT",
            "/repos/jaylouiz/kan-do/contents/feedback/2026/10/a.png",
            Some(serde_json::json!({"branch": "feedback-assets", "content": "AA==", "message": "m"})),
        ))
        .unwrap();
        assert_eq!(response.status, 201);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("put /repos/jaylouiz/kan-do/contents/feedback/2026/10/a.png http/1.1"));
    }

    #[test]
    fn the_cached_token_is_read_from_the_keychain_once_over_several_calls() {
        let (secrets, backend) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let reads_before = backend.reads.load(std::sync::atomic::Ordering::SeqCst);
        for _ in 0..3 {
            let (base, server) = serve_once("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}");
            block_on(execute(&secrets, &base, SecretEntry::GithubUpdates, "GET", "/repos/jaylouiz/kan-do", None)).unwrap();
            server.join().unwrap();
        }
        assert_eq!(backend.reads.load(std::sync::atomic::Ordering::SeqCst), reads_before, "set cached the value: no read at all");
        let (secrets, backend) = memory_secrets();
        backend.values.lock().unwrap().insert(SecretEntry::GithubUpdates, TOKEN.to_string());
        for _ in 0..3 {
            let (base, server) = serve_once("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}");
            block_on(execute(&secrets, &base, SecretEntry::GithubUpdates, "GET", "/repos/jaylouiz/kan-do", None)).unwrap();
            server.join().unwrap();
        }
        assert_eq!(backend.reads.load(std::sync::atomic::Ordering::SeqCst), 1, "three requests, one Keychain read");
    }

    #[test]
    fn the_gh_token_carries_to_the_server_under_the_feedback_pin_and_never_touches_the_keychain() {
        let (secrets, backend, _dir) = crate::secrets::test_support::with_gh("gho_fromgh5678", true);
        // The write pin applies to the gh source like to any feedback token: refused before gh or the network is touched.
        let refused = block_on(execute(
            &secrets, "http://127.0.0.1:9", SecretEntry::GithubFeedback, "PUT",
            "/repos/jaylouiz/kan-do/contents/README.md", Some(serde_json::json!({ "branch": "main", "message": "m", "content": "" })),
        ));
        assert_eq!(refused.unwrap_err(), SecretError::InvalidRequest);
        let (base, server) = serve_once("HTTP/1.1 201 Created\r\ncontent-length: 2\r\n\r\n{}");
        let response = block_on(execute(
            &secrets, &base, SecretEntry::GithubFeedback, "POST", "/repos/jaylouiz/kan-do/issues",
            Some(serde_json::json!({ "title": "t", "body": "b", "labels": ["inbox"] })),
        ))
        .unwrap();
        assert_eq!(response.status, 201);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("authorization: bearer gho_fromgh5678"), "{request}");
        assert_eq!(backend.reads.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(backend.writes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[test]
    fn other_entries_keep_their_behaviour() {
        // The write policy is the feedback entry's: the updates entry is not narrowed by it.
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let (base, server) = serve_once("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}");
        let ok = block_on(execute(&secrets, &base, SecretEntry::GithubUpdates, "POST", "/repos/jaylouiz/kan-do/merges", Some(serde_json::json!({}))));
        server.join().unwrap();
        assert_eq!(ok.unwrap().status, 200);
    }

    #[test]
    fn oversized_request_bodies_are_refused() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::GithubFeedback, TOKEN).unwrap();
        let big = Value::String("x".repeat(MAX_BODY_BYTES + 1));
        let error = block_on(execute(
            &secrets, "http://127.0.0.1:9", SecretEntry::GithubFeedback, "POST",
            "/repos/jaylouiz/kan-do/issues", Some(big),
        ))
        .unwrap_err();
        assert_eq!(error, SecretError::TooLarge);
    }

    #[test]
    fn missing_token_and_unreachable_host_have_their_own_errors() {
        let (secrets, _) = memory_secrets();
        let missing = block_on(execute(
            &secrets, "http://127.0.0.1:9", SecretEntry::GithubUpdates, "GET",
            "/repos/jaylouiz/kan-do/releases", None,
        ));
        assert_eq!(missing.unwrap_err(), SecretError::NotConfigured);
        secrets.set(SecretEntry::GithubUpdates, TOKEN).unwrap();
        let unreachable = block_on(execute(
            &secrets, "http://127.0.0.1:9", SecretEntry::GithubUpdates, "GET",
            "/repos/jaylouiz/kan-do/releases", None,
        ));
        let error = unreachable.unwrap_err();
        assert_eq!(error, SecretError::Network);
        assert!(!format!("{error:?}{error}").contains("secretvalue"));
    }
}
