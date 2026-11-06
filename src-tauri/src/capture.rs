//! `feedback_capture`: a PNG of the app's own web view for the feedback dialog (#247, ADR 014).
//!
//! macOS asks the `WKWebView` itself for a snapshot (`takeSnapshotWithConfiguration:completionHandler:`),
//! so shadows, modals, teleported content and web fonts come out as on screen. The call needs no Screen
//! Recording consent and never looks at other windows. `SCScreenshotManager`, `CGWindowListCreateImage`
//! and `CGRequestScreenCaptureAccess` are deliberately not used anywhere.
//!
//! The bytes go back as a raw binary IPC response (not a JSON number array). Nothing is written to disk
//! and nothing is logged beyond the error kind. Other targets answer [`CaptureError::Unsupported`].

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Runtime};

/// The snapshot must arrive within this time or the capture fails with `Timeout`.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
/// Largest PNG handed to JS. A 2x retina window is about 2400 px wide and stays far below this.
const MAX_PNG_BYTES: usize = 12 * 1024 * 1024;
/// The window the feedback dialog lives in.
const WINDOW_LABEL: &str = "main";

/// Typed error returned to the frontend as `{ kind, message }`. Messages are fixed strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum CaptureError {
    /// This target cannot take a native snapshot.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// No snapshot arrived within [`CAPTURE_TIMEOUT`].
    Timeout,
    /// The PNG is larger than [`MAX_PNG_BYTES`].
    TooLarge,
    /// The window is missing or WebKit returned no image.
    Failed,
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            CaptureError::Unsupported => "screenshots are not supported on this platform",
            CaptureError::Timeout => "screenshot timed out",
            CaptureError::TooLarge => "screenshot too large",
            CaptureError::Failed => "screenshot failed",
        };
        f.write_str(text)
    }
}

impl std::error::Error for CaptureError {}

/// Rejects empty and oversized results. Pure, so it is tested on every target.
fn check_png(bytes: Vec<u8>) -> Result<Vec<u8>, CaptureError> {
    if bytes.is_empty() {
        Err(CaptureError::Failed)
    } else if bytes.len() > MAX_PNG_BYTES {
        Err(CaptureError::TooLarge)
    } else {
        Ok(bytes)
    }
}

/// Waits for the completion handler's answer. A dropped sender (the handler never ran, for instance
/// because the web view went away) is `Failed`, a silent one `Timeout`.
async fn await_snapshot(
    receiver: tokio::sync::oneshot::Receiver<Result<Vec<u8>, CaptureError>>,
    limit: Duration,
) -> Result<Vec<u8>, CaptureError> {
    match tokio::time::timeout(limit, receiver).await {
        Err(_) => Err(CaptureError::Timeout),
        Ok(Err(_)) => Err(CaptureError::Failed),
        Ok(Ok(result)) => check_png(result?),
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::CaptureError;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::ffi::c_void;
    use std::sync::Mutex;
    use tokio::sync::oneshot::Sender;

    pub type Reply = Sender<Result<Vec<u8>, CaptureError>>;

    /// `NSImage` -> PNG bytes through its bitmap representation. No metadata is added.
    fn png_bytes(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
        let properties: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::new();
        // SAFETY: `properties` is an empty dictionary, which is valid for every storage type.
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties) }?;
        Some(png.to_vec())
    }

    /// Starts the snapshot of `webview` and hands the PNG (or the error) to `reply` from the completion
    /// handler. Returns at once: the caller must not block the main thread waiting for the handler.
    ///
    /// # Safety
    ///
    /// `webview` must be the `WKWebView` pointer of a live Tauri webview, and this must run on the
    /// main thread (`with_webview` does that).
    pub unsafe fn start_snapshot(webview: *mut c_void, reply: Reply) {
        // SAFETY: the caller guarantees a live `WKWebView` and the main thread.
        let view: &WKWebView = unsafe { &*webview.cast::<WKWebView>() };
        let Some(main) = MainThreadMarker::new() else {
            let _ = reply.send(Err(CaptureError::Failed));
            return;
        };
        let config = unsafe { WKSnapshotConfiguration::new(main) };
        // The default rect is the null rect, i.e. the whole view; `afterScreenUpdates` is YES by
        // default and is set anyway so a pending repaint (the unmasked dialog) is flushed first.
        unsafe { config.setAfterScreenUpdates(true) };

        let reply = Mutex::new(Some(reply));
        let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let Some(reply) = reply.lock().ok().and_then(|mut slot| slot.take()) else { return };
            // SAFETY: WebKit passes either null or a valid object for each argument.
            let result = match (unsafe { image.as_ref() }, unsafe { error.as_ref() }) {
                (Some(image), _) => png_bytes(image).ok_or(CaptureError::Failed),
                _ => Err(CaptureError::Failed),
            };
            let _ = reply.send(result);
        });
        unsafe { view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler) };
    }
}

/// Takes the snapshot and returns the PNG as raw bytes.
#[tauri::command]
pub async fn feedback_capture<R: Runtime>(app: AppHandle<R>) -> Result<tauri::ipc::Response, CaptureError> {
    capture(&app).await.map(tauri::ipc::Response::new)
}

#[cfg(target_os = "macos")]
async fn capture<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<u8>, CaptureError> {
    use tauri::Manager;

    let window = app.get_webview_window(WINDOW_LABEL).ok_or(CaptureError::Failed)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            // SAFETY: `with_webview` runs this closure on the main thread, and `inner()` is the
            // `WKWebView` of this window for as long as the closure runs.
            unsafe { native::start_snapshot(platform.inner(), sender) };
        })
        .map_err(|_| CaptureError::Failed)?;
    await_snapshot(receiver, CAPTURE_TIMEOUT).await
}

#[cfg(not(target_os = "macos"))]
async fn capture<R: Runtime>(_app: &AppHandle<R>) -> Result<Vec<u8>, CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn empty_and_oversized_results_are_typed_errors() {
        assert_eq!(check_png(Vec::new()), Err(CaptureError::Failed));
        assert_eq!(check_png(vec![0; MAX_PNG_BYTES + 1]), Err(CaptureError::TooLarge));
        assert_eq!(check_png(vec![0; MAX_PNG_BYTES]).map(|b| b.len()), Ok(MAX_PNG_BYTES));
        assert_eq!(check_png(vec![1, 2, 3]), Ok(vec![1, 2, 3]));
    }

    #[test]
    fn a_delivered_png_comes_through_and_a_handler_error_stays_failed() {
        let (sender, receiver) = oneshot::channel();
        sender.send(Ok(vec![137, 80, 78, 71])).unwrap();
        assert_eq!(block_on(await_snapshot(receiver, Duration::from_secs(1))), Ok(vec![137, 80, 78, 71]));

        let (sender, receiver) = oneshot::channel();
        sender.send(Err(CaptureError::Failed)).unwrap();
        assert_eq!(block_on(await_snapshot(receiver, Duration::from_secs(1))), Err(CaptureError::Failed));
    }

    #[test]
    fn a_silent_handler_times_out_and_a_dropped_one_fails() {
        let (_sender, receiver) = oneshot::channel::<Result<Vec<u8>, CaptureError>>();
        assert_eq!(block_on(await_snapshot(receiver, Duration::from_millis(20))), Err(CaptureError::Timeout));

        let (sender, receiver) = oneshot::channel::<Result<Vec<u8>, CaptureError>>();
        drop(sender);
        assert_eq!(block_on(await_snapshot(receiver, Duration::from_secs(1))), Err(CaptureError::Failed));
    }

    #[test]
    fn the_oversize_check_also_applies_to_the_delivered_bytes() {
        let (sender, receiver) = oneshot::channel();
        sender.send(Ok(vec![0; MAX_PNG_BYTES + 1])).unwrap();
        assert_eq!(block_on(await_snapshot(receiver, Duration::from_secs(1))), Err(CaptureError::TooLarge));
    }

    #[test]
    fn errors_serialise_as_kind_and_message() {
        let json = serde_json::to_value(CaptureError::Timeout).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "timeout" }));
        assert_eq!(CaptureError::Unsupported.to_string(), "screenshots are not supported on this platform");
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_targets_answer_unsupported() {
        let app = tauri::test::mock_app();
        assert_eq!(block_on(capture(app.handle())), Err(CaptureError::Unsupported));
    }
}
