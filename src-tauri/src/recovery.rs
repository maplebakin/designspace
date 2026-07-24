use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::CString,
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    os::unix::ffi::OsStrExt,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const ORIGIN_LABEL: &str = "localhost:5174";
const DELETE_CONFIRMATION: &str = "DELETE LOCALHOST 5174 DATABASE";
const BACKUP_HEADROOM_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SUBPROCESS_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_PROGRESS_EVENT_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub struct RecoveryJobs {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    extraction_running: AtomicBool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCandidate {
    pub id: String,
    pub browser: String,
    pub profile: String,
    pub profile_path: String,
    pub database_path: String,
    pub blob_path: Option<String>,
    pub origin: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub browser_running: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionReport {
    pub candidates: Vec<RecoveryCandidate>,
    pub exact_origin: &'static str,
    pub delete_confirmation: &'static str,
    pub audit_log_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationReport {
    pub destination_path: String,
    pub available_bytes: u64,
    pub required_bytes: u64,
    pub sufficient_space: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    relative_path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u32,
    verified: bool,
    created_at: String,
    verified_at: Option<String>,
    source: RecoveryCandidate,
    total_bytes: u64,
    file_count: u64,
    files: Vec<BackupFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub backup_path: String,
    pub manifest_path: String,
    pub audit_log_path: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub verified: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub valid: bool,
    pub total_bytes: u64,
    pub file_count: u64,
    pub manifest_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub version: u32,
    pub source_profile: String,
    pub backup_root: String,
    pub export_root: String,
    pub recovered_at: String,
    pub records_scanned: u64,
    pub projects_found: u64,
    pub projects_recovered: u64,
    pub projects_skipped: u64,
    pub corrupt_records: u64,
    pub duplicate_revisions_removed: u64,
    pub distinct_revisions_superseded: u64,
    pub assets_hashed: u64,
    pub assets_deduplicated: u64,
    pub cross_project_duplicate_assets: u64,
    pub estimated_duplicate_asset_bytes: u64,
    pub original_backup_bytes: u64,
    pub recovered_export_bytes: u64,
    pub peak_record_limit_bytes: u64,
    pub projects: Vec<serde_json::Value>,
    pub failures: Vec<serde_json::Value>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub report_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub deleted_paths: Vec<String>,
    pub backup_preserved_at: String,
    pub logical_bytes_reclaimed: u64,
    pub free_bytes_before: u64,
    pub free_bytes_after: u64,
    pub source_absent: bool,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Cannot locate the current Linux home directory.".to_string())
}

fn allowed_browser_roots(home: &Path) -> [(String, PathBuf); 2] {
    [
        (
            "Google Chrome".to_string(),
            home.join(".config/google-chrome"),
        ),
        ("Chromium".to_string(), home.join(".config/chromium")),
    ]
}

fn is_profile_name(name: &str) -> bool {
    name == "Default"
        || name.strip_prefix("Profile ").is_some_and(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
        })
}

fn is_origin_database_name(name: &str) -> bool {
    let Some(prefix) = name.strip_suffix(".indexeddb.leveldb") else {
        return false;
    };
    prefix == "http_localhost_5174"
        || prefix
            .strip_prefix("http_localhost_5174_")
            .is_some_and(|suffix| {
                !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
            })
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!(
            "Unsafe relative path in recovery manifest: {}",
            path.display()
        ));
    }
    Ok(())
}

fn sha256_file(path: &Path, cancelled: Option<&AtomicBool>) -> Result<(u64, String), String> {
    let mut file =
        File::open(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 4 * 1024 * 1024];
    let mut total = 0_u64;
    loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err("Recovery operation cancelled; partial output was preserved.".to_string());
        }
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
        total += count as u64;
    }
    Ok((total, hex::encode(digest.finalize())))
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| format!("Cannot inspect {}: {error}", root.display()))?;
        if entry.file_type().is_symlink() {
            return Err(format!(
                "Refusing symbolic link inside recovery source: {}",
                entry.path().display()
            ));
        }
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    files.sort();
    Ok(files)
}

fn directory_stats(path: &Path) -> Result<(u64, u64), String> {
    let mut bytes = 0_u64;
    let files = collect_files(path)?;
    for file in &files {
        bytes = bytes.saturating_add(
            file.metadata()
                .map_err(|error| format!("Cannot inspect {}: {error}", file.display()))?
                .len(),
        );
    }
    Ok((bytes, files.len() as u64))
}

fn default_browser_root_from_environment(command: &str, environment: &[u8]) -> Option<PathBuf> {
    let home = environment
        .split(|byte| *byte == 0)
        .find_map(|entry| entry.strip_prefix(b"HOME="))
        .map(|value| PathBuf::from(std::ffi::OsStr::from_bytes(value)))?;
    if command.contains("google-chrome") {
        Some(home.join(".config/google-chrome"))
    } else if command.contains("chromium") {
        Some(home.join(".config/chromium"))
    } else {
        None
    }
}

fn profile_process_is_running(browser_root: &Path, profile_name: &str) -> bool {
    let lock = browser_root.join("SingletonLock");
    if let Ok(target) = fs::read_link(&lock) {
        if let Some(pid) = target
            .to_string_lossy()
            .rsplit('-')
            .next()
            .and_then(|value| value.parse::<u32>().ok())
        {
            if Path::new("/proc").join(pid.to_string()).exists() {
                return true;
            }
        }
    }

    let Ok(processes) = fs::read_dir("/proc") else {
        return false;
    };
    for process in processes.flatten() {
        if !process
            .file_name()
            .to_string_lossy()
            .chars()
            .all(|character| character.is_ascii_digit())
        {
            continue;
        }
        let Ok(raw) = fs::read(process.path().join("cmdline")) else {
            continue;
        };
        let command = String::from_utf8_lossy(&raw).replace('\0', " ");
        let is_browser = command.contains("google-chrome") || command.contains("chromium");
        if !is_browser {
            continue;
        }
        let explicit_root = format!("--user-data-dir={}", browser_root.display());
        let explicit_profile = format!("--profile-directory={profile_name}");
        if command.contains(&explicit_root) || command.contains(&explicit_profile) {
            return true;
        }
        // Chrome normally puts the user-data root only on the browser process,
        // not child processes. Resolve the main process HOME so an unrelated
        // browser session cannot falsely lock a recovery profile under another
        // home directory.
        if !command.contains("--type=") && !command.contains("--user-data-dir=") {
            match fs::read(process.path().join("environ"))
                .ok()
                .and_then(|environment| {
                    default_browser_root_from_environment(&command, &environment)
                }) {
                Some(expected_root) if expected_root == browser_root => return true,
                Some(_) => {}
                // If Linux process metadata is unavailable, retain the safer
                // refusal instead of assuming the profile is inactive.
                None => return true,
            }
        }
    }
    false
}

fn candidate_id(path: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(path.as_os_str().as_bytes());
    format!("ds-{}", &hex::encode(digest.finalize())[..20])
}

fn detect_with_home(home: &Path) -> Result<Vec<RecoveryCandidate>, String> {
    let mut candidates = Vec::new();
    for (browser, browser_root) in allowed_browser_roots(home) {
        if !browser_root.is_dir() {
            continue;
        }
        let profiles = fs::read_dir(&browser_root)
            .map_err(|error| format!("Cannot inspect {}: {error}", browser_root.display()))?;
        for profile in profiles.flatten() {
            let profile_name = profile.file_name().to_string_lossy().into_owned();
            if !is_profile_name(&profile_name) || !profile.path().is_dir() {
                continue;
            }
            let indexed_db = profile.path().join("IndexedDB");
            let Ok(indexed_db_canonical) = indexed_db.canonicalize() else {
                continue;
            };
            let Ok(origins) = fs::read_dir(&indexed_db) else {
                continue;
            };
            for origin in origins.flatten() {
                let origin_name = origin.file_name().to_string_lossy().into_owned();
                if !is_origin_database_name(&origin_name) || !origin.path().is_dir() {
                    continue;
                }
                let canonical = origin.path().canonicalize().map_err(|error| {
                    format!("Cannot resolve {}: {error}", origin.path().display())
                })?;
                if !canonical.starts_with(&indexed_db_canonical) {
                    return Err(format!(
                        "Refusing origin path outside the selected profile IndexedDB directory: {}",
                        canonical.display()
                    ));
                }
                let blob_name = origin_name.replace(".indexeddb.leveldb", ".indexeddb.blob");
                let blob = indexed_db.join(blob_name);
                let blob = if blob.is_dir() {
                    let canonical_blob = blob
                        .canonicalize()
                        .map_err(|error| format!("Cannot resolve {}: {error}", blob.display()))?;
                    if !canonical_blob.starts_with(&indexed_db_canonical) {
                        return Err(format!("Refusing blob path outside the selected profile IndexedDB directory: {}", canonical_blob.display()));
                    }
                    Some(canonical_blob)
                } else {
                    None
                };
                let (level_bytes, level_files) = directory_stats(&canonical)?;
                let (blob_bytes, blob_files) = if let Some(blob) = &blob {
                    directory_stats(blob)?
                } else {
                    (0, 0)
                };
                candidates.push(RecoveryCandidate {
                    id: candidate_id(&canonical),
                    browser: browser.clone(),
                    profile: profile_name.clone(),
                    profile_path: profile.path().display().to_string(),
                    database_path: canonical.display().to_string(),
                    blob_path: blob.as_ref().map(|path| path.display().to_string()),
                    origin: ORIGIN_LABEL.to_string(),
                    size_bytes: level_bytes.saturating_add(blob_bytes),
                    file_count: level_files.saturating_add(blob_files),
                    browser_running: profile_process_is_running(&browser_root, &profile_name),
                });
            }
        }
    }
    candidates.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    Ok(candidates)
}

fn resolve_candidate(id: &str) -> Result<RecoveryCandidate, String> {
    detect_with_home(&home_dir()?)?
        .into_iter()
        .find(|candidate| candidate.id == id)
        .ok_or_else(|| {
            "The selected Design Space origin database is no longer present at its detected path."
                .to_string()
        })
}

fn available_space(path: &Path) -> Result<u64, String> {
    let mut existing = path;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("No existing parent for {}", path.display()))?;
    }
    let raw = CString::new(existing.as_os_str().as_bytes())
        .map_err(|_| format!("Invalid destination path: {}", existing.display()))?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let result = unsafe { libc::statvfs(raw.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return Err(format!(
            "Cannot measure available space for {}",
            existing.display()
        ));
    }
    let stats = unsafe { stats.assume_init() };
    Ok((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
}

fn expand_destination(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Choose a backup destination folder.".to_string());
    }
    let path = if trimmed == "~" {
        home_dir()?
    } else if let Some(suffix) = trimmed.strip_prefix("~/") {
        home_dir()?.join(suffix)
    } else {
        PathBuf::from(trimmed)
    };
    if !path.is_absolute() {
        return Err("Backup and export destinations must be absolute paths.".to_string());
    }
    Ok(path)
}

fn audit(
    path: &Path,
    action: &str,
    status: &str,
    details: serde_json::Value,
) -> Result<(), String> {
    let entry = serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "action": action,
        "status": status,
        "details": details,
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Cannot write audit log {}: {error}", path.display()))?;
    writeln!(file, "{}", entry).map_err(|error| format!("Cannot write audit log: {error}"))
}

fn application_audit(
    app: &tauri::AppHandle,
    action: &str,
    status: &str,
    details: serde_json::Value,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot locate Design Space application data: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Cannot create audit directory {}: {error}",
            directory.display()
        )
    })?;
    let path = directory.join("browser-recovery-audit.jsonl");
    audit(&path, action, status, details)?;
    Ok(path)
}

fn copy_tree(
    source: &Path,
    destination: &Path,
    prefix: &str,
    cancelled: &AtomicBool,
    entries: &mut Vec<BackupFile>,
) -> Result<(), String> {
    for source_file in collect_files(source)? {
        if cancelled.load(Ordering::Relaxed) {
            return Err(
                "Backup cancelled; the .partial folder was preserved for review.".to_string(),
            );
        }
        let relative = source_file
            .strip_prefix(source)
            .map_err(|_| "Cannot derive a safe backup path.".to_string())?;
        validate_relative_path(relative)?;
        let destination_file = destination.join(prefix).join(relative);
        if let Some(parent) = destination_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
        }
        let mut input = File::open(&source_file)
            .map_err(|error| format!("Cannot read {}: {error}", source_file.display()))?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination_file)
            .map_err(|error| format!("Cannot create {}: {error}", destination_file.display()))?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0_u8; 4 * 1024 * 1024];
        let mut size = 0_u64;
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err(
                    "Backup cancelled; the .partial folder was preserved for review.".to_string(),
                );
            }
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("Cannot read {}: {error}", source_file.display()))?;
            if count == 0 {
                break;
            }
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Cannot write {}: {error}", destination_file.display()))?;
            digest.update(&buffer[..count]);
            size += count as u64;
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot sync {}: {error}", destination_file.display()))?;
        entries.push(BackupFile {
            relative_path: Path::new("source")
                .join(prefix)
                .join(relative)
                .display()
                .to_string(),
            size_bytes: size,
            sha256: hex::encode(digest.finalize()),
        });
    }
    Ok(())
}

fn read_manifest_file(path: &Path) -> Result<BackupManifest, String> {
    let file = File::open(path)
        .map_err(|error| format!("Cannot open backup manifest {}: {error}", path.display()))?;
    serde_json::from_reader(file)
        .map_err(|error| format!("Invalid backup manifest {}: {error}", path.display()))
}

fn read_manifest(path: &Path) -> Result<BackupManifest, String> {
    let manifest = read_manifest_file(path)?;
    if manifest.version != 1 || !manifest.verified {
        return Err("Backup manifest is not a verified Design Space recovery backup.".to_string());
    }
    Ok(manifest)
}

fn verify_manifest_files(
    path: &Path,
    manifest: &BackupManifest,
    cancelled: Option<&AtomicBool>,
) -> Result<VerificationReport, String> {
    let root = path
        .parent()
        .ok_or_else(|| "Backup manifest has no parent folder.".to_string())?;
    let mut total = 0_u64;
    for entry in &manifest.files {
        let relative = Path::new(&entry.relative_path);
        validate_relative_path(relative)?;
        let file = root.join(relative);
        let (size, hash) = sha256_file(&file, cancelled)?;
        if size != entry.size_bytes || hash != entry.sha256 {
            return Err(format!("Backup verification failed for {}", file.display()));
        }
        total = total.saturating_add(size);
    }
    if total != manifest.total_bytes || manifest.files.len() as u64 != manifest.file_count {
        return Err("Backup file count or total size does not match its manifest.".to_string());
    }
    Ok(VerificationReport {
        valid: true,
        total_bytes: total,
        file_count: manifest.file_count,
        manifest_path: path.display().to_string(),
    })
}

fn verify_manifest(
    path: &Path,
    cancelled: Option<&AtomicBool>,
) -> Result<VerificationReport, String> {
    let manifest = read_manifest(path)?;
    verify_manifest_files(path, &manifest, cancelled)
}

fn register_job(state: &RecoveryJobs, job_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "Recovery job registry is unavailable.".to_string())?;
    if jobs.contains_key(job_id) {
        return Err("A recovery job with this ID is already running.".to_string());
    }
    let flag = Arc::new(AtomicBool::new(false));
    jobs.insert(job_id.to_string(), flag.clone());
    Ok(flag)
}

fn finish_job(state: &RecoveryJobs, job_id: &str) {
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(job_id);
    }
}

fn register_extraction_job(state: &RecoveryJobs, job_id: &str) -> Result<Arc<AtomicBool>, String> {
    state
        .extraction_running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "A project recovery job is already running.".to_string())?;
    match register_job(state, job_id) {
        Ok(cancelled) => Ok(cancelled),
        Err(error) => {
            state.extraction_running.store(false, Ordering::Release);
            Err(error)
        }
    }
}

fn finish_extraction_job(state: &RecoveryJobs, job_id: &str) {
    finish_job(state, job_id);
    state.extraction_running.store(false, Ordering::Release);
}

#[tauri::command]
pub fn recovery_detect(app: tauri::AppHandle) -> Result<DetectionReport, String> {
    let candidates = detect_with_home(&home_dir()?)?;
    let audit_log_path = application_audit(
        &app,
        "detect",
        "completed",
        serde_json::json!({
            "origin": ORIGIN_LABEL,
            "candidates": candidates.iter().map(|candidate| serde_json::json!({
                "browser": candidate.browser,
                "profile": candidate.profile,
                "databasePath": candidate.database_path,
                "sizeBytes": candidate.size_bytes,
                "browserRunning": candidate.browser_running,
            })).collect::<Vec<_>>(),
        }),
    )?;
    Ok(DetectionReport {
        candidates,
        exact_origin: ORIGIN_LABEL,
        delete_confirmation: DELETE_CONFIRMATION,
        audit_log_path: audit_log_path.display().to_string(),
    })
}

#[tauri::command]
pub fn recovery_inspect_destination(
    app: tauri::AppHandle,
    database_id: String,
    destination: String,
) -> Result<DestinationReport, String> {
    let candidate = resolve_candidate(&database_id)?;
    let destination = expand_destination(&destination)?;
    let available = available_space(&destination)?;
    let required = candidate.size_bytes.saturating_add(BACKUP_HEADROOM_BYTES);
    let report = DestinationReport {
        destination_path: destination.display().to_string(),
        available_bytes: available,
        required_bytes: required,
        sufficient_space: available >= required,
    };
    application_audit(
        &app,
        "inspect-destination",
        "completed",
        serde_json::json!({
            "databaseId": database_id,
            "destination": report.destination_path,
            "availableBytes": report.available_bytes,
            "requiredBytes": report.required_bytes,
            "sufficientSpace": report.sufficient_space,
        }),
    )?;
    Ok(report)
}

#[tauri::command]
pub fn recovery_cancel(
    state: tauri::State<'_, RecoveryJobs>,
    job_id: String,
) -> Result<(), String> {
    let jobs = state
        .jobs
        .lock()
        .map_err(|_| "Recovery job registry is unavailable.".to_string())?;
    let flag = jobs
        .get(&job_id)
        .ok_or_else(|| "Recovery job is not running.".to_string())?;
    flag.store(true, Ordering::Relaxed);
    Ok(())
}

fn create_backup(
    candidate: &RecoveryCandidate,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<BackupReport, String> {
    if candidate.browser_running {
        return Err(format!("Close {} profile {} before backup. The source database will not be copied while active.", candidate.browser, candidate.profile));
    }
    let available = available_space(destination)?;
    let required = candidate.size_bytes.saturating_add(BACKUP_HEADROOM_BYTES);
    if available < required {
        return Err(format!(
            "Insufficient backup space: {} bytes available, {} bytes required.",
            available, required
        ));
    }
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Cannot create destination {}: {error}",
            destination.display()
        )
    })?;
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let final_root = destination.join(format!("design-space-indexeddb-backup-{stamp}"));
    let partial_root = destination.join(format!("design-space-indexeddb-backup-{stamp}.partial"));
    fs::create_dir(&partial_root).map_err(|error| {
        format!(
            "Cannot create backup folder {}: {error}",
            partial_root.display()
        )
    })?;
    let audit_path = partial_root.join("recovery-audit.jsonl");
    audit(
        &audit_path,
        "backup",
        "started",
        serde_json::json!({"source": candidate.database_path, "destination": partial_root}),
    )?;
    let mut entries = Vec::new();
    let result = (|| {
        copy_tree(
            Path::new(&candidate.database_path),
            &partial_root.join("source"),
            "leveldb",
            cancelled,
            &mut entries,
        )?;
        if let Some(blob) = &candidate.blob_path {
            copy_tree(
                Path::new(blob),
                &partial_root.join("source"),
                "blob",
                cancelled,
                &mut entries,
            )?;
        }
        let total = entries.iter().map(|entry| entry.size_bytes).sum();
        let mut manifest = BackupManifest {
            version: 1,
            verified: false,
            created_at: Utc::now().to_rfc3339(),
            verified_at: None,
            source: candidate.clone(),
            total_bytes: total,
            file_count: entries.len() as u64,
            files: entries,
        };
        let manifest_path = partial_root.join("backup-manifest.json");
        serde_json::to_writer_pretty(
            File::create(&manifest_path)
                .map_err(|error| format!("Cannot create manifest: {error}"))?,
            &manifest,
        )
        .map_err(|error| format!("Cannot write backup manifest: {error}"))?;
        // Verify every copied byte before marking the manifest as trusted.
        verify_manifest_files(&manifest_path, &manifest, Some(cancelled))?;
        manifest.verified = true;
        manifest.verified_at = Some(Utc::now().to_rfc3339());
        serde_json::to_writer_pretty(
            File::create(&manifest_path)
                .map_err(|error| format!("Cannot update manifest: {error}"))?,
            &manifest,
        )
        .map_err(|error| format!("Cannot update backup manifest: {error}"))?;
        verify_manifest(&manifest_path, Some(cancelled))?;
        audit(
            &audit_path,
            "backup",
            "verified",
            serde_json::json!({"bytes": total, "files": manifest.file_count}),
        )?;
        fs::rename(&partial_root, &final_root)
            .map_err(|error| format!("Cannot finalize backup folder: {error}"))?;
        Ok(BackupReport {
            backup_path: final_root.display().to_string(),
            manifest_path: final_root
                .join("backup-manifest.json")
                .display()
                .to_string(),
            audit_log_path: final_root
                .join("recovery-audit.jsonl")
                .display()
                .to_string(),
            total_bytes: total,
            file_count: manifest.file_count,
            verified: true,
        })
    })();
    if let Err(error) = &result {
        let _ = audit(
            &audit_path,
            "backup",
            "failed",
            serde_json::json!({"error": error}),
        );
        let _ = fs::write(
            partial_root.join("backup-status.json"),
            serde_json::json!({
                "status": "partial",
                "error": error,
                "sourceUntouched": true,
                "timestamp": Utc::now().to_rfc3339(),
            })
            .to_string(),
        );
    }
    result
}

#[tauri::command]
pub async fn recovery_create_backup(
    state: tauri::State<'_, RecoveryJobs>,
    database_id: String,
    destination: String,
    job_id: String,
) -> Result<BackupReport, String> {
    let candidate = resolve_candidate(&database_id)?;
    // Re-evaluate activity immediately before opening source files.
    let candidate = resolve_candidate(&candidate.id)?;
    let destination = expand_destination(&destination)?;
    let cancelled = register_job(&state, &job_id)?;
    let result = create_backup(&candidate, &destination, &cancelled);
    finish_job(&state, &job_id);
    result
}

#[tauri::command]
pub fn recovery_verify_backup(manifest_path: String) -> Result<VerificationReport, String> {
    verify_manifest(Path::new(&manifest_path), None)
}

fn recovery_tool_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resolve(
            "recovery_tools/recover_indexeddb.py",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|error| format!("Cannot locate bundled recovery reader: {error}"))?;
    if bundled.is_file() {
        return Ok(bundled);
    }
    let development =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("recovery_tools/recover_indexeddb.py");
    development
        .is_file()
        .then_some(development)
        .ok_or_else(|| "The bundled Chromium recovery reader is missing.".to_string())
}

fn resolve_python_executable() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("DESIGN_SPACE_RECOVERY_PYTHON") {
        let configured = PathBuf::from(configured);
        return configured
            .is_file()
            .then_some(configured.clone())
            .ok_or_else(|| {
                format!(
                    "Configured Python executable does not exist: {}",
                    configured.display()
                )
            });
    }
    let path = std::env::var_os("PATH")
        .ok_or_else(|| "Cannot locate Python: PATH is unavailable.".to_string())?;
    for directory in std::env::split_paths(&path) {
        for name in ["python3", "python"] {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return candidate.canonicalize().or(Ok(candidate));
            }
        }
    }
    Err("Cannot locate a Python 3 executable. Install Python 3 or set DESIGN_SPACE_RECOVERY_PYTHON to its absolute path.".to_string())
}

#[derive(Default)]
struct BoundedOutput {
    text: String,
    total_bytes: usize,
    truncated: bool,
}

impl BoundedOutput {
    fn push(&mut self, bytes: &[u8]) {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        let remaining = MAX_SUBPROCESS_OUTPUT_BYTES.saturating_sub(self.text.len());
        if remaining > 0 {
            self.text.push_str(&String::from_utf8_lossy(
                &bytes[..bytes.len().min(remaining)],
            ));
        }
        self.truncated |= bytes.len() > remaining;
    }

    fn display(&self) -> String {
        let trimmed = self.text.trim();
        if self.truncated {
            format!(
                "{trimmed}\n[output truncated after {MAX_SUBPROCESS_OUTPUT_BYTES} bytes; {} bytes drained]",
                self.total_bytes
            )
        } else {
            trimmed.to_string()
        }
    }
}

fn drain_bounded(mut reader: impl Read) -> BoundedOutput {
    let mut output = BoundedOutput::default();
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => output.push(&chunk[..count]),
            Err(error) => {
                output.push(format!("\n[stream read failed: {error}]").as_bytes());
                break;
            }
        }
    }
    output
}

fn emit_recovery_progress(
    app: &tauri::AppHandle,
    phase: &str,
    message: &str,
    details: serde_json::Value,
) {
    let payload = recovery_progress_payload(phase, message, details);
    if let Err(error) = app.emit("design-space-recovery-progress", payload) {
        eprintln!("[Design Space recovery] progress event failed: {error}");
    }
}

fn recovery_progress_payload(
    phase: &str,
    message: &str,
    details: serde_json::Value,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "phase": phase,
        "message": message,
    });
    if let (Some(target), Some(source)) = (payload.as_object_mut(), details.as_object()) {
        target.extend(source.clone());
    }
    payload
}

struct ExtractionRequest {
    manifest_path: PathBuf,
    export_destination: String,
    python: PathBuf,
    script: PathBuf,
    audit_path: PathBuf,
}

fn run_recovery_extractor<F>(
    request: ExtractionRequest,
    cancelled: &AtomicBool,
    emit: &F,
) -> Result<RecoveryReport, String>
where
    F: Fn(serde_json::Value),
{
    if !request.python.is_file() {
        return Err(format!(
            "Python executable is missing: {}",
            request.python.display()
        ));
    }
    if !request.script.is_file() {
        return Err(format!(
            "Chromium recovery script is missing: {}",
            request.script.display()
        ));
    }
    emit(recovery_progress_payload(
        "validate-backup",
        "Validating the verified backup byte-for-byte…",
        serde_json::json!({}),
    ));
    let verification = verify_manifest(&request.manifest_path, Some(cancelled))?;
    let manifest = read_manifest(&request.manifest_path)?;
    let backup_root = request
        .manifest_path
        .parent()
        .ok_or_else(|| "Backup root is invalid.".to_string())?
        .to_path_buf();
    audit(
        &request.audit_path,
        "extract",
        "backup-validated",
        serde_json::json!({
            "bytes": verification.total_bytes,
            "files": verification.file_count,
        }),
    )?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("Recovery cancelled; the verified backup remains unchanged.".to_string());
    }

    let export_root = expand_destination(&request.export_destination)?.join(format!(
        "design-space-recovered-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    fs::create_dir_all(&export_root).map_err(|error| {
        format!(
            "Cannot create export destination {}: {error}",
            export_root.display()
        )
    })?;
    emit(recovery_progress_payload(
        "launch-extractor",
        "Launching the read-only Chromium extractor…",
        serde_json::json!({}),
    ));
    audit(
        &request.audit_path,
        "extract",
        "launching",
        serde_json::json!({
            "python": request.python,
            "script": request.script,
            "export": export_root,
        }),
    )?;
    eprintln!(
        "[Design Space recovery] launching extractor python={} script={}",
        request.python.display(),
        request.script.display()
    );

    let mut child = Command::new(&request.python)
        .arg(&request.script)
        .arg("--backup-root")
        .arg(&backup_root)
        .arg("--export-root")
        .arg(&export_root)
        .arg("--source-profile")
        .arg(format!(
            "{} / {}",
            manifest.source.browser, manifest.source.profile
        ))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Cannot start Python recovery reader with {}: {error}",
                request.python.display()
            )
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Recovery reader produced no output stream.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Recovery reader produced no error stream.".to_string())?;
    let (progress_tx, progress_rx) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        let mut captured = BoundedOutput::default();
        let mut reader = BufReader::new(stdout);
        let mut chunk = [0_u8; 8192];
        let mut pending = Vec::new();
        let mut oversized_line = false;
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    captured.push(&chunk[..count]);
                    for byte in &chunk[..count] {
                        if *byte == b'\n' {
                            if !oversized_line {
                                let line = String::from_utf8_lossy(&pending).into_owned();
                                let _ = progress_tx.send(line);
                            }
                            pending.clear();
                            oversized_line = false;
                        } else if pending.len() < MAX_PROGRESS_EVENT_BYTES {
                            pending.push(*byte);
                        } else {
                            oversized_line = true;
                        }
                    }
                }
                Err(error) => {
                    captured.push(format!("\n[stdout read failed: {error}]\n").as_bytes());
                    break;
                }
            }
        }
        if !pending.is_empty() && !oversized_line {
            let _ = progress_tx.send(String::from_utf8_lossy(&pending).into_owned());
        }
        captured
    });
    let stderr_thread = thread::spawn(move || drain_bounded(stderr));
    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let stdout = stdout_thread.join().unwrap_or_default();
            let stderr = stderr_thread.join().unwrap_or_default();
            let _ = audit(
                &request.audit_path,
                "extract",
                "cancelled",
                serde_json::json!({
                    "partialExport": export_root,
                    "stdout": stdout.display(),
                    "stderr": stderr.display(),
                }),
            );
            return Err(
                "Recovery cancelled; the verified backup and partial export were preserved."
                    .to_string(),
            );
        }
        while let Ok(line) = progress_rx.try_recv() {
            if let Ok(progress) = serde_json::from_str::<serde_json::Value>(&line) {
                emit(progress);
            }
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Cannot poll recovery reader: {error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stdout = stdout_thread.join().unwrap_or_else(|_| {
        let mut output = BoundedOutput::default();
        output.push(b"Recovery reader stdout thread failed.");
        output
    });
    while let Ok(line) = progress_rx.try_recv() {
        if let Ok(progress) = serde_json::from_str::<serde_json::Value>(&line) {
            emit(progress);
        }
    }
    let stderr = stderr_thread.join().unwrap_or_else(|_| {
        let mut output = BoundedOutput::default();
        output.push(b"Recovery reader stderr thread failed.");
        output
    });
    eprintln!(
        "[Design Space recovery] extractor exited status={} stdout_bytes={} stderr_bytes={}",
        status, stdout.total_bytes, stderr.total_bytes
    );
    if !status.success() {
        let stderr_detail = stderr.display();
        let stdout_detail = stdout.display();
        audit(
            &request.audit_path,
            "extract",
            "failed",
            serde_json::json!({
                "exitStatus": status.to_string(),
                "stdout": stdout_detail,
                "stderr": stderr_detail,
                "partialExport": export_root,
            }),
        )?;
        let concise = if stderr_detail.is_empty() {
            "No stderr was produced.".to_string()
        } else {
            stderr_detail.chars().take(2000).collect()
        };
        return Err(format!(
            "Chromium recovery reader exited with {status}: {concise}"
        ));
    }

    emit(recovery_progress_payload(
        "recovery-report",
        "Generating and validating the recovery report…",
        serde_json::json!({}),
    ));
    let report_path = export_root.join("recovery-report.json");
    let mut report: RecoveryReport = serde_json::from_reader(
        File::open(&report_path).map_err(|error| format!("Recovery report is missing: {error}"))?,
    )
    .map_err(|error| format!("Recovery report is invalid: {error}"))?;
    report.report_path = report_path.display().to_string();
    audit(
        &request.audit_path,
        "extract",
        "completed",
        serde_json::json!({
            "report": report_path,
            "projectsRecovered": report.projects_recovered,
            "corruptRecords": report.corrupt_records,
            "stdout": stdout.display(),
            "stderr": stderr.display(),
        }),
    )?;
    Ok(report)
}

#[tauri::command]
pub async fn recovery_extract(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryJobs>,
    manifest_path: String,
    export_destination: String,
    job_id: String,
) -> Result<RecoveryReport, String> {
    eprintln!("[Design Space recovery] recovery_extract command began job={job_id}");
    let cancelled = register_extraction_job(&state, &job_id)?;
    let manifest_path = PathBuf::from(manifest_path);
    let audit_path = manifest_path
        .parent()
        .map(|path| path.join("recovery-audit.jsonl"));
    emit_recovery_progress(
        &app,
        "validate-backup",
        "Validating the verified backup…",
        serde_json::json!({}),
    );
    let result = async {
        let audit_path = audit_path
            .clone()
            .ok_or_else(|| "Backup manifest has no parent folder.".to_string())?;
        audit(
            &audit_path,
            "extract",
            "requested",
            serde_json::json!({"jobId": job_id}),
        )?;
        let python = resolve_python_executable()?;
        let script = recovery_tool_path(&app)?;
        eprintln!(
            "[Design Space recovery] resolved python={} script={}",
            python.display(),
            script.display()
        );
        audit(
            &audit_path,
            "extract",
            "runtime-resolved",
            serde_json::json!({"python": python, "script": script}),
        )?;
        let app_for_worker = app.clone();
        let cancelled_for_worker = cancelled.clone();
        let request = ExtractionRequest {
            manifest_path,
            export_destination,
            python,
            script,
            audit_path,
        };
        tauri::async_runtime::spawn_blocking(move || {
            let emit = |progress| {
                if let Err(error) = app_for_worker.emit("design-space-recovery-progress", progress)
                {
                    eprintln!("[Design Space recovery] progress event failed: {error}");
                }
            };
            run_recovery_extractor(request, &cancelled_for_worker, &emit)
        })
        .await
        .map_err(|error| format!("Recovery worker could not complete: {error}"))?
    }
    .await;
    finish_extraction_job(&state, &job_id);
    if let Err(error) = &result {
        eprintln!("[Design Space recovery] recovery_extract failed: {error}");
        if let Some(audit_path) = &audit_path {
            let _ = audit(
                audit_path,
                "extract",
                "command-failed",
                serde_json::json!({"error": error}),
            );
            return Err(format!(
                "{error} Detailed audit log: {}",
                audit_path.display()
            ));
        }
    }
    result
}

fn verify_source_matches_backup(
    candidate: &RecoveryCandidate,
    manifest: &BackupManifest,
) -> Result<(), String> {
    let mut expected: HashMap<&str, &BackupFile> = manifest
        .files
        .iter()
        .map(|entry| (entry.relative_path.as_str(), entry))
        .collect();
    for (prefix, raw_source) in [
        ("source/leveldb", Some(&candidate.database_path)),
        ("source/blob", candidate.blob_path.as_ref()),
    ] {
        let Some(raw_source) = raw_source else {
            continue;
        };
        let source = Path::new(raw_source);
        for file in collect_files(source)? {
            let relative = file
                .strip_prefix(source)
                .map_err(|_| "Cannot validate source path.".to_string())?;
            let key = Path::new(prefix).join(relative).display().to_string();
            let entry = expected.remove(key.as_str()).ok_or_else(|| {
                format!(
                    "Original database changed after backup: unexpected file {}",
                    file.display()
                )
            })?;
            let (size, hash) = sha256_file(&file, None)?;
            if size != entry.size_bytes || hash != entry.sha256 {
                return Err(format!(
                    "Original database changed after backup: {}",
                    file.display()
                ));
            }
        }
    }
    if !expected.is_empty() {
        return Err(
            "Original database no longer contains every file recorded in the verified backup."
                .to_string(),
        );
    }
    Ok(())
}

fn cleanup_candidate(
    candidate: &RecoveryCandidate,
    manifest_path: &Path,
    confirmation: &str,
) -> Result<CleanupReport, String> {
    if confirmation != DELETE_CONFIRMATION {
        return Err(format!(
            "Type the exact confirmation phrase: {DELETE_CONFIRMATION}"
        ));
    }
    if candidate.browser_running {
        return Err(format!(
            "Close {} profile {} before deleting its Design Space origin database.",
            candidate.browser, candidate.profile
        ));
    }
    verify_manifest(manifest_path, None)?;
    let manifest = read_manifest(manifest_path)?;
    if manifest.source.id != candidate.id
        || manifest.source.database_path != candidate.database_path
    {
        return Err("Verified backup does not belong to the selected origin database.".to_string());
    }
    verify_source_matches_backup(candidate, &manifest)?;
    let backup_root = manifest_path
        .parent()
        .ok_or_else(|| "Backup root is invalid.".to_string())?;
    let audit_path = backup_root.join("recovery-audit.jsonl");
    audit(
        &audit_path,
        "delete-original",
        "authorized",
        serde_json::json!({
            "databasePath": candidate.database_path,
            "blobPath": candidate.blob_path,
            "confirmation": confirmation,
        }),
    )?;
    let free_before = available_space(Path::new(&candidate.profile_path))?;
    let database = PathBuf::from(&candidate.database_path);
    let pending_database = database.with_file_name(format!(
        ".design-space-delete-pending-{}.leveldb",
        candidate.id
    ));
    fs::rename(&database, &pending_database).map_err(|error| {
        format!(
            "Could not isolate exact origin database {} for deletion: {error}",
            database.display()
        )
    })?;
    let blob = candidate.blob_path.as_ref().map(PathBuf::from);
    let pending_blob = blob.as_ref().map(|path| {
        path.with_file_name(format!(
            ".design-space-delete-pending-{}.blob",
            candidate.id
        ))
    });
    if let (Some(blob), Some(pending_blob)) = (&blob, &pending_blob) {
        if blob.exists() {
            if let Err(error) = fs::rename(blob, pending_blob) {
                let _ = fs::rename(&pending_database, &database);
                return Err(format!("Could not isolate the exact blob companion {}: {error}. The LevelDB path was restored and the verified backup is intact.", blob.display()));
            }
        }
    }
    if let Err(error) = fs::remove_dir_all(&pending_database) {
        let _ = fs::rename(&pending_database, &database);
        if let (Some(blob), Some(pending_blob)) = (&blob, &pending_blob) {
            if pending_blob.exists() {
                let _ = fs::rename(pending_blob, blob);
            }
        }
        return Err(format!("Could not delete exact origin database after isolation: {error}. Recovery mode remains active."));
    }
    if let Some(pending_blob) = &pending_blob {
        if pending_blob.exists() {
            fs::remove_dir_all(pending_blob).map_err(|error| format!("The LevelDB was deleted, but its isolated blob companion could not be removed at {}: {error}. The verified backup is intact and recovery mode remains active.", pending_blob.display()))?;
        }
    }
    let mut deleted = vec![candidate.database_path.clone()];
    if let Some(blob) = &candidate.blob_path {
        deleted.push(blob.clone());
    }
    let free_after = available_space(Path::new(&candidate.profile_path))?;
    let source_absent = deleted.iter().all(|path| !Path::new(path).exists());
    if !source_absent {
        return Err(
            "Cleanup did not remove every selected origin path; recovery mode must remain active."
                .to_string(),
        );
    }
    audit(
        &audit_path,
        "delete-original",
        "completed",
        serde_json::json!({
            "deletedPaths": deleted,
            "logicalBytesReclaimed": candidate.size_bytes,
            "freeBytesBefore": free_before,
            "freeBytesAfter": free_after,
            "backupPreserved": backup_root,
        }),
    )?;
    Ok(CleanupReport {
        deleted_paths: deleted,
        backup_preserved_at: backup_root.display().to_string(),
        logical_bytes_reclaimed: candidate.size_bytes,
        free_bytes_before: free_before,
        free_bytes_after: free_after,
        source_absent,
    })
}

#[tauri::command]
pub fn recovery_delete_original(
    database_id: String,
    manifest_path: String,
    confirmation: String,
) -> Result<CleanupReport, String> {
    let candidate = resolve_candidate(&database_id)?;
    // Exact path, size and browser status are rediscovered immediately before deletion.
    cleanup_candidate(&candidate, Path::new(&manifest_path), &confirmation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "design-space-recovery-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn fixture_candidate(root: &Path) -> RecoveryCandidate {
        let db = root
            .join(".config/google-chrome/Default/IndexedDB/http_localhost_5174.indexeddb.leveldb");
        fs::create_dir_all(&db).unwrap();
        fs::write(db.join("000001.ldb"), b"fixture-leveldb").unwrap();
        detect_with_home(root).unwrap().remove(0)
    }

    fn fixture_backup(root: &Path) -> BackupReport {
        let candidate = fixture_candidate(root);
        create_backup(
            &candidate,
            &root.join("verified-backup"),
            &AtomicBool::new(false),
        )
        .unwrap()
    }

    fn extraction_request(
        root: &Path,
        backup: &BackupReport,
        python: PathBuf,
        script: PathBuf,
    ) -> ExtractionRequest {
        ExtractionRequest {
            manifest_path: PathBuf::from(&backup.manifest_path),
            export_destination: root.join("exports").display().to_string(),
            python,
            script,
            audit_path: PathBuf::from(&backup.audit_log_path),
        }
    }

    #[test]
    fn detects_only_supported_profiles_and_exact_origin() {
        let root = test_root("detect");
        let candidate = fixture_candidate(&root);
        fs::create_dir_all(
            root.join(".config/google-chrome/Default/IndexedDB/http_other_5174.indexeddb.leveldb"),
        )
        .unwrap();
        fs::create_dir_all(root.join(
            ".config/google-chrome/Not A Profile/IndexedDB/http_localhost_5174.indexeddb.leveldb",
        ))
        .unwrap();
        let detected = detect_with_home(&root).unwrap();
        assert_eq!(detected.len(), 1);
        assert_eq!(detected[0].database_path, candidate.database_path);
        assert_eq!(detected[0].origin, ORIGIN_LABEL);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exact_path_validator_rejects_traversal_and_wrong_origin() {
        assert!(validate_relative_path(Path::new("leveldb/000001.ldb")).is_ok());
        assert!(validate_relative_path(Path::new("../Default/IndexedDB")).is_err());
        assert!(!is_origin_database_name(
            "http_localhost_5173.indexeddb.leveldb"
        ));
        assert!(!is_origin_database_name(
            "https_localhost_5174.indexeddb.leveldb"
        ));
        assert!(is_origin_database_name(
            "http_localhost_5174_0.indexeddb.leveldb"
        ));
    }

    #[test]
    fn detection_refuses_an_origin_symlink_that_escapes_the_profile() {
        let root = test_root("symlink");
        let indexed_db = root.join(".config/google-chrome/Default/IndexedDB");
        let outside = root.join("outside-origin");
        fs::create_dir_all(&indexed_db).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(
            &outside,
            indexed_db.join("http_localhost_5174.indexeddb.leveldb"),
        )
        .unwrap();
        assert!(detect_with_home(&root)
            .unwrap_err()
            .contains("outside the selected profile"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_an_active_browser_profile_from_its_live_lock_pid() {
        let root = test_root("running");
        fixture_candidate(&root);
        let browser_root = root.join(".config/google-chrome");
        std::os::unix::fs::symlink(
            format!("test-host-{}", std::process::id()),
            browser_root.join("SingletonLock"),
        )
        .unwrap();
        let detected = detect_with_home(&root).unwrap();
        assert!(detected[0].browser_running);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unrelated_default_browser_home_does_not_lock_another_profile_root() {
        let chrome = default_browser_root_from_environment(
            "/opt/google/chrome/google-chrome",
            b"USER=test\0HOME=/home/other-user\0",
        )
        .unwrap();
        assert_eq!(chrome, Path::new("/home/other-user/.config/google-chrome"));
        assert_ne!(
            chrome,
            Path::new("/tmp/recovery-fixture/.config/google-chrome")
        );
        let chromium = default_browser_root_from_environment(
            "/usr/lib/chromium/chromium",
            b"HOME=/home/chromium-user\0",
        )
        .unwrap();
        assert_eq!(chromium, Path::new("/home/chromium-user/.config/chromium"));
    }

    #[test]
    fn refuses_insufficient_space_before_copy() {
        let root = test_root("space");
        let mut candidate = fixture_candidate(&root);
        candidate.size_bytes = u64::MAX - BACKUP_HEADROOM_BYTES;
        let destination = root.join("backup");
        let error = create_backup(&candidate, &destination, &AtomicBool::new(false)).unwrap_err();
        assert!(error.contains("Insufficient backup space"));
        assert!(Path::new(&candidate.database_path).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_is_verified_and_interruption_preserves_source() {
        let root = test_root("backup");
        let candidate = fixture_candidate(&root);
        let destination = root.join("backup");
        let report = create_backup(&candidate, &destination, &AtomicBool::new(false)).unwrap();
        assert!(report.verified);
        assert!(
            verify_manifest(Path::new(&report.manifest_path), None)
                .unwrap()
                .valid
        );
        assert!(Path::new(&candidate.database_path).exists());

        let cancelled_destination = root.join("cancelled");
        let cancelled = AtomicBool::new(true);
        assert!(
            create_backup(&candidate, &cancelled_destination, &cancelled)
                .unwrap_err()
                .contains("cancelled")
        );
        assert!(Path::new(&candidate.database_path).exists());
        assert!(fs::read_dir(cancelled_destination)
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "partial")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extractor_reports_missing_python_and_missing_script() {
        let root = test_root("extract-missing-runtime");
        let backup = fixture_backup(&root);
        let emit = |_progress| {};
        let missing_python = extraction_request(
            &root,
            &backup,
            root.join("missing-python"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("recovery_tools/recover_indexeddb.py"),
        );
        assert!(
            run_recovery_extractor(missing_python, &AtomicBool::new(false), &emit)
                .unwrap_err()
                .contains("Python executable is missing")
        );

        let missing_script = extraction_request(
            &root,
            &backup,
            resolve_python_executable().unwrap(),
            root.join("missing-recovery-script.py"),
        );
        assert!(
            run_recovery_extractor(missing_script, &AtomicBool::new(false), &emit)
                .unwrap_err()
                .contains("recovery script is missing")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nonzero_extractor_exit_has_bounded_stderr_and_audit_details() {
        let root = test_root("extract-stderr");
        let backup = fixture_backup(&root);
        let script = root.join("fail-extractor.sh");
        fs::write(
            &script,
            "#!/bin/sh\ni=0\nwhile [ \"$i\" -lt 150000 ]; do printf x >&2; i=$((i + 1)); done\nexit 7\n",
        )
        .unwrap();
        let request = extraction_request(&root, &backup, PathBuf::from("/bin/sh"), script);
        let error =
            run_recovery_extractor(request, &AtomicBool::new(false), &|_progress| {}).unwrap_err();
        assert!(error.contains("exited with exit status: 7"));
        assert!(error.len() < 3_000);
        let audit = fs::read_to_string(&backup.audit_log_path).unwrap();
        assert!(audit.contains("output truncated after 131072 bytes"));
        assert!(audit.len() < 300_000);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verified_fixture_launches_real_extractor_and_emits_all_stages() {
        let root = test_root("extract-success");
        let candidate = fixture_candidate(&root);
        let fixture_path = Path::new(&candidate.database_path).join("recovery-fixture.ndjson");
        let payload = serde_json::json!({
            "projectName": "IPC Fixture",
            "canvasData": {"objects": [{"type": "rect", "fill": "blue"}]},
            "canvasSize": {"width": 800, "height": 600}
        });
        let rows = [
            serde_json::json!({
                "store": "projects", "key": "fixture-project", "seq": 1,
                "value": {"id": "fixture-project", "name": "IPC Fixture"}
            }),
            serde_json::json!({
                "store": "canvasData", "key": "fixture-canvas", "seq": 2,
                "value": {
                    "projectId": "fixture-project",
                    "jsonPayload": serde_json::to_string(&payload).unwrap()
                }
            }),
        ];
        fs::write(
            &fixture_path,
            rows.iter()
                .map(serde_json::Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let source_hash = sha256_file(&fixture_path, None).unwrap().1;
        let backup = create_backup(
            &candidate,
            &root.join("verified-backup"),
            &AtomicBool::new(false),
        )
        .unwrap();
        let phases = Mutex::new(Vec::new());
        let report = run_recovery_extractor(
            extraction_request(
                &root,
                &backup,
                resolve_python_executable().unwrap(),
                Path::new(env!("CARGO_MANIFEST_DIR")).join("recovery_tools/recover_indexeddb.py"),
            ),
            &AtomicBool::new(false),
            &|progress| {
                if let Some(phase) = progress.get("phase").and_then(|value| value.as_str()) {
                    phases.lock().unwrap().push(phase.to_string());
                }
            },
        )
        .unwrap();
        assert_eq!(report.projects_recovered, 1);
        assert!(Path::new(&report.report_path).is_file());
        assert_eq!(sha256_file(&fixture_path, None).unwrap().1, source_hash);
        let phases = phases.into_inner().unwrap();
        for expected in [
            "validate-backup",
            "launch-extractor",
            "scan-indexeddb",
            "validate-projects",
            "write-exports",
            "recovery-report",
        ] {
            assert!(phases.iter().any(|phase| phase == expected), "{expected}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_extraction_jobs_are_rejected_until_the_first_finishes() {
        let state = RecoveryJobs::default();
        register_extraction_job(&state, "extract-first").unwrap();
        assert!(register_extraction_job(&state, "extract-second")
            .unwrap_err()
            .contains("already running"));
        finish_extraction_job(&state, "extract-first");
        register_extraction_job(&state, "extract-retry").unwrap();
        finish_extraction_job(&state, "extract-retry");
    }

    #[test]
    fn deletion_requires_phrase_matching_backup_and_removes_only_origin() {
        let root = test_root("delete");
        let candidate = fixture_candidate(&root);
        let sibling = root
            .join(".config/google-chrome/Default/IndexedDB/https_example.com_0.indexeddb.leveldb");
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("keep.ldb"), b"keep").unwrap();
        let backup =
            create_backup(&candidate, &root.join("backup"), &AtomicBool::new(false)).unwrap();
        assert!(
            cleanup_candidate(&candidate, Path::new(&backup.manifest_path), "DELETE")
                .unwrap_err()
                .contains("exact confirmation")
        );
        assert!(Path::new(&candidate.database_path).exists());
        let cleanup = cleanup_candidate(
            &candidate,
            Path::new(&backup.manifest_path),
            DELETE_CONFIRMATION,
        )
        .unwrap();
        assert!(cleanup.source_absent);
        assert!(sibling.exists());
        assert!(Path::new(&backup.backup_path).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tampered_backup_fails_verification_and_blocks_deletion() {
        let root = test_root("tamper");
        let candidate = fixture_candidate(&root);
        let backup =
            create_backup(&candidate, &root.join("backup"), &AtomicBool::new(false)).unwrap();
        fs::write(
            Path::new(&backup.backup_path).join("source/leveldb/000001.ldb"),
            b"tampered",
        )
        .unwrap();
        assert!(verify_manifest(Path::new(&backup.manifest_path), None)
            .unwrap_err()
            .contains("verification failed"));
        assert!(cleanup_candidate(
            &candidate,
            Path::new(&backup.manifest_path),
            DELETE_CONFIRMATION
        )
        .unwrap_err()
        .contains("verification failed"));
        assert!(Path::new(&candidate.database_path).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
