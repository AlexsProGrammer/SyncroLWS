use tauri::Manager;

// ── Platform helpers ──────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn get_active_window_impl() -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("xdotool")
        .args(["getactivewindow", "getwindowname"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn get_active_window_impl() -> Result<String, String> {
    use std::process::Command;
    let script =
        r#"tell application "System Events" to get name of first process whose frontmost is true"#;
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn get_active_window_impl() -> Result<String, String> {
    Ok(String::from(
        "(window tracking not implemented for this platform)",
    ))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns the title of the currently focused OS window.
/// Runs the subprocess on a blocking thread so it doesn't block the IPC channel.
/// Frontend: `invoke('get_active_window')`
#[tauri::command]
pub async fn get_active_window() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(get_active_window_impl)
        .await
        .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

/// Validates a UUID string (loose: 36 chars, hex digits + hyphens).
fn validate_uuid(uuid: &str) -> Result<(), String> {
    if uuid.len() != 36
        || uuid
            .chars()
            .any(|c| !c.is_ascii_hexdigit() && c != '-')
    {
        return Err(format!("Invalid UUID format: {uuid}"));
    }
    Ok(())
}

/// Creates the profile directory structure at `<app_data>/profiles/<uuid>/files/`.
/// Returns the absolute path to the profile root (`<app_data>/profiles/<uuid>`).
/// Frontend: `invoke('create_profile_folder', { uuid: '...' })`
#[tauri::command]
pub fn create_profile_folder(app: tauri::AppHandle, uuid: String) -> Result<String, String> {
    validate_uuid(&uuid)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let profile_dir = app_data.join("profiles").join(&uuid);
    let files_dir = profile_dir.join("files");

    std::fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create profile folder: {e}"))?;

    let profile_path = profile_dir
        .to_str()
        .ok_or_else(|| "Profile path contains non-UTF8 characters".to_string())?
        .to_string();

    println!("[profile] created folder: {profile_path}");
    Ok(profile_path)
}

/// Returns the absolute path to `<app_data>/profiles/<uuid>` WITHOUT creating it.
/// Used by the frontend to build the SQLite connection string.
/// Frontend: `invoke('get_profile_path', { uuid: '...' })`
#[tauri::command]
pub fn get_profile_path(app: tauri::AppHandle, uuid: String) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let profile_dir = app_data.join("profiles").join(&uuid);

    profile_dir
        .to_str()
        .ok_or_else(|| "Profile path contains non-UTF8 characters".to_string())
        .map(|s: &str| s.to_string())
}

/// Creates the workspace directory structure at
/// `<app_data>/profiles/<profile_uuid>/workspaces/<workspace_uuid>/files/`.
/// Returns the absolute path to the workspace root.
/// Frontend: `invoke('create_workspace_folder', { profileUuid: '...', workspaceUuid: '...' })`
#[tauri::command]
pub fn create_workspace_folder(
    app: tauri::AppHandle,
    profile_uuid: String,
    workspace_uuid: String,
) -> Result<String, String> {
    validate_uuid(&profile_uuid)?;
    validate_uuid(&workspace_uuid)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let workspace_dir = app_data
        .join("profiles")
        .join(&profile_uuid)
        .join("workspaces")
        .join(&workspace_uuid);
    let files_dir = workspace_dir.join("files");

    std::fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create workspace folder: {e}"))?;

    let workspace_path = workspace_dir
        .to_str()
        .ok_or_else(|| "Workspace path contains non-UTF8 characters".to_string())?
        .to_string();

    println!("[workspace] created folder: {workspace_path}");
    Ok(workspace_path)
}

/// Returns the absolute path to a workspace directory WITHOUT creating it.
/// Frontend: `invoke('get_workspace_path', { profileUuid: '...', workspaceUuid: '...' })`
#[tauri::command]
pub fn get_workspace_path(
    app: tauri::AppHandle,
    profile_uuid: String,
    workspace_uuid: String,
) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let workspace_dir = app_data
        .join("profiles")
        .join(&profile_uuid)
        .join("workspaces")
        .join(&workspace_uuid);

    workspace_dir
        .to_str()
        .ok_or_else(|| "Workspace path contains non-UTF8 characters".to_string())
        .map(|s: &str| s.to_string())
}

// ── Workspace transfer helpers ────────────────────────────────────────────────

/// Recursively copies all files from `src_dir` into `dst_dir`, creating
/// intermediate directories as needed. Only copies leaf files (no subdirectory
/// recursion beyond one level, matching the `files/` flat layout).
fn copy_dir_all(src_dir: &std::path::Path, dst_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst_dir)
        .map_err(|e| format!("Failed to create dir {}: {e}", dst_dir.display()))?;

    for entry in std::fs::read_dir(src_dir)
        .map_err(|e| format!("Failed to read dir {}: {e}", src_dir.display()))?
    {
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to get file type: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst_dir.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "Failed to copy {} → {}: {e}",
                    src_path.display(),
                    dst_path.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Copies a workspace's SQLite database and all associated files from one
/// profile to another (or within the same profile for a duplicate).
///
/// Steps:
///   1. Create `<dst_profile>/workspaces/<dst_workspace>/files/`
///   2. Copy `data.sqlite` from src to dst
///   3. Copy every file inside `src/files/` to `dst/files/`
///
/// Frontend: `invoke('copy_workspace_data', { srcProfileUuid, srcWorkspaceUuid, dstProfileUuid, dstWorkspaceUuid })`
#[tauri::command]
pub fn copy_workspace_data(
    app: tauri::AppHandle,
    src_profile_uuid: String,
    src_workspace_uuid: String,
    dst_profile_uuid: String,
    dst_workspace_uuid: String,
) -> Result<(), String> {
    validate_uuid(&src_profile_uuid)?;
    validate_uuid(&src_workspace_uuid)?;
    validate_uuid(&dst_profile_uuid)?;
    validate_uuid(&dst_workspace_uuid)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let src_dir = app_data
        .join("profiles")
        .join(&src_profile_uuid)
        .join("workspaces")
        .join(&src_workspace_uuid);

    let dst_dir = app_data
        .join("profiles")
        .join(&dst_profile_uuid)
        .join("workspaces")
        .join(&dst_workspace_uuid);

    // 1. Ensure destination workspace folder (+ files/) exists
    std::fs::create_dir_all(dst_dir.join("files"))
        .map_err(|e| format!("Failed to create destination workspace folder: {e}"))?;

    // 2. Copy the SQLite database
    let src_db = src_dir.join("data.sqlite");
    let dst_db = dst_dir.join("data.sqlite");
    if src_db.exists() {
        std::fs::copy(&src_db, &dst_db).map_err(|e| {
            format!(
                "Failed to copy data.sqlite ({} → {}): {e}",
                src_db.display(),
                dst_db.display()
            )
        })?;
    }

    // 3. Copy uploaded/local files
    let src_files = src_dir.join("files");
    let dst_files = dst_dir.join("files");
    if src_files.exists() {
        copy_dir_all(&src_files, &dst_files)?;
    }

    println!(
        "[workspace] copied {}/{} → {}/{}",
        src_profile_uuid, src_workspace_uuid, dst_profile_uuid, dst_workspace_uuid
    );
    Ok(())
}
