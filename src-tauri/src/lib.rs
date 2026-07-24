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

#[cfg(test)]
mod tests {
    #[test]
    fn recovery_extract_command_is_registered_in_the_tauri_handler() {
        let source = include_str!("lib.rs");
        let registration = ["recovery::", "recovery_extract", ","].concat();
        assert!(
            source.contains(&registration),
            "recovery_extract must remain in tauri::generate_handler!"
        );
        assert_eq!(source.matches(&registration).count(), 1);
    }
}
