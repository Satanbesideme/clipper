// Running ffmpeg: one-off tasks (import, thumbnails) and the export queue.
import { invoke, listen, join, extName, dirName, stem } from './tauri';
import {
  ENCODER_ORDER, encoderProbeArgs, exportArgs, presetLayouts, remuxArgs, safeName, thumbArgs,
  type Encoder, type ExportSpec,
} from './ffmpeg';
import { projectDir, uid, type Clip, type Project } from './store';

type ProgressCb = (outMs: number) => void;
const progressCbs = new Map<string, ProgressCb>();
const doneCbs = new Map<string, (r: { ok: boolean; error: string }) => void>();
let listening = false;

async function ensureListeners() {
  if (listening) return;
  listening = true;
  await listen<{ job: string; out_ms: number }>('ffmpeg://progress', (p) => progressCbs.get(p.job)?.(p.out_ms));
  await listen<{ job: string; ok: boolean; error: string }>('ffmpeg://done', (p) => {
    const cb = doneCbs.get(p.job);
    progressCbs.delete(p.job);
    doneCbs.delete(p.job);
    cb?.({ ok: p.ok, error: p.error });
  });
}

/** Runs ffmpeg in the background and resolves when it ends. Rejects with ffmpeg's error text. */
export async function runFfmpeg(args: string[], onProgress?: ProgressCb, jobId: string = uid()): Promise<void> {
  await ensureListeners();
  return new Promise<void>((resolve, reject) => {
    if (onProgress) progressCbs.set(jobId, onProgress);
    doneCbs.set(jobId, (r) => (r.ok ? resolve() : reject(new Error(cleanError(r.error)))));
    invoke('ffmpeg_run', { job: jobId, args }).catch((e) => {
      progressCbs.delete(jobId);
      doneCbs.delete(jobId);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

function cleanError(s: string): string {
  const lines = s.trim().split(/\r?\n/).filter((l) => l && !l.startsWith('  '));
  return lines.slice(-3).join('\n') || 'Dibatalkan.';
}

export async function cancelJob(jobId: string) {
  await invoke('ffmpeg_cancel', { job: jobId });
}

// ---------- encoder ----------

export const ENCODER_LABEL: Record<Encoder, string> = {
  h264_nvenc: 'NVIDIA (NVENC)',
  h264_qsv: 'Intel (Quick Sync)',
  h264_amf: 'AMD (AMF)',
  libx264: 'CPU (x264)',
};

export async function detectEncoder(): Promise<Encoder> {
  for (const e of ENCODER_ORDER) {
    if (e === 'libx264') return e;
    if (await invoke<boolean>('ffmpeg_check', { args: encoderProbeArgs(e) })) return e;
  }
  return 'libx264';
}

// ---------- import ----------

interface ProbeStream { codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }
interface ProbeResult { streams: ProbeStream[]; format: { duration?: string } }

function rate(s?: string): number {
  if (!s) return 0;
  const [a, b] = s.split('/').map(Number);
  return b ? a / b : a || 0;
}

export async function importVideo(path: string, onStatus: (msg: string, frac?: number) => void): Promise<Project> {
  onStatus('Membaca info video…');
  let info: ProbeResult;
  try {
    info = JSON.parse(await invoke<string>('probe', { path })) as ProbeResult;
  } catch (e) {
    throw new Error(`File ini tidak bisa dibaca sebagai video.\n${String(e)}`);
  }
  const v = info.streams.find((s) => s.codec_type === 'video' && s.width);
  if (!v || !v.width || !v.height) throw new Error('File ini tidak punya track video.');
  const durationMs = Math.round(Number(info.format.duration ?? 0) * 1000);
  if (!durationMs) throw new Error('Durasi video tidak terbaca. Kalau rekaman OBS terputus, coba remux dulu di OBS.');
  const audioTracks = info.streams.filter((s) => s.codec_type === 'audio').length;
  const fps = Math.round((rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30) * 100) / 100;

  // WebView2 plays MP4/MOV. Other containers (OBS MKV, FLV, TS) get a quick lossless remux next to the source.
  let playable = path;
  const ext = extName(path);
  if (!['mp4', 'mov', 'm4v'].includes(ext)) {
    playable = join(dirName(path), `${stem(path)}.clipper.mp4`);
    if (!(await invoke<boolean>('exists', { path: playable }))) {
      onStatus('Menyiapkan file agar bisa diputar (tanpa mengurangi kualitas)…', 0);
      try {
        await runFfmpeg(remuxArgs(path, playable), (ms) => onStatus('Menyiapkan file agar bisa diputar…', ms / durationMs));
      } catch (e) {
        await invoke('remove_path', { path: playable }).catch(() => undefined);
        throw new Error(`Gagal menyiapkan file. Pastikan folder video tidak read-only dan disknya cukup.\n${(e as Error).message}`);
      }
    }
  }

  const presets = presetLayouts(v.width, v.height);
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: stem(path),
    source: path,
    playable,
    durationMs,
    fps,
    width: v.width,
    height: v.height,
    audioTracks,
    audioTrack: 0,
    thumbs: { everySec: durationMs > 2 * 3600_000 ? 20 : 10, sheets: 0, ready: false },
    waveformReady: false,
    defaultLayout: structuredClone(presets[1]),
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Contact sheets for the timeline. Decodes keyframes only, so even a 4-hour VOD is quick. */
export async function buildThumbs(p: Project, onFrac: (f: number) => void) {
  const dir = await projectDir(p.id);
  await invoke('ensure_dir', { path: dir });
  await runFfmpeg(thumbArgs(p.playable, join(dir, 'thumbs_%03d.jpg'), p.thumbs.everySec), (ms) => onFrac(ms / p.durationMs));
  const files = await invoke<string[]>('list_dir', { path: dir });
  p.thumbs.sheets = files.filter((f) => /^thumbs_\d+\.jpg$/.test(f)).length;
  p.thumbs.ready = true;
}

export async function buildWaveform(p: Project, onFrac: (f: number) => void): Promise<Uint8Array> {
  const job = uid();
  await ensureListeners();
  progressCbs.set(job, (ms) => onFrac(ms / p.durationMs));
  try {
    const bytes = await invoke<number[]>('waveform', { path: p.playable, track: p.audioTrack, job });
    const data = Uint8Array.from(bytes);
    await invoke('write_bytes', { path: join(await projectDir(p.id), `waveform_${p.audioTrack}.bin`), content: Array.from(data) });
    p.waveformReady = true;
    return data;
  } finally {
    progressCbs.delete(job);
  }
}

export async function loadWaveform(p: Project): Promise<Uint8Array | null> {
  try {
    const bytes = await invoke<number[]>('read_bytes', { path: join(await projectDir(p.id), `waveform_${p.audioTrack}.bin`) });
    return Uint8Array.from(bytes);
  } catch {
    return null;
  }
}

// ---------- export queue ----------

export type Preset = 'tiktok' | 'shorts';
export const PRESET_LIMIT_SEC: Record<Preset, number> = { tiktok: 600, shorts: 180 };

export interface ExportJob {
  id: string;
  projectId: string;
  clipId: string;
  label: string;
  outPath: string;
  totalMs: number;
  progress: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string;
  spec: ExportSpec;
}

export const queue: ExportJob[] = [];
let running = false;
let onChange: () => void = () => undefined;
export function onQueueChange(cb: () => void) { onChange = cb; }

const FONTS = ['C:\\Windows\\Fonts\\segoeuib.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'];
let fontCache: string | null | undefined;
async function titleFont(): Promise<string | null> {
  if (fontCache !== undefined) return fontCache;
  for (const f of FONTS) if (await invoke<boolean>('exists', { path: f })) return (fontCache = f);
  return (fontCache = null);
}

/** Emoji cannot be drawn by the export font, so they are removed from titles. */
export function stripEmoji(s: string) {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/[ \t]+\n/g, '\n').trim();
}

async function uniquePath(dir: string, base: string): Promise<string> {
  let n = 1;
  let p = join(dir, `${base}.mp4`);
  while (await invoke<boolean>('exists', { path: p })) p = join(dir, `${base} (${++n}).mp4`);
  return p;
}

export async function enqueueExport(p: Project, clip: Clip, opts: { outDir: string; encoder: Encoder; fps: 30 | 60 }) {
  await invoke('ensure_dir', { path: opts.outDir });
  const id = uid();
  let titleFile: string | undefined;
  let fontFile: string | undefined;
  const title = stripEmoji(clip.title);
  if (title) {
    const font = await titleFont();
    if (font) {
      titleFile = join(await projectDir(p.id), `title-${id}.txt`);
      await invoke('write_text', { path: titleFile, content: title });
      fontFile = font;
    }
  }
  const outPath = await uniquePath(opts.outDir, `${safeName(p.name)} - ${safeName(clip.name)}`);
  const job: ExportJob = {
    id, projectId: p.id, clipId: clip.id, label: clip.name, outPath,
    totalMs: clip.outMs - clip.inMs, progress: 0, status: 'queued', error: '',
    spec: {
      source: p.playable, inMs: clip.inMs, outMs: clip.outMs, layout: clip.layout,
      width: 1080, height: 1920, fps: opts.fps, bitrateK: opts.fps === 60 ? 16000 : 12000,
      encoder: opts.encoder, audioTrack: p.audioTrack, titleFile, titlePos: clip.titlePos, fontFile, outPath,
    },
  };
  queue.push(job);
  onChange();
  void pump();
  return job;
}

async function pump() {
  if (running) return;
  const job = queue.find((j) => j.status === 'queued');
  if (!job) return;
  running = true;
  job.status = 'running';
  onChange();
  try {
    await runFfmpeg(exportArgs(job.spec), (ms) => { job.progress = Math.min(1, ms / job.totalMs); onChange(); }, job.id);
    job.status = 'done';
    job.progress = 1;
  } catch (e) {
    if (job.status === 'running') {
      // A GPU encoder can fail on some drivers: retry once on the CPU.
      if (job.spec.encoder !== 'libx264') {
        job.spec.encoder = 'libx264';
        job.status = 'queued';
        job.progress = 0;
      } else {
        job.status = 'failed';
        job.error = (e as Error).message;
      }
    }
  }
  if (job.status !== 'queued' && job.spec.titleFile) await invoke('remove_path', { path: job.spec.titleFile }).catch(() => undefined);
  running = false;
  onChange();
  void pump();
}

export async function cancelExport(job: ExportJob) {
  if (job.status === 'queued') job.status = 'cancelled';
  else if (job.status === 'running') {
    job.status = 'cancelled';
    await cancelJob(job.id);
    await invoke('remove_path', { path: job.outPath }).catch(() => undefined);
  }
  onChange();
}
