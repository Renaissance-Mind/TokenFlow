#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex as AsyncMutex},
};

type Result<T> = std::result::Result<T, String>;
type Waiter = oneshot::Sender<Result<Value>>;
struct Runtime {
    input: AsyncMutex<Option<ChildStdin>>,
    child: AsyncMutex<Option<Child>>,
    waiters: AsyncMutex<HashMap<u64, Waiter>>,
    sequence: AtomicU64,
    state: Mutex<Value>,
    quitting: AtomicBool,
    dashboard_ready: AtomicBool,
    http: reqwest::Client,
    data: PathBuf,
    secret_service: String,
    sidecar: PathBuf,
    updater: AsyncMutex<Option<tauri_plugin_updater::Update>>,
    downloaded: AsyncMutex<Option<Vec<u8>>>,
}
fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {key}"))
}
fn local(window: &WebviewWindow) -> bool {
    if !["main", "tray"].contains(&window.label()) {
        return false;
    }
    match window.url() {
        Ok(url) => {
            url.scheme() == "tauri"
                || (url.host_str() == Some("tauri.localhost")
                    && ["http", "https"].contains(&url.scheme()))
        }
        Err(_) => false,
    }
}
fn sidecar_path() -> Result<PathBuf> {
    let exe = std::env::current_exe().map_err(message)?;
    let name = if cfg!(windows) {
        "tokenflow-collector.exe"
    } else {
        "tokenflow-collector"
    };
    let adjacent = exe.parent().ok_or("Application path missing")?.join(name);
    if adjacent.is_file() {
        return Ok(adjacent);
    }
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "tokenflow-collector-{}{suffix}",
            env!("TOKENFLOW_TARGET")
        ));
    if development.is_file() {
        return Ok(development);
    }
    Err("The bundled collector is missing. Reinstall TokenFlow.".into())
}
impl Runtime {
    async fn send(&self, value: Value) -> Result<()> {
        let mut input = self.input.lock().await;
        let writer = input.as_mut().ok_or("Collector is not running")?;
        writer
            .write_all((value.to_string() + "\n").as_bytes())
            .await
            .map_err(message)?;
        writer.flush().await.map_err(message)
    }
    async fn call(&self, action: &str, payload: Value) -> Result<Value> {
        let id = self.sequence.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.waiters.lock().await.insert(id, sender);
        if let Err(error) = self
            .send(json!({"type":"call","id":id,"action":action,"payload":payload}))
            .await
        {
            self.waiters.lock().await.remove(&id);
            return Err(error);
        }
        receiver
            .await
            .map_err(|_| "Collector stopped before completing the operation".to_string())?
    }
    fn key(&self, name: &str) -> Result<keyring::Entry> {
        if !["authorization", "pending"].contains(&name) {
            return Err("Invalid credential name".into());
        }
        keyring::Entry::new(&self.secret_service, name).map_err(message)
    }
    fn secret(&self, name: &str) -> Result<Option<String>> {
        match self.key(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(message(error)),
        }
    }
    fn delete_secret(&self, name: &str) -> Result<()> {
        match self.key(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(message(error)),
        }
    }
}
fn show_local(app: &tauri::AppHandle) -> Result<()> {
    if let Some(tray) = app.get_webview_window("tray") {
        tray.hide().map_err(message)?;
    }
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(message)?;
        window.set_focus().map_err(message)?;
    }
    Ok(())
}
fn show_dashboard(app: &tauri::AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("dashboard") {
        if let Some(local) = app.get_webview_window("main") {
            local.hide().map_err(message)?;
        }
        if let Some(panel) = app.get_webview_window("tray") {
            panel.hide().map_err(message)?;
        }
        window.show().map_err(message)?;
        window.set_focus().map_err(message)?;
    } else {
        show_local(app)?;
    }
    Ok(())
}
fn toggle_tray(app: &tauri::AppHandle) -> Result<()> {
    let panel = app
        .get_webview_window("tray")
        .ok_or("Status panel missing")?;
    if panel.is_visible().map_err(message)? {
        panel.hide().map_err(message)?;
        return Ok(());
    }
    if let Some(icon) = app.tray_by_id("tokenflow") {
        if let Some(bounds) = icon.rect().map_err(message)? {
            let scale = panel.scale_factor().map_err(message)?;
            let point = bounds.position.to_physical::<f64>(scale);
            let size = bounds.size.to_physical::<f64>(scale);
            let monitor = panel
                .current_monitor()
                .map_err(message)?
                .or(panel.primary_monitor().map_err(message)?);
            if let Some(monitor) = monitor {
                let area = monitor.work_area();
                let width = 380.0 * scale;
                let height = 520.0 * scale;
                let x = (point.x + size.width / 2.0 - width / 2.0)
                    .max(area.position.x as f64)
                    .min(
                        (area.position.x as f64 + area.size.width as f64 - width)
                            .max(area.position.x as f64),
                    );
                let y = if point.y < area.position.y as f64 + area.size.height as f64 / 2.0 {
                    point.y + size.height + 6.0 * scale
                } else {
                    point.y - height - 6.0 * scale
                };
                panel
                    .set_position(tauri::PhysicalPosition::new(
                        x,
                        y.max(area.position.y as f64),
                    ))
                    .map_err(message)?;
            }
        }
    }
    panel.show().map_err(message)?;
    panel.set_focus().map_err(message)
}
fn update_state(app: &tauri::AppHandle, runtime: &Runtime, value: Value) {
    *runtime.state.lock().unwrap() = value.clone();
    for label in ["main", "tray"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.emit("tokenflow:changed", &value);
        }
    }
    if let Some(tray) = app.tray_by_id("tokenflow") {
        let empty = Value::Null;
        let today = if value["summary"]["today"]["date"] == value["localDate"] {
            &value["summary"]["today"]
        } else {
            &empty
        };
        let cost = today["costUsd"]
            .as_f64()
            .map(|value| format!("${value:.2}"))
            .unwrap_or_else(|| "—".into());
        let tokens = today["tokens"]
            .as_u64()
            .map(|value| {
                if value >= 1_000_000 {
                    format!("{:.1}M", value as f64 / 1_000_000.0)
                } else if value >= 1000 {
                    format!("{:.1}K", value as f64 / 1000.0)
                } else {
                    value.to_string()
                }
            })
            .unwrap_or_else(|| "—".into());
        let title = match value["settings"]["trayMetric"].as_str().unwrap_or("cost") {
            "tokens" => tokens.clone(),
            "icon" => String::new(),
            _ => cost.clone(),
        };
        let _ = tray.set_title(Some(title));
        let _ = tray.set_tooltip(Some(format!("TokenFlow · {cost} · {tokens} tokens")));
    }
}
async fn http(runtime: &Runtime, payload: &Value) -> Result<Value> {
    let url = url::Url::parse(text(payload, "url")?).map_err(message)?;
    let loopback = ["localhost", "127.0.0.1", "::1"].contains(&url.host_str().unwrap_or(""));
    if !url.username().is_empty()
        || url.password().is_some()
        || (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
    {
        return Err("Unsafe server address".into());
    }
    let method =
        reqwest::Method::from_bytes(text(payload, "method")?.as_bytes()).map_err(message)?;
    let mut request = runtime.http.request(method, url);
    if let Some(headers) = payload["headers"].as_object() {
        for (name, value) in headers {
            request = request.header(name, value.as_str().ok_or("Invalid HTTP header")?);
        }
    }
    if let Some(body) = payload["body"].as_str() {
        request = request.body(body.to_string());
    }
    let response = request.send().await.map_err(message)?;
    let status = response.status().as_u16();
    let headers: HashMap<String, String> = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    Ok(json!({"status":status,"headers":headers,"body":response.text().await.map_err(message)?}))
}
async fn set_session(app: &tauri::AppHandle, runtime: &Runtime, payload: &Value) -> Result<Value> {
    let server = url::Url::parse(text(payload, "server")?).map_err(message)?;
    let token = text(payload, "token")?;
    if !token.starts_with("tu_sess_") {
        return Err("Invalid dashboard session".into());
    }
    if app.get_webview_window("dashboard").is_none() {
        let ready = app.state::<Arc<Runtime>>().inner().clone();
        let origin = server.origin().ascii_serialization();
        let handle = app.clone();
        WebviewWindowBuilder::new(
            app,
            "dashboard",
            WebviewUrl::External("about:blank".parse().map_err(message)?),
        )
        .title("TokenFlow Dashboard")
        .inner_size(1440.0, 960.0)
        .min_inner_size(800.0, 640.0)
        .visible(false)
        .data_directory(runtime.data.join("webview"))
        .on_page_load(move |_,event|{if event.event()==tauri::webview::PageLoadEvent::Finished && event.url().path()=="/dashboard" {ready.dashboard_ready.store(true,Ordering::SeqCst);}})
        .initialization_script("document.addEventListener('click', event => { const button=event.target.closest?.('[onclick=\"logout()\"]'); if(button){event.preventDefault();event.stopImmediatePropagation();location.href='tokenflow://logout';} }, true);")
        .on_navigation(move |url| {
            if url.as_str() == "tokenflow://logout" || (url.origin().ascii_serialization() == origin && url.path() == "/") {
                let logout=url.as_str() == "tokenflow://logout";
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let runtime = app.state::<Arc<Runtime>>();
                    let _ = runtime.call(if logout {"logout"}else{"dashboard-expired"}, Value::Null).await;
                });
                return false;
            }
            if url.as_str() == "about:blank"
                || (url.origin().ascii_serialization() == origin
                    && !url.path().starts_with("/auth/"))
            {
                true
            } else {
                if ["http", "https"].contains(&url.scheme()) {
                    let _ = handle.opener().open_url(url.to_string(), None::<&str>);
                }
                false
            }
        })
        .build()
        .map_err(message)?;
    }
    let window = app
        .get_webview_window("dashboard")
        .ok_or("Dashboard missing")?;
    let expires = time::OffsetDateTime::parse(
        text(payload, "expiresAt")?,
        &time::format_description::well_known::Rfc3339,
    )
    .map_err(message)?;
    let mut cookie = cookie::Cookie::build(("tu_session", token.to_string()))
        .domain(
            server
                .host_str()
                .ok_or("Server hostname missing")?
                .to_string(),
        )
        .path("/")
        .http_only(true)
        .same_site(cookie::SameSite::Lax)
        .expires(expires)
        .build();
    // WebKit treats the presence of NSHTTPCookieSecure as secure, including FALSE.
    if server.scheme() == "https" {
        cookie.set_secure(true);
    }
    window.set_cookie(cookie).map_err(message)?;
    let me = runtime
        .http
        .get(server.join("/api/me").map_err(message)?)
        .header("Cookie", format!("tu_session={token}"))
        .send()
        .await
        .map_err(message)?;
    if !me.status().is_success() {
        return Err("Dashboard authorization failed".into());
    }
    let user = me.json::<Value>().await.map_err(message)?;
    runtime.dashboard_ready.store(false, Ordering::SeqCst);
    window
        .navigate(server.join("/dashboard").map_err(message)?)
        .map_err(message)?;
    if payload["open"].as_bool().unwrap_or(false) {
        show_dashboard(app)?;
    }
    Ok(user)
}
async fn update(app: &tauri::AppHandle, runtime: &Runtime, payload: &Value) -> Result<Value> {
    match text(payload, "action")? {
        "check" => {
            let response = runtime
                .http
                .get("https://api.github.com/repos/Renaissance-Mind/TokenFlow/releases?per_page=50")
                .header("User-Agent", "TokenFlow Desktop")
                .send()
                .await
                .map_err(message)?;
            if !response.status().is_success() {
                return Err(format!("Update service returned {}", response.status()));
            }
            let releases = response.json::<Vec<Value>>().await.map_err(message)?;
            let release = releases.iter().find(|value| {
                !value["draft"].as_bool().unwrap_or(true)
                    && !value["prerelease"].as_bool().unwrap_or(true)
                    && value["tag_name"]
                        .as_str()
                        .map(|name| name.starts_with("desktop-v"))
                        .unwrap_or(false)
                    && value["assets"]
                        .as_array()
                        .map(|assets| {
                            assets
                                .iter()
                                .any(|asset| asset["name"].as_str() == Some("latest.json"))
                        })
                        .unwrap_or(false)
            });
            let Some(release) = release else {
                return Ok(
                    json!({"status":"current","message":"No Tauri desktop update has been published yet."}),
                );
            };
            let endpoint = release["assets"]
                .as_array()
                .unwrap()
                .iter()
                .find(|asset| asset["name"].as_str() == Some("latest.json"))
                .and_then(|value| value["browser_download_url"].as_str())
                .ok_or("Update manifest missing")?
                .parse()
                .map_err(message)?;
            let found = app
                .updater_builder()
                .endpoints(vec![endpoint])
                .map_err(message)?
                .build()
                .map_err(message)?
                .check()
                .await
                .map_err(message)?;
            if let Some(found) = found {
                let version = found.version.clone();
                *runtime.updater.lock().await = Some(found);
                Ok(json!({"status":"available","version":version}))
            } else {
                Ok(json!({"status":"current"}))
            }
        }
        "download" => {
            let guard = runtime.updater.lock().await;
            let update = guard.as_ref().ok_or("Check for an update first")?;
            let bytes = update.download(|_, _| {}, || {}).await.map_err(message)?;
            *runtime.downloaded.lock().await = Some(bytes);
            Ok(json!({"status":"downloaded","version":update.version}))
        }
        "install" => {
            let guard = runtime.updater.lock().await;
            let update = guard.as_ref().ok_or("Update missing")?;
            let bytes = runtime
                .downloaded
                .lock()
                .await
                .take()
                .ok_or("Download the update first")?;
            update.install(bytes).map_err(message)?;
            runtime.quitting.store(true, Ordering::SeqCst);
            let _ = runtime.call("shutdown", Value::Null).await;
            app.restart();
        }
        _ => Err("Unknown update action".into()),
    }
}
async fn native(
    app: &tauri::AppHandle,
    runtime: &Runtime,
    action: &str,
    payload: &Value,
) -> Result<Value> {
    match action {
        "http" => http(runtime, payload).await,
        "secret_get" => Ok(json!(runtime.secret(text(payload, "name")?)?)),
        "secret_set" => {
            runtime
                .key(text(payload, "name")?)?
                .set_password(text(payload, "value")?)
                .map_err(message)?;
            Ok(Value::Null)
        }
        "secret_delete" => {
            runtime.delete_secret(text(payload, "name")?)?;
            Ok(Value::Null)
        }
        "secret_commit" => {
            let value = runtime
                .secret("pending")?
                .ok_or("Pending authorization missing")?;
            runtime
                .key("authorization")?
                .set_password(&value)
                .map_err(message)?;
            runtime.delete_secret("pending")?;
            Ok(Value::Null)
        }
        "secret_clear" => {
            runtime.delete_secret("authorization")?;
            runtime.delete_secret("pending")?;
            Ok(Value::Null)
        }
        "open_url" => {
            let url = url::Url::parse(text(payload, "url")?).map_err(message)?;
            if !["http", "https"].contains(&url.scheme()) {
                return Err("Invalid browser URL".into());
            }
            app.opener()
                .open_url(url.to_string(), None::<&str>)
                .map_err(message)?;
            Ok(Value::Null)
        }
        "session" => set_session(app, runtime, payload).await,
        "clear_session" => {
            if let Some(window) = app.get_webview_window("dashboard") {
                window.clear_all_browsing_data().map_err(message)?;
                window.destroy().map_err(message)?;
            }
            Ok(Value::Null)
        }
        "show_local" => {
            show_local(app)?;
            Ok(Value::Null)
        }
        "show_dashboard" => {
            show_dashboard(app)?;
            Ok(Value::Null)
        }
        "autostart" => {
            if !payload["isolated"].as_bool().unwrap_or(false)
                || std::env::var("TOKENFLOW_SYSTEM_TEST").as_deref() == Ok("1")
            {
                if payload["enabled"].as_bool().unwrap_or(false) {
                    app.autolaunch().enable().map_err(message)?;
                } else {
                    app.autolaunch().disable().map_err(message)?;
                }
            }
            Ok(Value::Null)
        }
        "update" => update(app, runtime, payload).await,
        _ => Err("Unknown native operation".into()),
    }
}
#[tauri::command]
async fn bridge(
    window: WebviewWindow,
    runtime: tauri::State<'_, Arc<Runtime>>,
    action: String,
    payload: Value,
) -> Result<Value> {
    if !local(&window) {
        return Err("Untrusted desktop request".into());
    }
    runtime.call(&action, payload).await
}
#[tauri::command]
async fn acceptance_probe(
    window: WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<Runtime>>,
    action: String,
    payload: Value,
) -> Result<Value> {
    if !local(&window) || std::env::var("TOKENFLOW_ACCEPTANCE_REPORT").is_err() {
        return Err("Acceptance mode is disabled".into());
    }
    match action.as_str() {
        "progress" => {
            let file = std::env::var("TOKENFLOW_ACCEPTANCE_REPORT").unwrap() + ".progress";
            tokio::fs::write(file, payload.to_string())
                .await
                .map_err(message)?;
            Ok(Value::Null)
        }
        "tray" => {
            toggle_tray(&app)?;
            let panel = app.get_webview_window("tray").ok_or("Tray missing")?;
            let visible = panel.is_visible().map_err(message)?;
            panel.hide().map_err(message)?;
            let main = app
                .get_webview_window("main")
                .ok_or("Main window missing")?;
            main.close().map_err(message)?;
            tokio::time::sleep(Duration::from_millis(200)).await;
            let hidden = !main.is_visible().map_err(message)?;
            show_local(&app)?;
            Ok(json!({"visible":visible,"closeHides":hidden}))
        }
        "startup" => Ok(json!(app.autolaunch().is_enabled().map_err(message)?)),
        "stage_recovery" => {
            let value = runtime
                .secret("authorization")?
                .ok_or("Authorization missing")?;
            runtime
                .key("pending")?
                .set_password(&value)
                .map_err(message)?;
            runtime.delete_secret("authorization")?;
            Ok(Value::Null)
        }
        "headless" => {
            let home = std::env::var("TOKENFLOW_HOME").map_err(message)?;
            let marker = PathBuf::from(home).join("desktop-agent.json");
            let before: Value =
                serde_json::from_slice(&tokio::fs::read(&marker).await.map_err(message)?)
                    .map_err(message)?;
            let status = Command::new(std::env::current_exe().map_err(message)?)
                .arg("--collector-sync")
                .status()
                .await
                .map_err(message)?;
            let after: Value =
                serde_json::from_slice(&tokio::fs::read(marker).await.map_err(message)?)
                    .map_err(message)?;
            Ok(json!({"success":status.success(),"ownerPreserved":before["pid"]==after["pid"]}))
        }
        "dashboard_logout" => {
            app.get_webview_window("dashboard")
                .ok_or("Dashboard missing")?
                .eval("document.querySelector('[onclick=\"logout()\"]')?.click();")
                .map_err(message)?;
            Ok(Value::Null)
        }
        "dashboard" => {
            if !runtime.dashboard_ready.load(Ordering::SeqCst) {
                return Ok(json!({"httpOnly":false,"page":{"ready":false}}));
            }
            let dashboard = app
                .get_webview_window("dashboard")
                .ok_or("Dashboard missing")?;
            if local(&dashboard) {
                return Err("Remote dashboard has local privileges".into());
            }
            let cookies = dashboard.cookies().map_err(message)?;
            let private = cookies
                .iter()
                .any(|cookie| cookie.name() == "tu_session" && cookie.http_only() == Some(true));
            let (sender, receiver) = oneshot::channel();
            let sender = Mutex::new(Some(sender));
            dashboard.eval_with_callback("if(!window.__ipcDenied){window.__ipcDenied='pending';if(window.__TAURI__?.core){window.__TAURI__.core.invoke('bridge',{action:'state',payload:null}).then(()=>window.__ipcDenied='allowed',()=>window.__ipcDenied='denied');}else{window.__ipcDenied='unavailable';}}JSON.stringify({ipc:window.__ipcDenied,location:location.href,localBridge:typeof window.tokenflow,ready:!!document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')})",move |value|{if let Some(sender)=sender.lock().unwrap().take(){let _=sender.send(value);}}).map_err(message)?;
            let value = tokio::time::timeout(Duration::from_secs(10), receiver)
                .await
                .map_err(message)?
                .map_err(message)?;
            let mut proof: Value = serde_json::from_str(&value).map_err(message)?;
            if let Some(value) = proof.as_str() {
                proof = serde_json::from_str(value).map_err(message)?;
            }
            Ok(json!({"httpOnly":private,"page":proof}))
        }
        _ => Err("Unknown acceptance probe".into()),
    }
}
#[tauri::command]
async fn acceptance_report(
    window: WebviewWindow,
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<Runtime>>,
    report: Value,
) -> Result<()> {
    if !local(&window) {
        return Err("Untrusted desktop request".into());
    }
    let path = std::env::var("TOKENFLOW_ACCEPTANCE_REPORT")
        .map_err(|_| "Acceptance mode is disabled".to_string())?;
    tokio::fs::write(path, report.to_string())
        .await
        .map_err(message)?;
    runtime.quitting.store(true, Ordering::SeqCst);
    let _ = runtime.call("shutdown", Value::Null).await;
    app.exit(if report["ok"].as_bool() == Some(true) {
        0
    } else {
        1
    });
    Ok(())
}
async fn start(
    app: tauri::AppHandle,
    runtime: Arc<Runtime>,
    headless: bool,
    background: bool,
) -> Result<()> {
    let mut child = Command::new(&runtime.sidecar)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(message)?;
    let output = child.stdout.take().ok_or("Collector output missing")?;
    *runtime.input.lock().await = child.stdin.take();
    *runtime.child.lock().await = Some(child);
    let (ready_sender, ready_receiver) = oneshot::channel();
    let mut ready = Some(ready_sender);
    let handle = app.clone();
    let state = runtime.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(output).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let value = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Invalid collector response: {error}");
                    continue;
                }
            };
            match value["type"].as_str() {
                Some("ready") => {
                    if let Some(sender) = ready.take() {
                        let _ = sender.send(());
                    }
                }
                Some("state") => update_state(&handle, &state, value["state"].clone()),
                Some("reply") => {
                    if let Some(id) = value["id"].as_u64() {
                        if let Some(sender) = state.waiters.lock().await.remove(&id) {
                            let _ = sender.send(if let Some(error) = value["error"].as_str() {
                                Err(error.into())
                            } else {
                                Ok(value["result"].clone())
                            });
                        }
                    }
                }
                Some("native") => {
                    let app = handle.clone();
                    let service = state.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = native(
                            &app,
                            &service,
                            value["action"].as_str().unwrap_or(""),
                            &value["payload"],
                        )
                        .await;
                        let reply = match result {
                            Ok(result) => {
                                json!({"type":"native_reply","id":value["id"],"result":result})
                            }
                            Err(error) => {
                                json!({"type":"native_reply","id":value["id"],"error":error})
                            }
                        };
                        let _ = service.send(reply).await;
                    });
                }
                _ => {}
            }
        }
        for (_, sender) in state.waiters.lock().await.drain() {
            let _ = sender.send(Err("Collector stopped unexpectedly".into()));
        }
    });
    tokio::time::timeout(Duration::from_secs(30), ready_receiver)
        .await
        .map_err(message)?
        .map_err(message)?;
    let result=runtime.call("init",json!({"version":app.package_info().version.to_string(),"collectorVersion":include_str!("../../../package.json").parse::<Value>().map_err(message)?["version"],"appData":runtime.data,"executable":std::env::current_exe().map_err(message)?,"isolated":std::env::var("TOKENFLOW_DESKTOP_DATA").is_ok(),"language":std::env::var("LANG").unwrap_or_else(|_|"en".into()),"pid":std::process::id(),"background":background,"headless":headless})).await?;
    update_state(&app, &runtime, result);
    if headless {
        runtime.quitting.store(true, Ordering::SeqCst);
        app.exit(0);
    }
    Ok(())
}
fn main() {
    let headless = std::env::args().any(|value| value == "--collector-sync");
    let background = std::env::args().any(|value| value == "--background") || headless;
    let autostart = tauri_plugin_autostart::Builder::new().args(["--background"]);
    #[cfg(target_os = "macos")]
    let autostart = autostart.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(autostart.build())
        .plugin(tauri_plugin_updater::Builder::new().build());
    if !headless {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = show_local(app);
        }));
    }
    builder.invoke_handler(tauri::generate_handler![bridge,acceptance_report,acceptance_probe]).setup(move |app|{
        #[cfg(target_os="macos")]
        if headless {app.set_activation_policy(tauri::ActivationPolicy::Prohibited);}
        let data=std::env::var("TOKENFLOW_DESKTOP_DATA").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);std::fs::create_dir_all(&data)?;
        let secret_service=if std::env::var("TOKENFLOW_DESKTOP_DATA").is_ok(){format!("ai.renaissancemind.tokenflow.{}",format!("{:x}",Sha256::digest(data.to_string_lossy().as_bytes()))[..16].to_string())}else{"ai.renaissancemind.tokenflow".into()};
        let runtime=Arc::new(Runtime{input:AsyncMutex::new(None),child:AsyncMutex::new(None),waiters:AsyncMutex::new(HashMap::new()),sequence:AtomicU64::new(1),state:Mutex::new(Value::Null),quitting:AtomicBool::new(false),dashboard_ready:AtomicBool::new(false),http:reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build()?,data,secret_service,sidecar:sidecar_path()?,updater:AsyncMutex::new(None),downloaded:AsyncMutex::new(None)});
        app.manage(runtime.clone());
        if !headless {
            let acceptance=std::env::var("TOKENFLOW_ACCEPTANCE_REPORT").is_ok();
            let initial_script=if acceptance {format!("window.__TOKENFLOW_ACCEPTANCE__ = {};",json!({"phase":std::env::var("TOKENFLOW_ACCEPTANCE_PHASE").unwrap_or_else(|_|"basic".into()),"systemTest":std::env::var("TOKENFLOW_SYSTEM_TEST").as_deref()==Ok("1")}))}else{String::new()};
            WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html".into())).title("TokenFlow").inner_size(1000.0,830.0).min_inner_size(760.0,640.0).visible(!background).initialization_script(&initial_script).on_navigation(|url|url.scheme()=="tauri" || url.host_str()==Some("tauri.localhost")).build()?;
            WebviewWindowBuilder::new(app,"tray",WebviewUrl::App("index.html?mode=tray".into())).title("TokenFlow Status").inner_size(380.0,520.0).decorations(false).resizable(false).always_on_top(true).skip_taskbar(true).visible(false).on_navigation(|url|url.scheme()=="tauri" || url.host_str()==Some("tauri.localhost")).build()?;
            let dashboard=MenuItem::with_id(app,"dashboard","Open Dashboard",true,None::<&str>)?;let settings=MenuItem::with_id(app,"settings","Settings",true,Some("CmdOrCtrl+,"))?;let panel=MenuItem::with_id(app,"panel","Status panel",true,Some("CmdOrCtrl+Shift+T"))?;let quit=MenuItem::with_id(app,"quit","Quit TokenFlow",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&dashboard,&settings,&panel,&PredefinedMenuItem::separator(app)?,&quit])?;
            let icon=tauri::image::Image::from_bytes(if cfg!(target_os="macos"){include_bytes!("../../assets/trayTemplate.png")}else{include_bytes!("../../assets/tray.png")})?;
            TrayIconBuilder::with_id("tokenflow").icon(icon).icon_as_template(cfg!(target_os="macos")).menu(&menu).show_menu_on_left_click(false).on_menu_event(|app,event|match event.id.as_ref(){"dashboard"=>{let app=app.clone();tauri::async_runtime::spawn(async move {let runtime=app.state::<Arc<Runtime>>();let _=runtime.call("dashboard",Value::Null).await;});},"settings"=>{let _=show_local(app);},"panel"=>{let _=toggle_tray(app);},"quit"=>{let app=app.clone();tauri::async_runtime::spawn(async move {let runtime=app.state::<Arc<Runtime>>();runtime.quitting.store(true,Ordering::SeqCst);let _=runtime.call("shutdown",Value::Null).await;app.exit(0);});},_=>{}}).on_tray_icon_event(|tray,event|{if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event {let _=toggle_tray(tray.app_handle());}}).build(app)?;

        }
        let app_handle=app.handle().clone();tauri::async_runtime::spawn(async move {if let Err(error)=start(app_handle.clone(),runtime.clone(),headless,background).await {eprintln!("TokenFlow startup: {error}");if headless {app_handle.exit(1);}else {let _=app_handle.emit_to("main","tokenflow:failure",error);}}});
        Ok(())
    }).on_window_event(|window,event|{
        let runtime=window.state::<Arc<Runtime>>();match event {
            WindowEvent::CloseRequested{api,..} if !runtime.quitting.load(Ordering::SeqCst)=>{api.prevent_close();let _=window.hide();},
            WindowEvent::Focused(false) if window.label()=="tray"=>{let _=window.hide();},_=>{},
        }
    }).build(tauri::generate_context!()).expect("TokenFlow initialization failed").run(|app,event| {
        if let tauri::RunEvent::ExitRequested{api,..}=event {let runtime=app.state::<Arc<Runtime>>();if !runtime.quitting.load(Ordering::SeqCst){api.prevent_exit();}}
    });
}
