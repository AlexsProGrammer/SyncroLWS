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
