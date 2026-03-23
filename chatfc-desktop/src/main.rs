#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_updater::UpdaterExt;

const UPDATE_ENDPOINT_ENV: &str = "CHATFC_UPDATER_ENDPOINT";
const UPDATE_PUBKEY_ENV: &str = "CHATFC_UPDATER_PUBKEY";
const BUILD_UPDATE_ENDPOINT: Option<&str> = option_env!("CHATFC_UPDATER_ENDPOINT");
const BUILD_UPDATE_PUBKEY: Option<&str> = option_env!("CHATFC_UPDATER_PUBKEY");

fn read_required_build_var(key: &str, value: Option<&str>) -> Option<String> {
  match value {
    Some(value) if !value.trim().is_empty() => Some(value.to_string()),
    _ => {
      eprintln!("[updater] build var {key} is empty or undefined.");
      None
    }
  }
}

fn spawn_startup_update_check(app: &tauri::AppHandle) {
  let app_handle = app.clone();

  tauri::async_runtime::spawn(async move {
    if let Err(err) = check_and_install_update(app_handle).await {
      eprintln!("[updater] startup update check failed: {err}");
    }
  });
}

async fn check_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
  let Some(endpoint) = read_required_build_var(UPDATE_ENDPOINT_ENV, BUILD_UPDATE_ENDPOINT) else {
    eprintln!(
      "[updater] disabled: missing build var {UPDATE_ENDPOINT_ENV}. Startup update check skipped."
    );
    return Ok(());
  };

  let Some(pubkey) = read_required_build_var(UPDATE_PUBKEY_ENV, BUILD_UPDATE_PUBKEY) else {
    eprintln!(
      "[updater] disabled: missing build var {UPDATE_PUBKEY_ENV}. Startup update check skipped."
    );
    return Ok(());
  };

  let endpoint_url = endpoint
    .parse()
    .map_err(|err| format!("invalid updater endpoint URL: {err}"))?;

  let updater_builder = app
    .updater_builder()
    .pubkey(pubkey)
    .endpoints(vec![endpoint_url])
    .map_err(|err| format!("failed to configure updater endpoints: {err}"))?;

  let updater = updater_builder
    .build()
    .map_err(|err| format!("failed to build updater: {err}"))?;

  let Some(update) = updater
    .check()
    .await
    .map_err(|err| format!("failed to check for updates: {err}"))?
  else {
    return Ok(());
  };

  eprintln!(
    "[updater] update found: {} -> {}",
    update.current_version, update.version
  );

  update
    .download_and_install(|_, _| {}, || {})
    .await
    .map_err(|err| format!("failed to download/install update: {err}"))?;

  eprintln!("[updater] update installed. Restarting app...");
  app.restart();
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      spawn_startup_update_check(app.handle());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
