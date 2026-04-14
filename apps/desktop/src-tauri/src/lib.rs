use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

// ── Window Tracker ────────────────────────────────────────────────────────────

/// Returns the title of the currently focused OS window.
/// Implementation is platform-specific; Linux uses `xdotool`, macOS uses
/// AppleScript, Windows uses the Win32 API (future implementation).
#[tauri::command]
pub fn get_active_window() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let output = Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
            .map_err(|e| e.to_string())?;
        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(title);
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let script = r#"tell application "System Events" to get name of first process whose frontmost is true"#;
        let output = Command::new("osascript")
            .args(["-e", script])
            .output()
            .map_err(|e| e.to_string())?;
        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(title);
    }

    #[cfg(target_os = "windows")]
    {
        // TODO: implement via winapi GetForegroundWindow + GetWindowText
        return Ok(String::from("(Windows window tracking not yet implemented)"));
    }

    #[allow(unreachable_code)]
    Ok(String::new())
}

// ── Deep Links ────────────────────────────────────────────────────────────────

pub fn setup_deep_links(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            let path = url.path().to_string();
            let params: std::collections::HashMap<String, String> = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();

            // Emit to all frontend windows
            if let Err(e) = handle.emit("deeplink://received", serde_json::json!({ "path": path, "params": params })) {
                eprintln!("[deep-link] failed to emit event: {e}");
            }

            println!("[deep-link] received: path={path}");
        }
    });
}

// ── App Setup ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Register the custom URI scheme handler
            setup_deep_links(&app.handle().clone());

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_active_window])
        .run(tauri::generate_context!())
        .expect("error while running SyncroLWS");
}
