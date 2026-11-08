// Small FFmpeg helpers shared by import, thumbnails, speech-to-text and export.

export type Encoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';
export const ENCODER_ORDER: Encoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

/**
 * Quality 0.4..1 (40-100 %). Lower = smaller file: the bitrate cap and the constant-quality target
 * both move. For shorts ~70 % looks clean on a phone at a fraction of the size.
 */
export function qualityBitrate(fps: number, quality: number): number {
  const base = fps >= 50 ? 16000 : 12000;
  const q = Math.min(1, Math.max(0.4, quality));
  return Math.round(base * Math.pow(q, 1.6));
}

export function encoderArgs(enc: Encoder, bitrateK: number, quality = 1): string[] {
  const q = Math.min(1, Math.max(0.4, quality));
  const b = `${bitrateK}k`, max = `${Math.round(bitrateK * 1.4)}k`, buf = `${bitrateK * 2}k`;
  const crf = String(Math.round(17 + (1 - q) * 16));     // 100% -> 17, 70% -> 22, 40% -> 27
  const cq = String(Math.round(19 + (1 - q) * 15));
  const common = ['-pix_fmt', 'yuv420p', '-profile:v', 'high'];
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', cq, '-b:v', b, '-maxrate', max, '-bufsize', buf, ...common];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', cq, '-b:v', b, '-maxrate', max, ...common];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, ...common];
    default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-maxrate', max, '-bufsize', buf, ...common];
  }
}

export function encoderProbeArgs(enc: Encoder): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30:d=0.2',
    '-c:v', enc, '-frames:v', '3', '-f', 'null', '-'];
}

/** Remux (no re-encode) so WebView2 can play the file, e.g. OBS MKV -> MP4. */
export function remuxArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-i', src, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', out];
}

/** Contact sheets (10x10 thumbnails of tw x th) decoded from keyframes only, so long files stay quick. */
export function thumbArgs(src: string, outPattern: string, everySec: number, tw: number, th: number): string[] {
  return ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-skip_frame', 'nokey', '-i', src,
    '-vf', `fps=1/${everySec},scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},tile=10x10`,
    '-an', '-fps_mode', 'vfr', '-q:v', '5', outPattern];
}

/** 16 kHz mono WAV of one source range, the input whisper expects. */
export function speechWavArgs(src: string, inMs: number, outMs: number, out: string): string[] {
  return ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-ss', (inMs / 1000).toFixed(3), '-t', ((outMs - inMs) / 1000).toFixed(3),
    '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out];
}

export interface WhisperOpts { dtw?: 'base' | 'small'; careful?: boolean; lang?: string }

/**
 * -ml 1 + -sow: one segment per word, which gives word timing for the highlight style.
 * -dtw: token timestamps aligned with the model's attention, closer to when each word is said.
 * careful: beam search (tries several readings and keeps the best) and a higher no-speech threshold,
 * so quiet or overlapping voices (a friend on Discord) are kept instead of dropped as silence.
 */
export function whisperArgs(model: string, wav: string, outBase: string, threads: number, o: WhisperOpts = {}): string[] {
  return ['-m', model, '-f', wav, '-l', o.lang ?? 'id', '-t', String(Math.max(1, Math.min(8, threads))),
    '-ml', '1', '-sow',
    ...(o.dtw ? ['-dtw', o.dtw] : []),
    ...(o.careful ? ['-bs', '5', '-bo', '5', '-nth', '0.8', '--prompt', 'Obrolan santai main game bareng teman di Discord.'] : []),
    '-oj', '-of', outBase, '-pp'];
}

/**
 * One whisper run over many short WAV files (the model is loaded once). Each file is decoded on its own,
 * with no carry-over context (-mc 0), so a noisy stretch cannot make whisper jump past the rest of a
 * 30-second window. Results land next to each input as <file>.json.
 */
export function whisperChunksArgs(model: string, wavs: string[], threads: number, o: WhisperOpts = {}): string[] {
  return ['-m', model, '-l', o.lang ?? 'id', '-t', String(Math.max(1, Math.min(8, threads))),
    '-ml', '1', '-sow', '-mc', '0',
    ...(o.dtw ? ['-dtw', o.dtw] : []),
    ...(o.careful ? ['-bs', '5', '-bo', '5', '-nth', '0.8'] : []),
    '-oj', '-pp', ...wavs.flatMap((w) => ['-f', w])];
}

/** Window starts for chunked transcription: `len` ms windows overlapping by `overlap` ms. */
export function chunkPlan(durMs: number, len = 10000, overlap = 1500): { startMs: number; lenMs: number; keepFrom: number; keepTo: number }[] {
  if (durMs <= len + 2000) return [{ startMs: 0, lenMs: durMs, keepFrom: 0, keepTo: durMs }];
  const out: { startMs: number; lenMs: number; keepFrom: number; keepTo: number }[] = [];
  for (let a = 0; a < durMs; a += len - overlap) {
    const l = Math.min(len, durMs - a);
    out.push({ startMs: a, lenMs: l, keepFrom: 0, keepTo: 0 });
    if (a + l >= durMs) break;
  }
  // each word belongs to the window whose middle part it falls in
  out.forEach((c, i) => {
    c.keepFrom = i === 0 ? 0 : c.startMs + overlap / 2;
    c.keepTo = i === out.length - 1 ? durMs : c.startMs + c.lenMs - overlap / 2;
  });
  return out;
}

export function safeName(s: string): string {
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || 'video';
}

/** Emoji cannot be drawn by the export font, so they are removed from rendered text. */
export function stripEmoji(s: string) {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/[ \t]+\n/g, '\n').trim();
}
