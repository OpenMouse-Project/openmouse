//! Native HID Abstraction Layer backend: the Rust half of the HAL described
//! in `src/hardware/`. Talks to real hardware via `hidapi`; exposes it to
//! the frontend as Tauri commands matched 1:1 with the `invoke()` calls in
//! `hardware/native.ts`.

pub mod commands;
pub mod descriptor;
pub mod state;

pub use state::HidManager;
