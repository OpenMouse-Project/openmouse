//! App-managed state for native HID access.
//!
//! One `HidManager` lives in Tauri's state container (see `lib.rs`). It owns
//! the shared `HidApi` enumeration handle and a registry of currently-open
//! devices keyed by hidapi's device `path` — the same string the frontend
//! uses as a device identity (see `hardware/native.ts`'s `NativeHidDevice`).

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use hidapi::{HidApi, HidDevice};

use super::descriptor::CollectionInfo;

pub struct OpenDevice {
    /// Handle used by command calls (write / feature reports). The
    /// background reader thread (if any) uses its own separate handle to
    /// the same path — see `commands::hid_watch_input_reports` — so this one
    /// stays free for synchronous request/response calls without racing the
    /// blocking read loop.
    pub device: HidDevice,
    pub collections: Vec<CollectionInfo>,
    pub reader: Option<JoinHandle<()>>,
    pub stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct HidManager {
    api: Mutex<Option<HidApi>>,
    pub open: Mutex<HashMap<String, OpenDevice>>,
}

impl HidManager {
    /// Runs `f` with a live, freshly-refreshed `HidApi`, initializing it on
    /// first use. Held behind a mutex because `HidApi` is not `Sync`.
    pub fn with_api<T>(&self, f: impl FnOnce(&mut HidApi) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.api.lock().map_err(|_| "hid api lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(HidApi::new().map_err(|e| e.to_string())?);
        }
        let api = guard.as_mut().expect("just initialized above");
        // Pick up devices plugged in since the last call (hot-plug).
        api.refresh_devices().map_err(|e| e.to_string())?;
        f(api)
    }
}
