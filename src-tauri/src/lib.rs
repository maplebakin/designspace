mod recovery;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(recovery::RecoveryJobs::default())
        .invoke_handler(tauri::generate_handler![
            recovery::recovery_detect,
            recovery::recovery_discover_backups,
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

#[cfg(test)]
mod tests {
    #[test]
    fn recovery_resume_commands_are_registered_in_the_tauri_handler() {
        let source = include_str!("lib.rs");
        for command in ["recovery_extract", "recovery_discover_backups"] {
            let registration = ["recovery::", command, ","].concat();
            assert!(
                source.contains(&registration),
                "{command} must remain in tauri::generate_handler!"
            );
            assert_eq!(source.matches(&registration).count(), 1);
        }
    }
}
