// Timeline model + FFmpeg export builder. Pure functions, tested with real ffmpeg.
import { encoderArgs, type Encoder } from './ffmpeg';

export interface Media {
  id: string;
  path: string;       // original file
  playable: string;   // file the player uses
  name: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type Fit = 'fill' | 'fit';

/** A piece of the main (magnetic) video track. */
export interface VideoClip {
  id: string;
  mediaId: string;
  inMs: number;   // source time
  outMs: number;  // source time
  speed: number;  // 0.25..4
  volume: number; // 0..2
  fit: Fit;
}

export interface TextStyle {
  font: string;       // installed font family, e.g. "Segoe UI"
  size: number;       // px on the 1080x1920 canvas
  color: string;      // #rrggbb
  highlight: string;  // #rrggbb, current word in word mode
  outline: number;    // px
  bold: boolean;
  box: boolean;       // dark box behind text
}

export interface TextItem {
  id: string;
  startMs: number;  // timeline time
  endMs: number;
  text: string;
  x: number;        // 0..1, centre of the text
  y: number;        // 0..1
  style: TextStyle;
}

export interface Word { text: string; startMs: number; endMs: number }
export interface CaptionLine { id: string; startMs: number; endMs: number; words: Word[] }

export interface Captions {
  mode: 'line' | 'word';
  y: number;           // 0..1, vertical centre
  style: TextStyle;
  lines: CaptionLine[];
}

/** A sound effect placed on the timeline (soundboard). */
export interface SoundItem {
  id: string;
  file: string;        // absolute path in the library
  name: string;
  startMs: number;     // timeline time
  lengthMs: number;    // how much of the sound plays (<= source length)
  sourceMs: number;    // full length of the file
  volume: number;      // 0..2
}

/** A picture (meme) over the video. */
export interface ImageItem {
  id: string;
  file: string;
  name: string;
  startMs: number;
  endMs: number;
  x: number;       // 0..1 centre
  y: number;       // 0..1 centre
  scale: number;   // width as a share of the canvas width
  aspect: number;  // natural width / height
  animated: boolean;
}

export interface Timeline {
  width: number;   // 1080
  height: number;  // 1920
  fps: 30 | 60;
  clips: VideoClip[];
  texts: TextItem[];
  captions: Captions;
  sounds?: SoundItem[];
  images?: ImageItem[];
}

export const DEFAULT_TEXT: TextStyle = {
  font: 'Segoe UI', size: 72, color: '#ffffff', highlight: '#ffd400', outline: 6, bold: true, box: false,
};

export const DEFAULT_CAPTION: TextStyle = {
  font: 'Segoe UI', size: 80, color: '#ffffff', highlight: '#ffd400', outline: 6, bold: true, box: false,
};

// ---------- timing ----------

export const clipDuration = (c: VideoClip) => Math.max(1, Math.round((c.outMs - c.inMs) / c.speed));

export function clipStarts(clips: VideoClip[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of clips) { out.push(t); t += clipDuration(c); }
  return out;
}

export const timelineDuration = (tl: Pick<Timeline, 'clips'>) => tl.clips.reduce((s, c) => s + clipDuration(c), 0);

/** Which clip plays at timeline time t, and the matching source time. */
export function locate(clips: VideoClip[], t: number): { index: number; sourceMs: number; startMs: number } | null {
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clipDuration(clips[i]);
    if (t < start + d || i === clips.length - 1) {
      const local = Math.max(0, Math.min(d, t - start));
      return { index: i, sourceMs: clips[i].inMs + local * clips[i].speed, startMs: start };
    }
    start += d;
  }
  return null;
}

/** Split the clip under timeline time t into two. Returns the new list, or null if t is too close to an edge. */
export function splitAt(clips: VideoClip[], t: number, newId: string): VideoClip[] | null {
  const loc = locate(clips, t);
  if (!loc) return null;
  const c = clips[loc.index];
  const cut = Math.round(loc.sourceMs);
  if (cut - c.inMs < 100 || c.outMs - cut < 100) return null;
  const a = { ...c, outMs: cut };
  const b = { ...c, id: newId, inMs: cut };
  return [...clips.slice(0, loc.index), a, b, ...clips.slice(loc.index + 1)];
}

// ---------- ASS subtitles ----------

function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '').padEnd(6, '0');
  const a = alpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(ms: number): string {
  ms = Math.max(0, Math.round(ms));
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function assEscape(s: string): string {
  return s.replace(/\\/g, '\u29F5').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\r?\n/g, '\\N');
}

function overrides(st: TextStyle, x: number, y: number, W: number, H: number): string {
  const tags = [
    `\\an5`, `\\pos(${Math.round(x * W)},${Math.round(y * H)})`,
    `\\fn${st.font.replace(/[\\{}]/g, '')}`, `\\fs${Math.round(st.size)}`, `\\b${st.bold ? 1 : 0}`,
    `\\c${assColor(st.color)}&`, `\\3c&H000000&`, `\\shad0`,
    // with the Boxed style (BorderStyle 3) the border becomes a padded box
    st.box ? `\\3a&H60&\\bord18` : `\\3a&H00&\\bord${st.outline}`,
  ];
  return `{${tags.join('')}}`;
}

/** Captions + free text as one ASS file on a W x H canvas. */
export function buildAss(tl: Timeline): string {
  const W = tl.width, H = tl.height;
  const lines: string[] = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Segoe UI,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,-1,0,0,0,100,100,0,0,1,6,0,5,60,60,60,1',
    'Style: Boxed,Segoe UI,64,&H00FFFFFF,&H00FFFFFF,&H60000000,&H60000000,-1,0,0,0,100,100,0,0,3,18,0,5,60,60,60,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer: number, a: number, b: number, st: TextStyle, text: string) => {
    if (b <= a) return;
    lines.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${st.box ? 'Boxed' : 'Default'},,0,0,0,,${text}`);
  };

  const cap = tl.captions;
  for (const line of cap.lines) {
    const pre = overrides(cap.style, 0.5, cap.y, W, H);
    const plain = assEscape(line.words.map((w) => w.text).join(' '));
    if (cap.mode === 'line' || !line.words.length) {
      ev(1, line.startMs, line.endMs, cap.style, pre + plain);
      continue;
    }
    // one event per word window; the current word gets the highlight colour
    const ws = line.words;
    if (ws[0].startMs > line.startMs) ev(1, line.startMs, ws[0].startMs, cap.style, pre + plain);
    ws.forEach((w, i) => {
      const a = Math.max(line.startMs, w.startMs);
      const b = i + 1 < ws.length ? Math.max(a, ws[i + 1].startMs) : line.endMs;
      const text = ws.map((x, j) => (j === i
        ? `{\\c${assColor(cap.style.highlight)}&}${assEscape(x.text)}{\\c${assColor(cap.style.color)}&}`
        : assEscape(x.text))).join(' ');
      ev(1, a, b, cap.style, pre + text);
    });
  }
  for (const t of tl.texts) ev(2, t.startMs, t.endMs, t.style, overrides(t.style, t.x, t.y, W, H) + assEscape(t.text));
  return lines.join('\n') + '\n';
}

// ---------- export ----------

export interface RenderSpec {
  tl: Timeline;
  media: Record<string, Media>;
  encoder: Encoder;
  bitrateK: number;
  assFile?: string;   // written by the caller from buildAss()
  fontsDir?: string;  // e.g. C:/Windows/Fonts
  outPath: string;
}

/** Escape for a filter option value inside single quotes. Only app-controlled paths go here. */
export function filterPath(p: string): string {
  if (p.includes("'")) throw new Error(`Path tidak boleh berisi tanda petik: ${p}`);
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${Number(s.toFixed(4))}`);
  return out;
}

export function renderArgs(spec: RenderSpec): string[] {
  const { tl } = spec;
  const W = tl.width, H = tl.height, F = tl.fps;
  if (!tl.clips.length) throw new Error('Timeline masih kosong.');
  const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
  const f: string[] = [];
  tl.clips.forEach((c, i) => {
    const m = spec.media[c.mediaId];
    if (!m) throw new Error('Media klip tidak ditemukan.');
    args.push('-ss', (c.inMs / 1000).toFixed(3), '-t', ((c.outMs - c.inMs) / 1000).toFixed(3), '-i', m.playable);
    const fit = c.fit === 'fit'
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;
    const sp = c.speed === 1 ? '' : `,setpts=PTS/${Number(c.speed.toFixed(4))}`;
    f.push(`[${i}:v]setpts=PTS-STARTPTS${sp},${fit},setsar=1,fps=${F},format=yuv420p[v${i}]`);
    const dur = (clipDuration(c) / 1000).toFixed(3);
    if (m.hasAudio) {
      const chain = ['asetpts=PTS-STARTPTS', ...atempoChain(c.speed), `volume=${Number(c.volume.toFixed(3))}`,
        'aresample=48000:async=1', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `apad`, `atrim=0:${dur}`];
      f.push(`[${i}:a]${chain.join(',')}[a${i}]`);
    } else {
      f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
  });
  f.push(`${tl.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${tl.clips.length}:v=1:a=1[cv][ca]`);
  let v = 'cv';
  let input = tl.clips.length;
  const total = timelineDuration(tl);

  // meme pictures over the video, each only while it is on the timeline
  (tl.images ?? []).forEach((im, k) => {
    const a = Math.max(0, im.startMs), b = Math.min(total, im.endMs);
    if (b <= a) return;
    const dur = ((b - a) / 1000).toFixed(3);
    if (im.animated) args.push('-ignore_loop', '0', '-t', dur, '-i', im.file);
    else args.push('-loop', '1', '-t', dur, '-framerate', String(F), '-i', im.file);
    const w = Math.max(2, Math.round((W * im.scale) / 2) * 2);
    const x = Math.round(im.x * W - w / 2);
    const hgt = Math.round(w / im.aspect);
    const y = Math.round(im.y * H - hgt / 2);
    const st = (a / 1000).toFixed(3), en = (b / 1000).toFixed(3);
    f.push(`[${input}:v]scale=${w}:-2,format=rgba,setpts=PTS-STARTPTS+${st}/TB[im${k}]`);
    f.push(`[${v}][im${k}]overlay=x=${x}:y=${y}:enable='between(t,${st},${en})':eof_action=pass:format=auto[ov${k}]`);
    v = `ov${k}`;
    input++;
  });
  if (v !== 'cv') { f.push(`[${v}]format=yuv420p[ovf]`); v = 'ovf'; }

  if (spec.assFile) {
    const fd = spec.fontsDir ? `:fontsdir='${filterPath(spec.fontsDir)}'` : '';
    f.push(`[${v}]subtitles=filename='${filterPath(spec.assFile)}'${fd}[sv]`);
    v = 'sv';
  }

  // sound effects mixed over the main audio
  let aOut = 'ca';
  const sfx = (tl.sounds ?? []).filter((s) => s.startMs < total && s.lengthMs > 0);
  if (sfx.length) {
    const labels: string[] = [];
    sfx.forEach((s, k) => {
      args.push('-t', (s.lengthMs / 1000).toFixed(3), '-i', s.file);
      const d = Math.max(0, Math.round(s.startMs));
      f.push(`[${input}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,volume=${Number(s.volume.toFixed(3))},adelay=${d}|${d}[sfx${k}]`);
      labels.push(`[sfx${k}]`);
      input++;
    });
    f.push(`[ca]${labels.join('')}amix=inputs=${sfx.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[mix]`);
    aOut = 'mix';
  }

  args.push('-filter_complex', f.join(';'), '-map', `[${v}]`, '-map', `[${aOut}]`,
    ...encoderArgs(spec.encoder, spec.bitrateK),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', spec.outPath);
  return args;
}

// ---------- speech-to-text (whisper.cpp JSON) ----------

interface WhisperSeg { offsets?: { from: number; to: number }; text?: string }

/**
 * whisper-cli run with `-ml 1 -sow -oj` gives one segment per word.
 * Words are grouped into caption lines: at most `maxWords`, at most `maxMs`, and a new line after
 * sentence punctuation or a pause longer than `gapMs`.
 */
export function wordsFromWhisper(json: string, offsetMs = 0): Word[] {
  const data = JSON.parse(json) as { transcription?: WhisperSeg[] };
  const out: Word[] = [];
  for (const s of data.transcription ?? []) {
    const text = (s.text ?? '').trim();
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) continue; // [MUSIC], (tertawa)
    const a = (s.offsets?.from ?? 0) + offsetMs;
    const b = (s.offsets?.to ?? a) + offsetMs;
    // whisper sometimes glues punctuation as its own segment
    if (/^[.,!?;:…]+$/.test(text) && out.length) { out[out.length - 1].text += text; out[out.length - 1].endMs = b; continue; }
    out.push({ text, startMs: a, endMs: Math.max(b, a + 60) });
  }
  return out;
}

export function groupLines(words: Word[], newId: () => string, maxWords = 4, maxMs = 2200, gapMs = 600): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: Word[] = [];
  const push = () => {
    if (!cur.length) return;
    lines.push({ id: newId(), startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, words: cur });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= maxWords || w.endMs - cur[0].startMs > maxMs || w.startMs - prev.endMs > gapMs)) push();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) push();
  }
  push();
  // keep lines from overlapping and fill short gaps so captions don't flicker
  for (let i = 0; i + 1 < lines.length; i++) {
    const next = lines[i + 1];
    if (next.startMs - lines[i].endMs < 300) lines[i].endMs = next.startMs;
    lines[i].endMs = Math.min(lines[i].endMs, next.startMs);
  }
  return lines;
}

/** Maps caption words from source time of one clip to timeline time (respects split and speed). */
export function sourceToTimeline(clips: VideoClip[], mediaId: string, sourceMs: number): number | null {
  let start = 0;
  for (const c of clips) {
    const d = clipDuration(c);
    if (c.mediaId === mediaId && sourceMs >= c.inMs && sourceMs <= c.outMs) return start + (sourceMs - c.inMs) / c.speed;
    start += d;
  }
  return null;
}
