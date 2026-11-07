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
    pct: f32,
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

/// Starts ffmpeg or whisper in the background. Emits `ffmpeg://progress` and finally `ffmpeg://done`.
/// ffmpeg reports time on stdout (`-progress pipe:1`); whisper reports "progress = N%" on stderr (`-pp`).
#[tauri::command]
fn tool_run(app: AppHandle, jobs: State<Jobs>, job: String, tool: String, args: Vec<String>) -> Result<(), String> {
    let mut cmd = match tool.as_str() {
        "ffmpeg" => command("ffmpeg"),
        "whisper" => {
            let exe = whisper_exe(&app)?;
            #[allow(unused_mut)]
            let mut c = Command::new(&exe);
            if let Some(dir) = exe.parent() { c.current_dir(dir); }
            #[cfg(windows)]
            c.creation_flags(CREATE_NO_WINDOW);
            c
        }
        _ => return Err("alat tidak dikenal".into()),
    };
    let mut child = cmd
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{tool} tidak bisa dijalankan: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    jobs.0.lock().unwrap().insert(job.clone(), child);
    let map = jobs.0.clone();

    std::thread::spawn(move || {
        // keep the last lines of stderr for error messages, and pick up whisper's progress
        let err_tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let err_handle = stderr.map(|e| {
            let tail = err_tail.clone();
            let app2 = app.clone();
            let job2 = job.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(e);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let line = String::from_utf8_lossy(&buf).trim().to_string();
                    if let Some(i) = line.find("progress = ") {
                        let n: String = line[i + 11..].chars().take_while(|c| c.is_ascii_digit()).collect();
                        if let Ok(p) = n.parse::<f32>() {
                            let _ = app2.emit("ffmpeg://progress", Progress { job: job2.clone(), out_ms: 0, pct: p });
                        }
                        continue;
                    }
                    let mut t = tail.lock().unwrap();
                    t.push(line);
                    if t.len() > 25 { t.remove(0); }
                }
            })
        });
        let mut stdout_text = String::new();
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some(v) = line.strip_prefix("out_time_us=") {
                    if let Ok(us) = v.trim().parse::<i64>() {
                        let _ = app.emit("ffmpeg://progress", Progress { job: job.clone(), out_ms: (us.max(0) / 1000) as u64, pct: -1.0 });
                    }
                } else if stdout_text.len() < 4000 {
                    stdout_text.push_str(&line);
                    stdout_text.push('\n');
                }
            }
        }
        if let Some(h) = err_handle { let _ = h.join(); }
        let child = map.lock().unwrap().remove(&job);
        let ok = match child {
            Some(mut c) => c.wait().map(|s| s.success()).unwrap_or(false),
            None => false, // removed by cancel
        };
        let error = if ok { String::new() } else { err_tail.lock().unwrap().join("\n") };
        let _ = app.emit("ffmpeg://done", Done { job, ok, error });
    });
    Ok(())
}

fn whisper_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    for p in [res.join("whisper").join(name), res.join(name)] {
        if p.exists() { return Ok(p); }
    }
    Err("Mesin subtitle (whisper) tidak ditemukan di folder aplikasi. Coba install ulang.".into())
}

#[tauri::command]
fn whisper_available(app: AppHandle) -> bool {
    whisper_exe(&app).is_ok()
}

#[tauri::command]
fn cpu_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

#[tauri::command]
fn file_size(path: String) -> u64 {
    std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
}

/// Downloads a file with Windows' built-in curl.exe into `<dest>.part`, then renames it.
#[tauri::command]
async fn download(url: String, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let part = format!("{dest}.part");
        if let Some(parent) = PathBuf::from(&dest).parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        #[allow(unused_mut)]
        let mut c = Command::new("curl");
        #[cfg(windows)]
        c.creation_flags(CREATE_NO_WINDOW);
        let out = c
            .args(["-L", "--fail", "--retry", "3", "-s", "-S", "-o", &part, &url])
            .output()
            .map_err(|e| format!("curl tidak bisa dijalankan: {e}"))?;
        if !out.status.success() {
            let _ = std::fs::remove_file(&part);
            return Err(format!("Unduhan gagal. Cek koneksi internet.\n{}", String::from_utf8_lossy(&out.stderr)));
        }
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
                    let _ = app.emit("ffmpeg://progress", Progress { job: job.clone(), out_ms: peaks.len() as u64 * 100, pct: -1.0 });
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
            probe, ffmpeg_check, tool_run, ffmpeg_cancel, whisper_available, cpu_count, file_size, download, waveform, data_dir, videos_dir,
            read_text, write_text, write_bytes, read_bytes, ensure_dir, exists, list_dir, remove_path, reveal
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan GALSURKU Clipper");
}
