mod hid;

use hid::HidManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(HidManager::default())
    .invoke_handler(tauri::generate_handler![
      hid::commands::hid_list_devices,
      hid::commands::hid_open,
      hid::commands::hid_close,
      hid::commands::hid_send_report,
      hid::commands::hid_send_feature_report,
      hid::commands::hid_receive_feature_report,
      hid::commands::hid_watch_input_reports,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
