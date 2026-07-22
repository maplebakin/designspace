mod recovery;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(recovery::RecoveryJobs::default())
        .invoke_handler(tauri::generate_handler![
            recovery::recovery_detect,
            recovery::recovery_inspect_destination,
            recovery::recovery_cancel,
            recovery::recovery_create_backup,
            recovery::recovery_verify_backup,
            recovery::recovery_extract,
            recovery::recovery_delete_original,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
