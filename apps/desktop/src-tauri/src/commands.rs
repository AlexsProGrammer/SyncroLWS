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
/// Frontend: `invoke('get_active_window')`
#[tauri::command]
pub fn get_active_window() -> Result<String, String> {
    get_active_window_impl()
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
