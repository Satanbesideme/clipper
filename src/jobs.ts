// Running ffmpeg / whisper: import, thumbnails, speech-to-text and the export queue.
import { invoke, listen, join, extName, dirName, stem, baseName } from './tauri';
import {
  ENCODER_ORDER, encoderProbeArgs, remuxArgs, safeName, speechWavArgs, stripEmoji, thumbArgs, whisperArgs,
  type Encoder,
} from './ffmpeg';
import {
  buildAss, filterPath, groupLines, parseSilences, renderArgs, silencesOnTimeline, snapWordsToSpeech, timelineDuration, wordsFromWhisper,
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

/** Job id of the running speech-to-text step, so it can be cancelled. */
export let sttJob: string | null = null;
let sttCancelled = false;
export async function cancelTranscribe() {
  sttCancelled = true;
  if (sttJob) await cancelJob(sttJob).catch(() => undefined);
}

/**
 * ffmpeg args that write the timeline's audio (clips in order, speed applied) as one 16 kHz mono WAV,
 * padded with a second of silence: whisper refuses inputs shorter than one second.
 */
export function timelineWavArgs(clips: Timeline['clips'], media: Record<string, MediaEntry>, out: string): string[] {
  const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
  const f: string[] = [];
  clips.forEach((c, i) => {
    const m = media[c.mediaId];
    args.push('-ss', (c.inMs / 1000).toFixed(3), '-t', ((c.outMs - c.inMs) / 1000).toFixed(3), '-i', m.playable);
    const dur = (Math.max(1, Math.round((c.outMs - c.inMs) / c.speed)) / 1000).toFixed(3);
    f.push(m.hasAudio
      ? `[${i}:a]asetpts=PTS-STARTPTS,${[...atempo(c.speed), 'aresample=16000', 'aformat=sample_fmts=s16:channel_layouts=mono', 'apad', `atrim=0:${dur}`].join(',')}[a${i}]`
      : `anullsrc=r=16000:cl=mono,atrim=0:${dur},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`);
  });
  f.push(`${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1,apad=pad_dur=1[out]`);
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', out);
  return args;
}

function atempo(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${Number(s.toFixed(4))}`);
  return out;
}

/**
 * Transcribes what is said on the timeline and returns caption lines in timeline time.
 * The timeline audio is cut into a few batches (so the model is loaded a few times, not once per clip)
 * and each batch is one WAV in timeline order, so whisper's times are already timeline times.
 */
export async function transcribe(p: Project, size: ModelSize, onStatus: (msg: string, frac: number) => void): Promise<CaptionLine[]> {
  if (!(await invoke<boolean>('whisper_available'))) throw new Error('Mesin subtitle tidak ditemukan. Install ulang GALSURKU Clipper versi terbaru.');
  if (!(await modelReady(size))) throw new Error('Model subtitle belum lengkap. Unduh ulang modelnya di tab Subtitle.');
  const model = await modelPath(size);
  const dir = join(await projectDir(p.id), 'stt');
  await invoke('ensure_dir', { path: dir });
  const threads = await invoke<number>('cpu_count');
  const media = Object.fromEntries(p.media.map((m) => [m.id, m]));
  const clips = p.timeline.clips.filter((c) => media[c.mediaId]);
  if (!clips.length) return [];
  sttCancelled = false;

  // batches of at most 40 clips / 10 minutes, so the command line stays short on Windows
  const batches: { clips: typeof clips; offset: number; dur: number }[] = [];
  let cur: typeof clips = [], curDur = 0, offset = 0;
  for (const c of clips) {
    const d = Math.round((c.outMs - c.inMs) / c.speed);
    if (cur.length && (cur.length >= 40 || curDur + d > 600_000)) { batches.push({ clips: cur, offset, dur: curDur }); offset += curDur; cur = []; curDur = 0; }
    cur.push(c); curDur += d;
  }
  if (cur.length) batches.push({ clips: cur, offset, dur: curDur });
  const total = batches.reduce((s, b) => s + b.dur, 0) || 1;

  const words: Word[] = [];
  let done = 0;
  for (const [bi, b] of batches.entries()) {
    const tag = batches.length > 1 ? ` (bagian ${bi + 1}/${batches.length})` : '';
    const wav = join(dir, `part-${bi}.wav`);
    const base = join(dir, `part-${bi}`);
    try {
      onStatus(`Menyiapkan audio${tag}…`, done / total);
      sttJob = uid();
      await runTool('ffmpeg', timelineWavArgs(b.clips, media, wav), undefined, sttJob);
      if (sttCancelled) throw new Error('Dibatalkan.');
      onStatus(`Mendengarkan ucapan${tag}…`, done / total);
      await invoke('remove_path', { path: `${base}.json` }).catch(() => undefined);
      const progress = (_ms: number, pct: number) => {
        if (pct >= 0) onStatus(`Mendengarkan ucapan${tag}… ${Math.round(pct)}%`, (done + (b.dur * pct) / 100) / total);
      };
      // precise word timing (DTW); older whisper builds without it fall back to normal timing
      sttJob = uid();
      try {
        if (dtwOk === false) throw new Error('skip');
        await runTool('whisper', whisperArgs(model, wav, base, threads, size), progress, sttJob);
        dtwOk = true;
      } catch (e) {
        if (sttCancelled) throw e;
        dtwOk = false;
        sttJob = uid();
        await runTool('whisper', whisperArgs(model, wav, base, threads), progress, sttJob);
      }
      if (sttCancelled) throw new Error('Dibatalkan.');
      let json: string;
      try { json = await invoke<string>('read_text', { path: `${base}.json` }); }
      catch { throw new Error('Hasil subtitle tidak ditemukan. Coba lagi, atau pilih model Cepat.'); }
      for (const w of wordsFromWhisper(json, 0)) {
        if (w.startMs >= b.dur) continue;  // inside the silent padding
        words.push({ text: w.text, startMs: b.offset + w.startMs, endMs: b.offset + Math.min(b.dur, Math.max(w.endMs, w.startMs + 60)) });
      }
    } catch (e) {
      if (sttCancelled) throw new Error('Dibatalkan.');
      throw new Error(`${(e as Error).message}`);
    } finally {
      sttJob = null;
      await invoke('remove_path', { path: wav }).catch(() => undefined);
    }
    done += b.dur;
  }
  onStatus('Merapikan waktu subtitle…', 1);
  // move words that whisper put in a silence to where the talking actually is
  let snapped = words;
  try {
    const used = [...new Set(clips.map((c) => c.mediaId))].map((id) => media[id]).filter((m) => m?.hasAudio);
    const sil: Record<string, Range[]> = {};
    for (const m of used) sil[m.id] = await silencesOf(m, -38);
    snapped = snapWordsToSpeech(words, silencesOnTimeline(clips, sil));
  } catch { /* timing polish is optional */ }
  return groupLines(snapped, uid);
}

let dtwOk: boolean | undefined;

// ---------- font calibration (export text = preview text) ----------

/**
 * libass (export) and the preview canvas size the same font number differently, by a factor that
 * depends on the font. Render a test line with ffmpeg once per font and compare its width with the
 * width the preview measured, so exported text comes out exactly as large as in the preview.
 */
export async function calibrateFont(font: string, bold: boolean, previewWidthAt100: number): Promise<number> {
  const dir = join(await dataDir(), 'cal');
  await invoke('ensure_dir', { path: dir });
  const ass = join(dir, 'cal.ass');
  const raw = join(dir, 'cal.raw');
  await invoke('write_text', {
    path: ass, content: [
      '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 240', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1', '',
      '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\an5\\pos(540,120)\\fn${font}\\fs100\\b${bold ? 1 : 0}}HHHHHHHHHH`, '',
    ].join('\n'),
  });
  await invoke('remove_path', { path: raw }).catch(() => undefined);
  await invoke<string>('ffmpeg_log', {
    args: ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x240:d=1:r=1',
      '-vf', `subtitles=filename='${filterPath(ass)}':fontsdir='${filterPath(FONTS_DIR)}',format=gray,scale=1080:1:flags=area`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', raw],
  });
  const bytes = await invoke<number[]>('read_bytes', { path: raw });
  const cols = bytes.map((v, i) => (v > 20 ? i : -1)).filter((i) => i >= 0);
  if (cols.length < 2) return 1;
  const ratio = previewWidthAt100 / (cols[cols.length - 1] - cols[0] + 1);
  return ratio > 0.5 && ratio < 3 ? ratio : 1;
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

export async function enqueueExport(p: Project, opts: { outDir: string; encoder: Encoder; fontScale?: Record<string, number> }) {
  const tl: Timeline = structuredClone(p.timeline);
  if (!tl.clips.length) throw new Error('Timeline masih kosong. Tambahkan video dulu.');
  tl.texts = tl.texts.map((t) => ({ ...t, text: stripEmoji(t.text) })).filter((t) => t.text);
  tl.captions.lines = tl.captions.lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, text: stripEmoji(w.text) })).filter((w) => w.text) })).filter((l) => l.words.length);
  await invoke('ensure_dir', { path: opts.outDir });
  const id = uid();
  let assFile: string | undefined;
  if (tl.texts.length || tl.captions.lines.length) {
    assFile = join(await projectDir(p.id), `export-${id}.ass`);
    const fs = opts.fontScale ?? {};
    await invoke('write_text', { path: assFile, content: buildAss(tl, (font, bold) => fs[`${font}|${bold ? 1 : 0}`] ?? 1) });
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
