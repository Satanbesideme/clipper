// GALSURKU Clipper — thin native layer: runs the bundled ffmpeg/ffprobe, reads/writes app files.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
struct Jobs(Arc<Mutex<HashMap<String, Child>>>);

#[derive(Clone, Serialize)]
struct Progress {
    job: String,
    out_ms: u64,
}

#[derive(Clone, Serialize)]
struct Done {
    job: String,
    ok: bool,
    error: String,
}

fn tool_path(name: &str) -> PathBuf {
    // Sidecars are installed next to the main executable.
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let p = dir.join(&file);
    if p.exists() { p } else { PathBuf::from(file) }
}

fn command(name: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(tool_path(name));
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

#[tauri::command]
fn probe(path: String) -> Result<String, String> {
    let out = command("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", &path])
        .output()
        .map_err(|e| format!("ffprobe tidak bisa dijalankan: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Runs ffmpeg to completion and returns whether it exited cleanly (used to test encoders).
#[tauri::command]
fn ffmpeg_check(args: Vec<String>) -> bool {
    command("ffmpeg")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Starts ffmpeg in the background. Emits `ffmpeg://progress` and finally `ffmpeg://done`.
#[tauri::command]
fn ffmpeg_run(app: AppHandle, jobs: State<Jobs>, job: String, args: Vec<String>) -> Result<(), String> {
    let mut child = command("ffmpeg")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg tidak bisa dijalankan: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    jobs.0.lock().unwrap().insert(job.clone(), child);
    let map = jobs.0.clone();

    std::thread::spawn(move || {
        // keep the last part of stderr for error messages
        let err_tail = Arc::new(Mutex::new(String::new()));
        let err_handle = stderr.map(|mut e| {
            let tail = err_tail.clone();
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = e.read_to_end(&mut buf);
                let start = buf.len().saturating_sub(1500);
                *tail.lock().unwrap() = String::from_utf8_lossy(&buf[start..]).to_string();
            })
        });
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some(v) = line.strip_prefix("out_time_us=") {
                    if let Ok(us) = v.trim().parse::<i64>() {
                        let _ = app.emit("ffmpeg://progress", Progress { job: job.clone(), out_ms: (us.max(0) / 1000) as u64 });
                    }
                }
            }
        }
        if let Some(h) = err_handle { let _ = h.join(); }
        let child = map.lock().unwrap().remove(&job);
        let ok = match child {
            Some(mut c) => c.wait().map(|s| s.success()).unwrap_or(false),
            None => false, // removed by cancel
        };
        let error = if ok { String::new() } else { err_tail.lock().unwrap().clone() };
        let _ = app.emit("ffmpeg://done", Done { job, ok, error });
    });
    Ok(())
}

#[tauri::command]
fn ffmpeg_cancel(jobs: State<Jobs>, job: String) {
    if let Some(mut c) = jobs.0.lock().unwrap().remove(&job) {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// Decodes the audio track at 4 kHz mono and returns one peak byte (0..255) per 100 ms.
#[tauri::command]
async fn waveform(app: AppHandle, path: String, track: u32, job: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i", &path, "-map", &format!("0:a:{track}?"),
                   "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "pipe:1"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg tidak bisa dijalankan: {e}"))?;
        let mut out = child.stdout.take().ok_or("tidak ada output")?;
        let mut peaks = Vec::new();
        let mut buf = vec![0u8; 800]; // 400 samples = 100 ms
        let mut filled = 0usize;
        loop {
            let n = out.read(&mut buf[filled..]).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            filled += n;
            if filled == buf.len() {
                peaks.push(peak(&buf));
                filled = 0;
                if peaks.len() % 3000 == 0 {
                    let _ = app.emit("ffmpeg://progress", Progress { job: job.clone(), out_ms: peaks.len() as u64 * 100 });
                }
            }
        }
        if filled >= 2 { peaks.push(peak(&buf[..filled])); }
        let _ = child.wait();
        Ok(peaks)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn peak(b: &[u8]) -> u8 {
    let mut m: i32 = 0;
    for s in b.chunks_exact(2) {
        let v = (i16::from_le_bytes([s[0], s[1]]) as i32).abs();
        if v > m { m = v; }
    }
    ((m * 255) / 32768) as u8
}

#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.to_string_lossy().to_string())
}

#[tauri::command]
fn videos_dir(app: AppHandle) -> String {
    app.path().video_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_bytes(path: String, content: Vec<u8>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
fn list_dir(path: String) -> Vec<String> {
    std::fs::read_dir(&path)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

/// Deletes a file or folder. Only used on the app's own cache files.
#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() { std::fs::remove_dir_all(&p).map_err(|e| e.to_string()) }
    else if p.exists() { std::fs::remove_file(&p).map_err(|e| e.to_string()) }
    else { Ok(()) }
}

#[tauri::command]
fn reveal(path: String) {
    #[cfg(windows)]
    {
        let _ = Command::new("explorer").arg(format!("/select,{}", path.replace('/', "\\"))).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            probe, ffmpeg_check, ffmpeg_run, ffmpeg_cancel, waveform, data_dir, videos_dir,
            read_text, write_text, write_bytes, read_bytes, ensure_dir, exists, list_dir, remove_path, reveal
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan GALSURKU Clipper");
}
