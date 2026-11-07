// Small FFmpeg helpers shared by import, thumbnails, speech-to-text and export.

export type Encoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';
export const ENCODER_ORDER: Encoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

export function encoderArgs(enc: Encoder, bitrateK: number): string[] {
  const b = `${bitrateK}k`, max = `${Math.round(bitrateK * 1.4)}k`, buf = `${bitrateK * 2}k`;
  const common = ['-pix_fmt', 'yuv420p', '-profile:v', 'high'];
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', b, '-maxrate', max, '-bufsize', buf, ...common];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', b, '-maxrate', max, ...common];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, ...common];
    default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', max, '-bufsize', buf, ...common];
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

export function whisperArgs(model: string, wav: string, outBase: string, threads: number, lang = 'id'): string[] {
  // -ml 1 + -sow: one segment per word, which gives word timing for the highlight style
  return ['-m', model, '-f', wav, '-l', lang, '-t', String(Math.max(1, Math.min(8, threads))),
    '-ml', '1', '-sow', '-oj', '-of', outBase, '-pp'];
}

export function safeName(s: string): string {
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || 'video';
}

/** Emoji cannot be drawn by the export font, so they are removed from rendered text. */
export function stripEmoji(s: string) {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/[ \t]+\n/g, '\n').trim();
}
