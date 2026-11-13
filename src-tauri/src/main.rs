// Gals Clip Studio — thin native layer: runs the bundled ffmpeg/ffprobe, reads/writes app files.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
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
                    if t.len() > 120 { t.remove(0); }
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

/// Runs ffmpeg to the end and returns its log (stderr). Used for audio analysis such as silencedetect.
#[tauri::command]
async fn ffmpeg_log(args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = command("ffmpeg")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("ffmpeg tidak bisa dijalankan: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stderr).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The local AI engine (llama.cpp). Newer builds call the plain prompt-in, text-out tool `llama-completion`.
fn llama_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    let names: &[&str] = if cfg!(windows) { &["llama-completion.exe", "llama-cli.exe"] } else { &["llama-completion", "llama-cli"] };
    for n in names {
        for p in [res.join("llama").join(n), res.join(n)] {
            if p.exists() { return Ok(p); }
        }
    }
    Err("Mesin AI lokal (llama.cpp) tidak ditemukan di folder aplikasi. Coba install ulang.".into())
}

#[tauri::command]
fn llama_available(app: AppHandle) -> bool {
    llama_exe(&app).is_ok()
}

/// Runs the local AI once and returns everything it printed. Cancel with `ffmpeg_cancel(job)`.
#[tauri::command]
async fn llama_run(app: AppHandle, jobs: State<'_, Jobs>, job: String, args: Vec<String>) -> Result<String, String> {
    let exe = llama_exe(&app)?;
    #[allow(unused_mut)]
    let mut c = Command::new(&exe);
    if let Some(dir) = exe.parent() { c.current_dir(dir); }
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    let mut child = c
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Mesin AI tidak bisa dijalankan: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    jobs.0.lock().unwrap().insert(job.clone(), child);
    let map = jobs.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let err_h = stderr.map(|mut e| std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = e.read_to_end(&mut buf);
            let text = String::from_utf8_lossy(&buf).to_string();
            let lines: Vec<&str> = text.lines().collect();
            lines[lines.len().saturating_sub(25)..].join("\n")
        }));
        let mut out = Vec::new();
        if let Some(mut o) = stdout { let _ = o.read_to_end(&mut out); }
        let tail = err_h.and_then(|h| h.join().ok()).unwrap_or_default();
        let child = map.lock().unwrap().remove(&job);
        match child {
            Some(mut c) => {
                let ok = c.wait().map(|s| s.success()).unwrap_or(false);
                if ok { Ok(String::from_utf8_lossy(&out).to_string()) } else { Err(format!("Mesin AI berhenti dengan error.\n{tail}")) }
            }
            None => Err("Dibatalkan.".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
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

/// Reads a text file; bytes that are not valid UTF-8 (whisper can split multi-byte characters) are replaced.
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
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
fn copy_file(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&dest).parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
}

/// Folder of the starter sound effects shipped with the app.
#[tauri::command]
fn starter_sfx_dir(app: AppHandle) -> String {
    app.path().resource_dir().map(|p| p.join("sfx").to_string_lossy().to_string()).unwrap_or_default()
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

// ---------- installed fonts ----------

fn font_rd(f: &mut File, at: u64, n: usize) -> Option<Vec<u8>> {
    f.seek(SeekFrom::Start(at)).ok()?;
    let mut b = vec![0u8; n];
    f.read_exact(&mut b).ok()?;
    Some(b)
}
fn u16be(b: &[u8], i: usize) -> usize { ((b[i] as usize) << 8) | b[i + 1] as usize }
fn u32be(b: &[u8], i: usize) -> u64 { ((b[i] as u64) << 24) | ((b[i + 1] as u64) << 16) | ((b[i + 2] as u64) << 8) | b[i + 3] as u64 }

/// Family names of the font starting at `off`: the legacy family (name ID 1, what Word shows, e.g. "Segoe UI Black")
/// and the typographic family (ID 16, e.g. "Segoe UI"). Windows English names first.
fn family_at(f: &mut File, off: u64) -> Option<Vec<String>> {
    let head = font_rd(f, off, 12)?;
    let n = u16be(&head, 4);
    let dir = font_rd(f, off + 12, n * 16)?;
    let mut name_off = None;
    for i in 0..n {
        if &dir[i * 16..i * 16 + 4] == b"name" { name_off = Some((u32be(&dir, i * 16 + 8), u32be(&dir, i * 16 + 12) as usize)); break; }
    }
    let (no, nl) = name_off?;
    if nl > 2_000_000 { return None; }
    let t = font_rd(f, no, nl)?;
    let count = u16be(&t, 2);
    let strings = u16be(&t, 4);
    let mut best: [Option<(i32, String)>; 2] = [None, None];
    for i in 0..count {
        let r = 6 + i * 12;
        if r + 12 > t.len() { break; }
        let (plat, enc, lang, id, len, so) = (u16be(&t, r), u16be(&t, r + 2), u16be(&t, r + 4), u16be(&t, r + 6), u16be(&t, r + 8), u16be(&t, r + 10));
        if id != 1 && id != 16 { continue; }
        let s = strings + so;
        if s + len > t.len() { continue; }
        let raw = &t[s..s + len];
        let text = if plat == 3 || plat == 0 {
            let u: Vec<u16> = raw.chunks(2).filter(|c| c.len() == 2).map(|c| ((c[0] as u16) << 8) | c[1] as u16).collect();
            String::from_utf16_lossy(&u)
        } else if plat == 1 && enc == 0 { raw.iter().map(|&c| c as char).collect() } else { continue };
        let text = text.trim().to_string();
        if text.is_empty() { continue; }
        let score = (if plat == 3 { 2 } else { 0 }) + (if lang == 0x409 || (plat == 1 && lang == 0) { 1 } else { 0 });
        let k = if id == 16 { 1 } else { 0 };
        if best[k].as_ref().map_or(true, |b| score > b.0) { best[k] = Some((score, text)); }
    }
    let v: Vec<String> = IntoIterator::into_iter(best).flatten().map(|b| b.1).collect();
    if v.is_empty() { None } else { Some(v) }
}

fn families_of(path: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(mut f) = File::open(path) else { return out };
    let Some(tag) = font_rd(&mut f, 0, 12) else { return out };
    if &tag[0..4] == b"ttcf" {
        let n = (u32be(&tag, 8) as usize).min(64);
        if let Some(offs) = font_rd(&mut f, 12, n * 4) {
            for i in 0..n { if let Some(fam) = family_at(&mut f, u32be(&offs, i * 4)) { out.extend(fam); } }
        }
    } else if let Some(fam) = family_at(&mut f, 0) { out.extend(fam); }
    out
}

fn font_families_in(dirs: &[PathBuf]) -> Vec<String> {
    let mut all: Vec<String> = Vec::new();
    for d in dirs {
        let Ok(entries) = std::fs::read_dir(d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(), "ttf" | "otf" | "ttc") { continue; }
            for fam in families_of(&p) { if !fam.starts_with('@') { all.push(fam); } }
        }
    }
    all.sort_by_key(|s| s.to_lowercase());
    all.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    all
}


/// Font families installed on Windows (for everyone and for this user), read from the font files' name tables.
#[tauri::command]
async fn system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut dirs = vec![PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("Fonts")];
        if let Ok(local) = std::env::var("LOCALAPPDATA") { dirs.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts")); }
        font_families_in(&dirs)
    })
    .await
    .unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            probe, ffmpeg_check, ffmpeg_log, tool_run, ffmpeg_cancel, whisper_available, llama_available, llama_run, cpu_count, file_size, download, waveform, data_dir, videos_dir,
            read_text, write_text, write_bytes, system_fonts, read_bytes, ensure_dir, copy_file, starter_sfx_dir, exists, list_dir, remove_path, reveal
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan Gals Clip Studio");
}
