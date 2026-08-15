//! Tauri commands backing `hardware/native.ts`.
//!
//! Command names and payload shapes here are the wire contract with the
//! frontend — every `invoke("hid_...")` call in `native.ts` has a matching
//! `#[tauri::command]` below with the same argument names (Tauri maps JS
//! camelCase args to Rust snake_case params automatically).
//!
//! NOTE: written without a Rust toolchain available to compile/test in this
//! environment. Run `cargo check` before relying on this — see the README
//! section this PR adds for the desktop build prerequisites (in particular
//! `hidapi`'s system dependencies and the `get_report_descriptor` version
//! floor noted in `Cargo.toml`).

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::descriptor::{self, CollectionInfo};
use super::state::{HidManager, OpenDevice};

/// Fallback buffer size for a feature report whose length we couldn't
/// determine from the parsed descriptor (e.g. `get_report_descriptor`
/// unsupported on this platform/device). Generous relative to every report
/// size used by the drivers in this repo (all comfortably under 32 bytes).
const FEATURE_REPORT_FALLBACK_LEN: usize = 64;
/// Buffer size for the background input-report reader. HID reports on these
/// devices top out well under this; oversized reads are simply truncated to
/// what the device actually sent.
const INPUT_REPORT_BUFFER_LEN: usize = 64;
/// How long each blocking read waits before looping back to check the stop
/// flag. Bounds how long `hid_close` can block joining the reader thread.
const READ_TIMEOUT_MS: i32 = 250;

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct HidFilterArg {
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
    pub usage_page: Option<u16>,
    pub usage: Option<u16>,
}

fn matches_filters(info: &hidapi::DeviceInfo, filters: &[HidFilterArg]) -> bool {
    if filters.is_empty() {
        return true;
    }
    filters.iter().any(|f| {
        f.vendor_id.map_or(true, |v| v == info.vendor_id())
            && f.product_id.map_or(true, |v| v == info.product_id())
            && f.usage_page.map_or(true, |v| v == info.usage_page())
            && f.usage.map_or(true, |v| v == info.usage())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceSummary {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
}

/// Backs both `hid.getDevices()` (filters: []) and `hid.requestDevice()`
/// (filters: caller-supplied) on the native transport — see the doc comment
/// on `NativeHidTransport.requestDevice` in `native.ts` for why native mode
/// collapses those two into one enumeration call (no OS permission prompt
/// step to gate on, unlike WebHID).
#[tauri::command]
pub fn hid_list_devices(
    manager: State<HidManager>,
    filters: Vec<HidFilterArg>,
) -> Result<Vec<HidDeviceSummary>, String> {
    manager.with_api(|api| {
        Ok(api
            .device_list()
            .filter(|info| matches_filters(info, &filters))
            .map(|info| HidDeviceSummary {
                path: info.path().to_string_lossy().into_owned(),
                vendor_id: info.vendor_id(),
                product_id: info.product_id(),
                product_name: info.product_string().unwrap_or("HID device").to_string(),
            })
            .collect())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidOpenResult {
    pub collections: Vec<CollectionInfo>,
}

#[tauri::command]
pub fn hid_open(manager: State<HidManager>, path: String) -> Result<HidOpenResult, String> {
    let mut open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    if let Some(existing) = open.get(&path) {
        return Ok(HidOpenResult { collections: existing.collections.clone() });
    }

    let device = manager.with_api(|api| {
        let path_c = CString::new(path.clone()).map_err(|e| e.to_string())?;
        api.open_path(&path_c).map_err(|e| e.to_string())
    })?;

    let mut descriptor_buf = [0u8; 4096];
    let collections = match device.get_report_descriptor(&mut descriptor_buf) {
        Ok(len) => descriptor::parse(&descriptor_buf[..len]),
        // Descriptor readback isn't universally supported (older hidapi,
        // some platform/device combos). Drivers that only rely on fixed
        // report IDs still function without it — only `.collections`-based
        // usage-page sniffing degrades, gracefully, to "not found".
        Err(_) => Vec::new(),
    };

    device.set_blocking_mode(true).map_err(|e| e.to_string())?;

    open.insert(
        path,
        OpenDevice {
            device,
            collections: collections.clone(),
            reader: None,
            stop: Arc::new(AtomicBool::new(false)),
        },
    );

    Ok(HidOpenResult { collections })
}

#[tauri::command]
pub fn hid_close(manager: State<HidManager>, path: String) -> Result<(), String> {
    let mut open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    if let Some(entry) = open.remove(&path) {
        entry.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = entry.reader {
            // Bounded by READ_TIMEOUT_MS — the reader thread checks the stop
            // flag once per read timeout.
            let _ = handle.join();
        }
        // `entry.device` (and the reader thread's own separate handle,
        // already dropped when the thread exited above) close on drop here.
    }
    Ok(())
}

#[tauri::command]
pub fn hid_send_report(
    manager: State<HidManager>,
    path: String,
    report_id: u8,
    data: Vec<u8>,
) -> Result<(), String> {
    let open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    let entry = open.get(&path).ok_or("device not open")?;
    let mut buf = Vec::with_capacity(data.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(&data);
    entry.device.write(&buf).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hid_send_feature_report(
    manager: State<HidManager>,
    path: String,
    report_id: u8,
    data: Vec<u8>,
) -> Result<(), String> {
    let open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    let entry = open.get(&path).ok_or("device not open")?;
    let mut buf = Vec::with_capacity(data.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(&data);
    entry.device.send_feature_report(&buf).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hid_receive_feature_report(
    manager: State<HidManager>,
    path: String,
    report_id: u8,
) -> Result<Vec<u8>, String> {
    let open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    let entry = open.get(&path).ok_or("device not open")?;
    let len = descriptor::feature_report_length(&entry.collections, report_id as u32)
        .unwrap_or(FEATURE_REPORT_FALLBACK_LEN)
        .max(1);
    // hidapi convention: buf[0] is the report id (set before the call), the
    // OS fills buf[1..] with the report body and returns the total count
    // including that leading id byte.
    let mut buf = vec![0u8; len + 1];
    buf[0] = report_id;
    let read = entry.device.get_feature_report(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf[1..read.max(1)].to_vec())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InputReportPayload {
    path: String,
    report_id: u32,
    data: Vec<u8>,
}

/// Idempotent: safe to call every time `NativeHidDevice.open()` runs. Spawns
/// a dedicated blocking-read thread for `path` on first call and no-ops on
/// subsequent ones. Reports are pushed to the frontend as `hid://input-report`
/// events (see the single `listen()` subscription in `native.ts`, which
/// demuxes by `path` back to the right `NativeHidDevice` instance) rather
/// than returned from this command, since Rust can't call back into a
/// pending `invoke()` — there's no synchronous equivalent of WebHID's
/// `"inputreport"` DOM event to piggyback on.
#[tauri::command]
pub fn hid_watch_input_reports(
    app: AppHandle,
    manager: State<HidManager>,
    path: String,
) -> Result<(), String> {
    let mut open = manager.open.lock().map_err(|_| "hid state lock poisoned".to_string())?;
    let entry = open.get_mut(&path).ok_or("device not open")?;
    if entry.reader.is_some() {
        return Ok(());
    }

    // A second handle to the same path, dedicated to the blocking read loop,
    // so command calls (write / feature reports) on `entry.device` never
    // block behind it. hidapi opens HID paths non-exclusively on every
    // platform this repo targets (Windows/macOS/Linux), which is what makes
    // this safe — verify against the pinned hidapi version if you see
    // "device busy" style errors here.
    let reader_device = manager.with_api(|api| {
        let path_c = CString::new(path.clone()).map_err(|e| e.to_string())?;
        api.open_path(&path_c).map_err(|e| e.to_string())
    })?;
    reader_device.set_blocking_mode(false).map_err(|e| e.to_string())?;

    let stop = entry.stop.clone();
    let emit_path = path.clone();
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; INPUT_REPORT_BUFFER_LEN];
        while !stop.load(Ordering::SeqCst) {
            match reader_device.read_timeout(&mut buf, READ_TIMEOUT_MS) {
                Ok(0) => continue, // timeout, nothing to report
                Ok(len) => {
                    let report_id = buf[0] as u32;
                    let data = buf[1..len].to_vec();
                    let _ = app.emit(
                        "hid://input-report",
                        InputReportPayload { path: emit_path.clone(), report_id, data },
                    );
                }
                Err(_) => break, // device unplugged or errored — stop quietly
            }
        }
    });

    entry.reader = Some(handle);
    Ok(())
}
