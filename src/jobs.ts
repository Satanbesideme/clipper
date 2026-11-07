// Running ffmpeg / whisper: import, thumbnails, speech-to-text and the export queue.
import { invoke, listen, join, extName, dirName, stem, baseName } from './tauri';
import {
  ENCODER_ORDER, encoderProbeArgs, remuxArgs, safeName, speechWavArgs, stripEmoji, thumbArgs, whisperArgs,
  type Encoder,
} from './ffmpeg';
import {
  buildAss, groupLines, parseSilences, renderArgs, sourceToTimeline, timelineDuration, wordsFromWhisper,
  type CaptionLine, type Range, type Timeline, type Word,
} from './render';
import { dataDir, projectDir, uid, type MediaEntry, type ModelSize, type Project } from './store';

type ProgressCb = (outMs: number, pct: number) => void;
const progressCbs = new Map<string, ProgressCb>();
const doneCbs = new Map<string, (r: { ok: boolean; error: string }) => void>();
let listening: Promise<void> | null = null;

function ensureListeners() {
  listening ??= (async () => {
    await listen<{ job: string; out_ms: number; pct: number }>('ffmpeg://progress', (p) => progressCbs.get(p.job)?.(p.out_ms, p.pct));
    await listen<{ job: string; ok: boolean; error: string }>('ffmpeg://done', (p) => {
      const cb = doneCbs.get(p.job);
      progressCbs.delete(p.job);
      doneCbs.delete(p.job);
      cb?.({ ok: p.ok, error: p.error });
    });
  })();
  return listening;
}

/** Runs ffmpeg or whisper in the background and resolves when it ends. Rejects with the tool's error text. */
export async function runTool(tool: 'ffmpeg' | 'whisper', args: string[], onProgress?: ProgressCb, jobId: string = uid()): Promise<void> {
  await ensureListeners();
  return new Promise<void>((resolve, reject) => {
    if (onProgress) progressCbs.set(jobId, onProgress);
    doneCbs.set(jobId, (r) => (r.ok ? resolve() : reject(new Error(cleanError(r.error)))));
    invoke('tool_run', { job: jobId, tool, args }).catch((e) => {
      progressCbs.delete(jobId);
      doneCbs.delete(jobId);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

function cleanError(s: string): string {
  const lines = s.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(Stream|Input|Output|Duration|Metadata|encoder|handler_name|\[)/i.test(l));
  return lines.slice(-3).join('\n') || 'Dibatalkan.';
}

export const cancelJob = (jobId: string) => invoke('ffmpeg_cancel', { job: jobId });

// ---------- encoder ----------

export const ENCODER_LABEL: Record<Encoder, string> = {
  h264_nvenc: 'GPU NVIDIA', h264_qsv: 'GPU Intel', h264_amf: 'GPU AMD', libx264: 'CPU',
};

export async function detectEncoder(): Promise<Encoder> {
  for (const e of ENCODER_ORDER) {
    if (e === 'libx264') return e;
    if (await invoke<boolean>('ffmpeg_check', { args: encoderProbeArgs(e) })) return e;
  }
  return 'libx264';
}

// ---------- import ----------

interface ProbeStream { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }
interface ProbeResult { streams: ProbeStream[]; format: { duration?: string } }

function rate(s?: string): number {
  if (!s) return 0;
  const [a, b] = s.split('/').map(Number);
  return b ? a / b : a || 0;
}

export const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'm4v', 'webm'];

export async function importMedia(path: string, onStatus: (msg: string) => void): Promise<MediaEntry> {
  onStatus(`Membaca ${baseName(path)}…`);
  let info: ProbeResult;
  try {
    info = JSON.parse(await invoke<string>('probe', { path })) as ProbeResult;
  } catch (e) {
    throw new Error(`${baseName(path)} tidak bisa dibaca sebagai video.\n${String(e)}`);
  }
  const v = info.streams.find((s) => s.codec_type === 'video' && s.width);
  if (!v || !v.width || !v.height) throw new Error(`${baseName(path)} tidak punya gambar video.`);
  const durationMs = Math.round(Number(info.format.duration ?? 0) * 1000);
  if (!durationMs) throw new Error(`Durasi ${baseName(path)} tidak terbaca. Kalau rekamannya terputus, remux dulu di OBS (File → Remux Recordings).`);
  const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
  const width = rot ? v.height : v.width;
  const height = rot ? v.width : v.height;

  let playable = path;
  if (!['mp4', 'mov', 'm4v', 'webm'].includes(extName(path))) {
    playable = join(dirName(path), `${stem(path)}.clipper.mp4`);
    if (!(await invoke<boolean>('exists', { path: playable }))) {
      try {
        await runTool('ffmpeg', remuxArgs(path, playable), (ms) => onStatus(`Menyiapkan ${baseName(path)}… ${Math.round((ms / durationMs) * 100)}%`));
      } catch (e) {
        await invoke('remove_path', { path: playable }).catch(() => undefined);
        throw new Error(`Gagal menyiapkan ${baseName(path)}. Pastikan disknya cukup.\n${(e as Error).message}`);
      }
    }
  }
  const th = 96;
  const tw = Math.max(2, Math.round((th * width) / height / 2) * 2);
  return {
    id: uid(), path, playable, name: stem(path), durationMs, width, height,
    fps: Math.round((rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30) * 100) / 100,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
    thumbs: { everySec: Math.min(20, Math.max(1, Math.ceil(durationMs / 1000 / 400))), sheets: 0, tw, th, ready: false },
  };
}

export async function buildThumbs(p: Project, m: MediaEntry) {
  const dir = await projectDir(p.id);
  await invoke('ensure_dir', { path: dir });
  await runTool('ffmpeg', thumbArgs(m.playable, join(dir, `thumbs_${m.id}_%03d.jpg`), m.thumbs.everySec, m.thumbs.tw, m.thumbs.th));
  const files = await invoke<string[]>('list_dir', { path: dir });
  m.thumbs.sheets = files.filter((f) => f.startsWith(`thumbs_${m.id}_`)).length;
  m.thumbs.ready = true;
}

export async function thumbPath(p: Project, m: MediaEntry, sheet: number) {
  return join(await projectDir(p.id), `thumbs_${m.id}_${String(sheet + 1).padStart(3, '0')}.jpg`);
}

// ---------- speech-to-text ----------

export const MODELS: Record<ModelSize, { file: string; url: string; bytes: number; label: string }> = {
  base: { file: 'ggml-base.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', bytes: 147_951_465, label: 'Cepat (148 MB)' },
  small: { file: 'ggml-small.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', bytes: 487_601_967, label: 'Akurat (488 MB)' },
};

export async function modelPath(size: ModelSize) { return join(await dataDir(), 'models', MODELS[size].file); }

export async function modelReady(size: ModelSize) {
  return (await invoke<number>('file_size', { path: await modelPath(size) })) > MODELS[size].bytes * 0.9;
}

export async function downloadModel(size: ModelSize, onFrac: (f: number) => void) {
  const dest = await modelPath(size);
  const part = `${dest}.part`;
  const iv = window.setInterval(() => {
    void invoke<number>('file_size', { path: part }).then((n) => onFrac(Math.min(0.99, n / MODELS[size].bytes)));
  }, 500);
  try {
    await invoke('download', { url: MODELS[size].url, dest });
  } finally {
    window.clearInterval(iv);
  }
}

/**
 * Transcribes the audio under every clip on the timeline and returns caption lines in timeline time.
 * Each clip is transcribed separately so only the parts that are used get processed.
 */
export async function transcribe(p: Project, size: ModelSize, onStatus: (msg: string, frac: number) => void): Promise<CaptionLine[]> {
  if (!(await invoke<boolean>('whisper_available'))) throw new Error('Mesin subtitle tidak ditemukan. Install ulang GALSURKU Clipper versi terbaru.');
  const model = await modelPath(size);
  const dir = join(await projectDir(p.id), 'stt');
  await invoke('ensure_dir', { path: dir });
  const threads = await invoke<number>('cpu_count');
  const clips = p.timeline.clips;
  const total = clips.reduce((s, c) => s + (c.outMs - c.inMs), 0) || 1;
  let done = 0;
  const words: Word[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const m = p.media.find((x) => x.id === c.mediaId);
    const len = c.outMs - c.inMs;
    if (!m || !m.hasAudio) { done += len; continue; }
    const wav = join(dir, `clip-${c.id}.wav`);
    const base = join(dir, `clip-${c.id}`);
    const label = clips.length > 1 ? ` (potongan ${i + 1}/${clips.length})` : '';
    onStatus(`Menyiapkan audio${label}…`, done / total);
    await runTool('ffmpeg', speechWavArgs(m.playable, c.inMs, c.outMs, wav));
    onStatus(`Mendengarkan ucapan${label}…`, done / total);
    await runTool('whisper', whisperArgs(model, wav, base, threads), (_ms, pct) => {
      if (pct >= 0) onStatus(`Mendengarkan ucapan${label}… ${Math.round(pct)}%`, (done + (len * pct) / 100) / total);
    });
    const json = await invoke<string>('read_text', { path: `${base}.json` });
    for (const w of wordsFromWhisper(json, c.inMs)) {
      const a = sourceToTimeline([c], c.mediaId, Math.min(c.outMs, w.startMs));
      const b = sourceToTimeline([c], c.mediaId, Math.min(c.outMs, w.endMs));
      if (a === null || b === null) continue;
      const offset = clipOffset(p.timeline, i);
      words.push({ text: w.text, startMs: a + offset, endMs: Math.max(a + offset + 60, b + offset) });
    }
    await invoke('remove_path', { path: wav }).catch(() => undefined);
    done += len;
  }
  onStatus('Menyusun subtitle…', 1);
  return groupLines(words, uid);
}

function clipOffset(tl: Timeline, index: number) {
  let t = 0;
  for (let i = 0; i < index; i++) t += Math.round((tl.clips[i].outMs - tl.clips[i].inMs) / tl.clips[i].speed);
  return t;
}

// ---------- export queue ----------

export interface ExportJob {
  id: string;
  projectId: string;
  label: string;
  outPath: string;
  totalMs: number;
  progress: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string;
  args: string[];
  encoder: Encoder;
  build: (enc: Encoder) => string[];
  assFile?: string;
}

export const queue: ExportJob[] = [];
let running = false;
let onChange: () => void = () => undefined;
export function onQueueChange(cb: () => void) { onChange = cb; }

const FONTS_DIR = 'C:\\Windows\\Fonts';

async function uniquePath(dir: string, base: string): Promise<string> {
  let n = 1;
  let p = join(dir, `${base}.mp4`);
  while (await invoke<boolean>('exists', { path: p })) p = join(dir, `${base} (${++n}).mp4`);
  return p;
}

export async function enqueueExport(p: Project, opts: { outDir: string; encoder: Encoder }) {
  const tl: Timeline = structuredClone(p.timeline);
  if (!tl.clips.length) throw new Error('Timeline masih kosong. Tambahkan video dulu.');
  tl.texts = tl.texts.map((t) => ({ ...t, text: stripEmoji(t.text) })).filter((t) => t.text);
  tl.captions.lines = tl.captions.lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, text: stripEmoji(w.text) })).filter((w) => w.text) })).filter((l) => l.words.length);
  await invoke('ensure_dir', { path: opts.outDir });
  const id = uid();
  let assFile: string | undefined;
  if (tl.texts.length || tl.captions.lines.length) {
    assFile = join(await projectDir(p.id), `export-${id}.ass`);
    await invoke('write_text', { path: assFile, content: buildAss(tl) });
  }
  const outPath = await uniquePath(opts.outDir, safeName(p.name));
  const media = Object.fromEntries(p.media.map((m) => [m.id, m]));
  const build = (encoder: Encoder) => renderArgs({ tl, media, encoder, bitrateK: tl.fps === 60 ? 16000 : 12000, assFile, fontsDir: FONTS_DIR, outPath });
  const job: ExportJob = {
    id, projectId: p.id, label: p.name, outPath, totalMs: timelineDuration(tl), progress: 0, status: 'queued', error: '',
    args: build(opts.encoder), encoder: opts.encoder, build, assFile,
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
    await runTool('ffmpeg', job.args, (ms) => { job.progress = Math.min(1, ms / job.totalMs); onChange(); }, job.id);
    job.status = 'done';
    job.progress = 1;
  } catch (e) {
    if (job.status === 'running') {
      if (job.encoder !== 'libx264') {
        // A GPU encoder can fail on some drivers: retry once on the CPU.
        job.encoder = 'libx264';
        job.args = job.build('libx264');
        job.status = 'queued';
        job.progress = 0;
      } else {
        job.status = 'failed';
        job.error = (e as Error).message;
      }
    }
  }
  if (job.status !== 'queued' && job.assFile) await invoke('remove_path', { path: job.assFile }).catch(() => undefined);
  running = false;
  onChange();
  void pump();
}

export async function cancelExport(job: ExportJob) {
  const wasRunning = job.status === 'running';
  job.status = 'cancelled';
  if (wasRunning) {
    await cancelJob(job.id);
    await invoke('remove_path', { path: job.outPath }).catch(() => undefined);
  }
  onChange();
}

// ---------- audio analysis ----------

/** Silent parts of a media file's main audio track (source time), cached per noise threshold. */
export async function silencesOf(m: MediaEntry, noiseDb: number): Promise<Range[]> {
  const key = String(noiseDb);
  if (m.silences?.[key]) return m.silences[key];
  if (!m.hasAudio) return [{ startMs: 0, endMs: m.durationMs }];
  const log = await invoke<string>('ffmpeg_log', {
    args: ['-hide_banner', '-nostats', '-i', m.playable, '-map', '0:a:0', '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=0.3`, '-f', 'null', '-'],
  });
  const r = parseSilences(log, m.durationMs);
  (m.silences ??= {})[key] = r;
  return r;
}

export interface MusicInfo { durationMs: number }
export async function probeAudio(path: string): Promise<MusicInfo> {
  const info = JSON.parse(await invoke<string>('probe', { path })) as { streams: { codec_type: string }[]; format: { duration?: string } };
  const ms = Math.round(Number(info.format.duration ?? 0) * 1000);
  if (!info.streams.some((s) => s.codec_type === 'audio') || !ms) throw new Error('File ini bukan audio yang bisa dibaca.');
  return { durationMs: ms };
}
