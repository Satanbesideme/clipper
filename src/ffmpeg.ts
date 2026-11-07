// Pure builders for FFmpeg argument lists. No Tauri here, so this file is tested with plain Node.

export interface Rect { x: number; y: number; w: number; h: number } // 0..1, relative to source frame

export interface Layout {
  id: string;
  name: string;
  type: 'crop' | 'split';
  main: Rect;
  cam?: Rect;
  camPosition?: 'top' | 'bottom';
  camRatio: number; // share of output height used by the facecam (split only)
}

export type TitlePos = 'top' | 'center' | 'bottom';
export type Encoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';

export interface ExportSpec {
  source: string;
  inMs: number;
  outMs: number;
  layout: Layout;
  width: number;   // 1080
  height: number;  // 1920
  fps: 30 | 60;
  bitrateK: number;
  encoder: Encoder;
  audioTrack: number;
  titleFile?: string;   // text file with the title (utf-8)
  titlePos?: TitlePos;
  fontFile?: string;
  outPath: string;
}

export const OUT_W = 1080;
export const OUT_H = 1920;

/** Aspect (w/h) that a crop region must have to fill an output box without distortion. */
export function cropAspectFor(outW: number, outH: number, srcW: number, srcH: number): number {
  // Region in relative units: (w*srcW)/(h*srcH) must equal outW/outH.
  return (outW / outH) * (srcH / srcW);
}

/** Output pixel heights for the two parts of a split layout, both even. */
export function splitHeights(layout: Layout, outH = OUT_H): { cam: number; main: number } {
  const cam = even(Math.round(outH * layout.camRatio));
  return { cam, main: outH - cam };
}

export function presetLayouts(srcW = 1920, srcH = 1080): Layout[] {
  const centerW = cropAspectFor(OUT_W, OUT_H, srcW, srcH); // relative width at full height
  const split: Layout = {
    id: 'preset-split',
    name: 'Facecam atas + gameplay',
    type: 'split',
    camRatio: 0.4,
    camPosition: 'top',
    main: { x: 0, y: 0, w: 0, h: 1 },
    cam: { x: 0.75, y: 0, w: 0.25, h: 0 },
  };
  const { cam, main } = splitHeights(split);
  const mainW = cropAspectFor(OUT_W, main, srcW, srcH);
  split.main = { x: (1 - mainW) / 2, y: 0, w: mainW, h: 1 };
  const camH = 0.25 / cropAspectFor(OUT_W, cam, srcW, srcH);
  split.cam = { x: 0.75, y: 1 - camH, w: 0.25, h: camH };
  return [
    { id: 'preset-center', name: 'Crop tengah', type: 'crop', camRatio: 0, main: { x: (1 - centerW) / 2, y: 0, w: centerW, h: 1 } },
    split,
  ];
}

function even(n: number): number { return Math.max(2, Math.round(n / 2) * 2); }
function num(n: number): string { return Number(n.toFixed(6)).toString(); }

function cropExpr(r: Rect): string {
  // floor to even pixels so every encoder accepts the size
  return `crop=w=trunc(iw*${num(r.w)}/2)*2:h=trunc(ih*${num(r.h)}/2)*2:x=trunc(iw*${num(r.x)}):y=trunc(ih*${num(r.y)})`;
}

/**
 * Escape a path for use as a filter option value inside single quotes (Windows paths included).
 * Only app-controlled paths go here (fonts, files in the app's cache), never user-named files,
 * because a single quote cannot be escaped reliably inside a filtergraph.
 */
export function filterPath(p: string): string {
  if (p.includes("'")) throw new Error(`Path tidak boleh berisi tanda petik: ${p}`);
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export function videoFilter(spec: ExportSpec): string {
  const { layout, width, height, fps } = spec;
  const parts: string[] = [];
  if (layout.type === 'split' && layout.cam) {
    const h = splitHeights(layout, height);
    parts.push(`[0:v]split=2[srcm][srcc]`);
    parts.push(`[srcm]${cropExpr(layout.main)},scale=${width}:${h.main}:flags=lanczos,setsar=1[m]`);
    parts.push(`[srcc]${cropExpr(layout.cam)},scale=${width}:${h.cam}:flags=lanczos,setsar=1[c]`);
    parts.push(layout.camPosition === 'bottom' ? `[m][c]vstack=inputs=2[stack]` : `[c][m]vstack=inputs=2[stack]`);
  } else {
    parts.push(`[0:v]${cropExpr(layout.main)},scale=${width}:${height}:flags=lanczos,setsar=1[stack]`);
  }
  let last = 'stack';
  if (spec.titleFile && spec.fontFile) {
    const y = spec.titlePos === 'center' ? '(h-text_h)/2' : spec.titlePos === 'bottom' ? 'h-text_h-360' : '200';
    parts.push(
      `[${last}]drawtext=fontfile='${filterPath(spec.fontFile)}':textfile='${filterPath(spec.titleFile)}'` +
      `:fontsize=68:fontcolor=white:line_spacing=10:text_align=C` +
      `:box=1:boxcolor=black@0.55:boxborderw=24:x=(w-text_w)/2:y=${y}[titled]`,
    );
    last = 'titled';
  }
  parts.push(`[${last}]fps=${fps},format=yuv420p[vout]`);
  return parts.join(';');
}

export function encoderArgs(enc: Encoder, bitrateK: number): string[] {
  const b = `${bitrateK}k`, max = `${Math.round(bitrateK * 1.4)}k`, buf = `${bitrateK * 2}k`;
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-profile:v', 'high'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', b, '-maxrate', max, '-profile:v', 'high'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-profile:v', 'high'];
    default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', max, '-bufsize', buf, '-profile:v', 'high'];
  }
}

export function exportArgs(spec: ExportSpec): string[] {
  const start = (spec.inMs / 1000).toFixed(3);
  const dur = ((spec.outMs - spec.inMs) / 1000).toFixed(3);
  return [
    '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1',
    '-ss', start, '-i', spec.source, '-t', dur,
    '-filter_complex', videoFilter(spec),
    '-map', '[vout]', '-map', `0:a:${spec.audioTrack}?`,
    ...encoderArgs(spec.encoder, spec.bitrateK),
    '-af', 'aresample=async=1:first_pts=0',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    spec.outPath,
  ];
}

/** Remux (no re-encode) so WebView2 can play the file, e.g. OBS MKV -> MP4. */
export function remuxArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-i', src, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', out];
}

/** Contact sheets: one thumbnail per `everySec`, 10x10 per sheet, decoded from keyframes only (fast). */
export function thumbArgs(src: string, outPattern: string, everySec = 10): string[] {
  return ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-skip_frame', 'nokey', '-i', src,
    '-vf', `fps=1/${everySec},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=10x10`,
    '-an', '-fps_mode', 'vfr', '-q:v', '5', outPattern];
}

export function encoderProbeArgs(enc: Encoder): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30:d=0.2',
    '-c:v', enc, '-frames:v', '3', '-f', 'null', '-'];
}

export const ENCODER_ORDER: Encoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

/** Parse `-progress` output: returns out_time in ms if the chunk has one. */
export function parseProgress(chunk: string): number | null {
  const m = chunk.match(/out_time_us=(\d+)/g);
  if (!m) return null;
  const last = m[m.length - 1].split('=')[1];
  return Math.floor(Number(last) / 1000);
}

export function safeName(s: string): string {
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || 'klip';
}
