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
  audioTracks?: number;   // OBS can record mic, game and Discord on separate tracks
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
  zoom?: number;  // 1..3, punch-in
  zx?: number;    // 0..1, where the zoom looks (horizontal)
  zy?: number;    // 0..1 (vertical)
  trans?: ClipTrans;  // transition from the previous clip into this one
}

export type ClipTrans = 'none' | 'punch' | 'shake' | 'flash' | 'blur' | 'fade';
export const CLIP_TRANS_MS: Record<ClipTrans, number> = { none: 0, punch: 280, shake: 450, flash: 180, blur: 200, fade: 250 };

/** How a clip looks `lt` ms after it starts (and before the next one), shared by preview and export. */
export function clipFx(trans: ClipTrans, lt: number, z0: number) {
  let zoom = z0, dx = 0, dy = 0, blur = 0, white = 0, black = 0;
  const s = lt / 1000;
  if (trans === 'punch' && s < 0.28) zoom = z0 * (1 + 0.25 * Math.pow(1 - s / 0.28, 3));
  if (trans === 'blur' && s < 0.2) { zoom = z0 * (1 + 0.12 * Math.pow(1 - s / 0.2, 2)); if (s < 0.12) blur = 1; }
  if (trans === 'shake') {
    zoom = Math.max(z0, 1.08);
    if (s < 0.45) { dx = 30 * Math.sin(s * 90) * Math.exp(-s * 7); dy = 24 * Math.cos(s * 77) * Math.exp(-s * 7); }
  }
  if (trans === 'flash' && s < 0.18) white = 1 - s / 0.18;
  if (trans === 'fade' && s < 0.25) black = 1 - s / 0.25;
  return { zoom, dx, dy, blur, white, black };
}

/** Background music under the whole video, with optional ducking under speech. */
export type Duck = 'off' | 'light' | 'medium' | 'strong';
export const DUCK_RATIO: Record<Exclude<Duck, 'off'>, number> = { light: 4, medium: 9, strong: 20 };
export const DUCK_LEVEL: Record<Duck, number> = { off: 1, light: 0.55, medium: 0.32, strong: 0.16 };

export interface MusicItem {
  id: string;
  file: string;
  name: string;
  startMs: number;   // timeline time
  inMs: number;      // where in the song it starts
  lengthMs: number;
  sourceMs: number;
  volume: number;    // 0..1.5
  duck: Duck;
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
  anim?: TextAnim;
}

export type TextAnim = 'none' | 'pop' | 'fade' | 'rise' | 'type' | 'shake';

/** Typewriter speed: ms per character, and when the whole text is shown. */
export function typeTiming(chars: number, durMs: number) {
  const per = Math.max(15, Math.min(55, (Math.min(1400, durMs * 0.6)) / Math.max(1, chars)));
  return { per, total: per * chars };
}

/**
 * How animated text looks `lt` ms after it appears (the preview copies what the export's ASS tags do).
 * scale/rot are around the text centre, dy is in canvas pixels at 1080 wide, chars = characters shown.
 */
export function textAnimState(anim: TextAnim | undefined, lt: number, durMs: number, chars: number) {
  let scale = 1, alpha = 1, dy = 0, rot = 0, shown = chars;
  const left = durMs - lt;
  switch (anim) {
    case 'pop':
      if (lt < 140) scale = 0.3 + (1.12 - 0.3) * (lt / 140);
      else if (lt < 240) scale = 1.12 - 0.12 * ((lt - 140) / 100);
      if (left < 150) alpha = Math.max(0, left / 150);
      break;
    case 'fade':
      if (lt < 250) alpha = lt / 250;
      if (left < 200) alpha = Math.min(alpha, Math.max(0, left / 200));
      break;
    case 'rise':
      if (lt < 280) dy = 90 * (1 - lt / 280);
      if (lt < 120) alpha = lt / 120;
      if (left < 150) alpha = Math.min(alpha, Math.max(0, left / 150));
      break;
    case 'shake': {
      const keys: [number, number][] = [[0, 0], [70, 7], [140, -6], [210, 4], [280, 0]];
      for (let i = 0; i + 1 < keys.length; i++) {
        const [t0, a0] = keys[i], [t1, a1] = keys[i + 1];
        if (lt >= t0 && lt < t1) rot = a0 + (a1 - a0) * ((lt - t0) / (t1 - t0));
      }
      break;
    }
    case 'type': {
      const { per } = typeTiming(chars, durMs);
      shown = Math.min(chars, Math.floor(lt / per) + 1);
      break;
    }
  }
  return { scale, alpha, dy, rot, chars: shown };
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

export type Trans = 'none' | 'fade' | 'pop' | 'slide';
export const TRANS_IN_MS = 300;
export const TRANS_OUT_MS = 250;

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
  transIn?: Trans;
  transOut?: Trans;
}

/** Channel logo shown for the whole video. */
export interface Watermark {
  file: string;
  aspect: number;
  corner: 'tl' | 'tr' | 'bl' | 'br';
  scale: number;    // width share of the canvas
  opacity: number;  // 0..1
}

/** Animation state of a picture at local time `lt` (ms since it appeared). Shared by preview and export. */
export function transState(im: Pick<ImageItem, 'transIn' | 'transOut' | 'startMs' | 'endMs'>, lt: number) {
  const d = im.endMs - im.startMs;
  const ti = Math.min(TRANS_IN_MS, d / 2), to = Math.min(TRANS_OUT_MS, d / 2);
  let scale = 1, alpha = 1, dy = 0;
  if (lt < ti) {
    const x = Math.max(0, lt / ti);
    if (im.transIn === 'pop') scale *= easeOutBack(x);
    if (im.transIn === 'fade') alpha *= x;
    if (im.transIn === 'slide') dy += 0.5 * Math.pow(1 - x, 3);
  }
  if (lt > d - to) {
    const x = Math.min(1, (lt - (d - to)) / to);
    if (im.transOut === 'pop') scale *= Math.max(0.01, Math.pow(1 - x, 2));
    if (im.transOut === 'fade') alpha *= 1 - x;
    if (im.transOut === 'slide') dy += 0.5 * x * x;
  }
  return { scale: Math.max(0.01, scale), alpha, dy };
}
const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

export interface Timeline {
  width: number;   // 1080
  height: number;  // 1920
  fps: 30 | 60;
  clips: VideoClip[];
  texts: TextItem[];
  captions: Captions;
  sounds?: SoundItem[];
  images?: ImageItem[];
  watermark?: Watermark | null;
  music?: MusicItem[];
  layers?: VideoLayer[];   // bottom to top, above the main track
  hideMain?: boolean;      // show only the layers (black behind them)
}

/** Part of a frame kept by a crop, as shares cut from each side (0..1). */
export interface Crop { l: number; t: number; r: number; b: number }
/** Where a layer sits on the canvas: centre and size as shares of the canvas. */
export interface Box { x: number; y: number; w: number; h: number }

/**
 * A video layer over the main track. `main` layers show the main track's own picture (they follow its cuts,
 * speed and pause removal), so one recording can be split into several framed parts. `media` layers play
 * another file with their own timing.
 */
export interface VideoLayer {
  id: string;
  name: string;
  source: 'main' | 'media';
  mediaId?: string;   // media layers
  inMs: number;       // media layers: where in the file it starts
  startMs: number;    // timeline time
  endMs: number;
  crop: Crop;
  box: Box;
  opacity: number;    // 0..1
  volume: number;     // media layers, 0..2 (0 = muted)
  hidden?: boolean;
}

export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

/** Size in pixels of the cropped picture of a layer's source. */
export function cropSize(c: Crop, srcW: number, srcH: number) {
  return { w: Math.max(2, srcW * (1 - c.l - c.r)), h: Math.max(2, srcH * (1 - c.t - c.b)) };
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

function overrides(st: TextStyle, x: number, y: number, W: number, H: number, scale = 1): string {
  const tags = [
    `\\an5`, `\\pos(${Math.round(x * W)},${Math.round(y * H)})`,
    `\\fn${st.font.replace(/[\\{}]/g, '')}`, `\\fs${Math.round(st.size * scale)}`, `\\b${st.bold ? 1 : 0}`,
    `\\c${assColor(st.color)}&`, `\\3c&H000000&`, `\\shad0`,
    // with the Boxed style (BorderStyle 3) the border becomes a padded box
    st.box ? `\\3a&H60&\\bord18` : `\\3a&H00&\\bord${st.outline}`,
  ];
  return `{${tags.join('')}}`;
}

/** Captions + free text as one ASS file on a W x H canvas. */
export function buildAss(tl: Timeline, fontScale: (font: string, bold: boolean) => number = () => 1): string {
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
    const pre = overrides(cap.style, 0.5, cap.y, W, H, fontScale(cap.style.font, cap.style.bold));
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
  for (const t of tl.texts) {
    let pre = overrides(t.style, t.x, t.y, W, H, fontScale(t.style.font, t.style.bold));
    let body = assEscape(t.text);
    const px = Math.round(t.x * W), py = Math.round(t.y * H);
    const extra: string[] = [];
    switch (t.anim) {
      case 'pop': extra.push('\\fscx30\\fscy30\\t(0,140,\\fscx112\\fscy112)\\t(140,240,\\fscx100\\fscy100)\\fad(0,150)'); break;
      case 'fade': extra.push('\\fad(250,200)'); break;
      case 'rise':
        pre = pre.replace(`\\pos(${px},${py})`, `\\move(${px},${py + 90},${px},${py},0,280)`);
        extra.push('\\fad(120,150)');
        break;
      case 'shake': extra.push('\\t(0,70,\\frz7)\\t(70,140,\\frz-6)\\t(140,210,\\frz4)\\t(210,280,\\frz0)'); break;
      case 'type': {
        // karaoke reveal: each character switches from invisible (secondary alpha FF) to visible
        const chars = [...t.text].filter((c) => c !== '\n').length;
        const { per } = typeTiming(chars, t.endMs - t.startMs);
        const cs = Math.max(1, Math.round(per / 10));
        extra.push('\\2a&HFF&');
        body = [...t.text].map((c) => (c === '\n' ? '\\N' : `{\\ko${cs}}${assEscape(c)}`)).join('');
        break;
      }
    }
    if (extra.length) pre = pre.replace(/}$/, `${extra.join('')}}`);
    ev(2, t.startMs, t.endMs, t.style, pre + body);
  }
  return lines.join('\n') + '\n';
}

// ---------- export ----------

export interface RenderSpec {
  tl: Timeline;
  media: Record<string, Media>;
  encoder: Encoder;
  bitrateK: number;
  quality?: number;   // 0.4..1
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
    const z = Math.max(1, c.zoom ?? 1);
    let fit: string;
    if (z <= 1.001) {
      fit = c.fit === 'fit'
        ? `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`
        : `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;
    } else {
      // punch-in: scale up, pad if the picture is still smaller than the canvas, then crop around the chosen point
      const zw = Math.round((W * z) / 2) * 2, zh = Math.round((H * z) / 2) * 2;
      const zx = Number((c.zx ?? 0.5).toFixed(4)), zy = Number((c.zy ?? 0.5).toFixed(4));
      fit = `scale=${zw}:${zh}:force_original_aspect_ratio=${c.fit === 'fit' ? 'decrease' : 'increase'}:flags=lanczos,` +
        `pad=w='max(iw,${W})':h='max(ih,${H})':x='(ow-iw)/2':y='(oh-ih)/2':color=black,` +
        `crop=${W}:${H}:x='(iw-${W})*${zx}':y='(ih-${H})*${zy}'`;
    }
    const sp = c.speed === 1 ? '' : `,setpts=PTS/${Number(c.speed.toFixed(4))}`;
    const tr: ClipTrans = i > 0 ? (c.trans ?? 'none') : 'none';
    const next: ClipTrans = tl.clips[i + 1]?.trans ?? 'none';
    const durS = clipDuration(c) / 1000;
    const zx = Number((c.zx ?? 0.5).toFixed(4)), zy = Number((c.zy ?? 0.5).toFixed(4));
    let chain: string;
    if (tr === 'punch' || tr === 'shake' || tr === 'blur') {
      // animated zoom on the fitted canvas (zoompan evaluates per frame; it = time since the clip started)
      const base = c.fit === 'fit'
        ? `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`
        : `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;
      let zExpr = `${z}`, sx = '0', sy = '0';
      if (tr === 'punch') zExpr = `${z}*(1+0.25*pow(1-min(1,it/0.28),3))`;
      if (tr === 'blur') zExpr = `${z}*(1+0.12*pow(1-min(1,it/0.2),2))`;
      if (tr === 'shake') { zExpr = `${Math.max(z, 1.08)}`; sx = `lt(it,0.45)*30*sin(it*90)*exp(-it*7)`; sy = `lt(it,0.45)*24*cos(it*77)*exp(-it*7)`; }
      const x = `max(0,min(iw-iw/zoom,(iw-iw/zoom)*${zx}+${sx}))`, y = `max(0,min(ih-ih/zoom,(ih-ih/zoom)*${zy}+${sy}))`;
      chain = `${base},setsar=1,fps=${F},zoompan=z='${zExpr}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${F}`;
      if (tr === 'blur') chain += `,boxblur=24:enable='lt(t,0.12)'`;
    } else {
      chain = `${fit},setsar=1,fps=${F}`;
    }
    if (tr === 'flash') chain += `,fade=t=in:st=0:d=0.18:color=white`;
    if (tr === 'fade') chain += `,fade=t=in:st=0:d=0.25`;
    if (next === 'fade' && durS > 0.3) chain += `,fade=t=out:st=${(durS - 0.25).toFixed(3)}:d=0.25`;
    f.push(`[${i}:v]setpts=PTS-STARTPTS${sp},${chain},format=yuv420p[v${i}]`);
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
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const num = (n: number) => Number(n.toFixed(5));

  // video layers: crop, scale and place; `main` layers crop the main track's picture itself
  const layerAudio: string[] = [];
  const layers = (tl.layers ?? []).filter((l) => !l.hidden && l.endMs > l.startMs && l.startMs < total && (l.source === 'main' || (l.mediaId && spec.media[l.mediaId])));
  const linked = layers.filter((l) => l.source === 'main');
  if (linked.length || tl.hideMain) {
    const need = linked.length + (tl.hideMain ? 0 : 1);
    if (need === 0) f.push(`[cv]nullsink`);
    else f.push(`[cv]split=${need}${Array.from({ length: need }, (_, i) => `[mc${i}]`).join('')}`);
    if (tl.hideMain) {
      f.push(`color=c=black:s=${W}x${H}:r=${F}:d=${(total / 1000).toFixed(3)},format=yuv420p[mbase]`);
      v = 'mbase';
    } else {
      v = 'mc0';
    }
  }
  let copy = tl.hideMain ? 0 : 1;
  layers.forEach((l, k) => {
    const a = Math.max(0, l.startMs), b = Math.min(total, l.endMs);
    const st = (a / 1000).toFixed(3), en = (b / 1000).toFixed(3);
    const bw = even(l.box.w * W), bh = even(l.box.h * H);
    const x = Math.round(l.box.x * W - bw / 2), y = Math.round(l.box.y * H - bh / 2);
    const fw = num(1 - l.crop.l - l.crop.r), fh = num(1 - l.crop.t - l.crop.b);
    const crop = `crop=w=trunc(iw*${fw}/2)*2:h=trunc(ih*${fh}/2)*2:x=trunc(iw*${num(l.crop.l)}):y=trunc(ih*${num(l.crop.t)})`;
    const look = `${crop},scale=${bw}:${bh}:flags=lanczos,setsar=1,format=rgba${l.opacity < 0.999 ? `,colorchannelmixer=aa=${num(l.opacity)}` : ''}`;
    let src: string;
    if (l.source === 'main') {
      src = `[mc${copy++}]`;
      f.push(`${src}${look}[ly${k}]`);
    } else {
      const m = spec.media[l.mediaId!];
      const dur = ((b - a) / 1000).toFixed(3);
      args.push('-ss', (l.inMs / 1000).toFixed(3), '-t', dur, '-i', m.playable);
      f.push(`[${input}:v]setpts=PTS-STARTPTS,fps=${F},${look},setpts=PTS+${st}/TB[ly${k}]`);
      if (m.hasAudio && l.volume > 0.001) {
        const d = Math.round(a);
        f.push(`[${input}:a]asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,volume=${num(l.volume)},adelay=${d}|${d}[lya${k}]`);
        layerAudio.push(`[lya${k}]`);
      }
      input++;
    }
    f.push(`[${v}][ly${k}]overlay=x=${x}:y=${y}:enable='between(t,${st},${en})':eof_action=pass:format=auto[lv${k}]`);
    v = `lv${k}`;
  });

  // meme pictures over the video, each only while it is on the timeline
  (tl.images ?? []).forEach((im, k) => {
    const a = Math.max(0, im.startMs), b = Math.min(total, im.endMs);
    if (b <= a) return;
    const dur = ((b - a) / 1000).toFixed(3);
    if (im.animated) args.push('-ignore_loop', '0', '-t', dur, '-i', im.file);
    else args.push('-loop', '1', '-t', dur, '-framerate', String(F), '-i', im.file);
    const w = Math.max(2, Math.round((W * im.scale) / 2) * 2);
    const cx = Math.round(im.x * W), cy = Math.round(im.y * H);
    const st = (a / 1000).toFixed(3), en = (b / 1000).toFixed(3);
    const D = (b - a) / 1000;
    const ti = Math.min(TRANS_IN_MS / 1000, D / 2), to = Math.min(TRANS_OUT_MS / 1000, D / 2);
    const tin = im.transIn ?? 'none', tout = im.transOut ?? 'none';
    const chain = [`scale=${w}:-2:flags=lanczos`, 'format=rgba'];
    // fades run first, on the fixed-size picture: newer ffmpeg stops when a frame changes size
    // before a filter that is not set up for it (the pop below changes the size every frame)
    if (tin === 'fade') chain.push(`fade=t=in:st=0:d=${ti}:alpha=1`);
    if (tout === 'fade') chain.push(`fade=t=out:st=${(D - to).toFixed(3)}:d=${to}:alpha=1`);
    // pop: size animated per frame (t = time since the picture appeared); last before overlay
    if (tin === 'pop' || tout === 'pop') {
      const sIn = tin === 'pop' ? `if(lt(t,${ti}),1+2.70158*pow(t/${ti}-1,3)+1.70158*pow(t/${ti}-1,2),1)` : '1';
      const sOut = tout === 'pop' ? `if(gt(t,${(D - to).toFixed(3)}),pow(max(0,1-(t-${(D - to).toFixed(3)})/${to}),2),1)` : '1';
      chain.push(`scale=w='max(2,trunc(${w}*max(0.01,(${sIn})*(${sOut}))/2)*2)':h=-2:eval=frame`);
    }
    chain.push(`setpts=PTS-STARTPTS+${st}/TB`);
    f.push(`[${input}:v]${chain.join(',')}[im${k}]`);
    // slide: vertical offset driven by the main timeline time
    const lt = `(t-${st})`;
    let dy = '0';
    if (tin === 'slide') dy += `+if(lt(${lt},${ti}),${H * 0.5}*pow(1-${lt}/${ti},3),0)`;
    if (tout === 'slide') dy += `+if(gt(${lt},${(D - to).toFixed(3)}),${H * 0.5}*pow((${lt}-${(D - to).toFixed(3)})/${to},2),0)`;
    f.push(`[${v}][im${k}]overlay=x='${cx}-overlay_w/2':y='${cy}-overlay_h/2${dy === '0' ? '' : `+(${dy})`}':enable='between(t,${st},${en})':eof_action=pass:format=auto[ov${k}]`);
    v = `ov${k}`;
    input++;
  });
  const wm = tl.watermark;
  if (wm) {
    args.push('-loop', '1', '-t', (total / 1000).toFixed(3), '-framerate', String(F), '-i', wm.file);
    const w = Math.max(2, Math.round((W * wm.scale) / 2) * 2);
    const m = 40;
    const x = wm.corner.endsWith('l') ? `${m}` : `W-w-${m}`;
    const y = wm.corner.startsWith('t') ? `${m + 60}` : `H-h-${m + 220}`;
    f.push(`[${input}:v]scale=${w}:-2:flags=lanczos,format=rgba,colorchannelmixer=aa=${Number(wm.opacity.toFixed(3))}[wm]`);
    f.push(`[${v}][wm]overlay=x=${x}:y=${y}:eof_action=pass:format=auto[wmo]`);
    v = 'wmo';
    input++;
  }
  if (v !== 'cv' && v !== 'mc0') { f.push(`[${v}]format=yuv420p[ovf]`); v = 'ovf'; }

  if (spec.assFile) {
    const fd = spec.fontsDir ? `:fontsdir='${filterPath(spec.fontsDir)}'` : '';
    f.push(`[${v}]subtitles=filename='${filterPath(spec.assFile)}'${fd}[sv]`);
    v = 'sv';
  }

  // background music (optionally ducked under the main audio) and sound effects, mixed over the main audio
  let aOut = 'ca';
  let main = 'ca';
  const labels: string[] = [];
  const music = (tl.music ?? []).filter((m) => m.startMs < total && m.lengthMs > 300);
  const ducked = music.filter((m) => m.duck !== 'off');
  if (ducked.length) {
    f.push(`[ca]asplit=${ducked.length + 1}[cam]${ducked.map((_, j) => `[sc${j}]`).join('')}`);
    main = 'cam';
  }
  labels.push(...layerAudio);
  let dj = 0;
  music.forEach((m, k) => {
    const len = Math.min(m.lengthMs, total - m.startMs) / 1000;
    args.push('-ss', (m.inMs / 1000).toFixed(3), '-t', len.toFixed(3), '-i', m.file);
    const d = Math.max(0, Math.round(m.startMs));
    const fo = Math.max(0, len - 1.2).toFixed(3);
    f.push(`[${input}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,volume=${Number(m.volume.toFixed(3))},afade=t=in:d=0.6,afade=t=out:st=${fo}:d=1.2,adelay=${d}|${d}[mu${k}]`);
    if (m.duck !== 'off') {
      f.push(`[mu${k}][sc${dj}]sidechaincompress=threshold=0.015:ratio=${DUCK_RATIO[m.duck]}:attack=20:release=450:makeup=1[md${k}]`);
      labels.push(`[md${k}]`);
      dj++;
    } else {
      labels.push(`[mu${k}]`);
    }
    input++;
  });
  const sfx = (tl.sounds ?? []).filter((s) => s.startMs < total && s.lengthMs > 0);
  if (sfx.length) {
    sfx.forEach((s, k) => {
      args.push('-t', (s.lengthMs / 1000).toFixed(3), '-i', s.file);
      const d = Math.max(0, Math.round(s.startMs));
      f.push(`[${input}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,volume=${Number(s.volume.toFixed(3))},adelay=${d}|${d}[sfx${k}]`);
      labels.push(`[sfx${k}]`);
      input++;
    });
  }
  if (labels.length) {
    f.push(`[${main}]${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[mix]`);
    aOut = 'mix';
  }

  args.push('-filter_complex', f.join(';'), '-map', `[${v}]`, '-map', `[${aOut}]`,
    ...encoderArgs(spec.encoder, spec.bitrateK, spec.quality ?? 1),
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
    // drop broken bytes, music notes and other symbols whisper writes for music or noise
    const text = (s.text ?? '').replace(/[\uFFFD\u266A-\u266F]/g, '').trim();
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text) || /^\*.*\*$/.test(text)) continue; // [MUSIC], (tertawa)
    if (!/[\p{L}\p{N}]/u.test(text) && !/^[.,!?;:…]+$/.test(text)) continue;
    const a = (s.offsets?.from ?? 0) + offsetMs;
    const b = (s.offsets?.to ?? a) + offsetMs;
    // whisper sometimes glues punctuation as its own segment
    if (/^[.,!?;:…]+$/.test(text) && out.length) { out[out.length - 1].text += text; out[out.length - 1].endMs = b; continue; }
    out.push({ text, startMs: a, endMs: Math.max(b, a + 60) });
  }
  return out;
}

export function groupLines(words: Word[], newId: () => string, maxWords = 4, maxMs = 2200, gapMs = 600): CaptionLine[] {
  const ws = [...words].sort((x, y) => x.startMs - y.startMs);
  const lines: CaptionLine[] = [];
  let cur: Word[] = [];
  const push = () => {
    if (!cur.length) return;
    lines.push({ id: newId(), startMs: cur[0].startMs, endMs: Math.max(...cur.map((w) => w.endMs)), words: cur });
    cur = [];
  };
  for (const w of ws) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= maxWords || w.endMs - cur[0].startMs > maxMs || w.startMs - prev.endMs > gapMs)) push();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) push();
  }
  push();
  // a line that would last almost nothing (whisper gave its words the same time as the next line)
  // is joined to its neighbour instead of being shown for a blink; nothing is shifted in time
  const out: CaptionLine[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && l.endMs - l.startMs < 150) {
      prev.words.push(...l.words);
      prev.endMs = Math.max(prev.endMs, l.endMs);
    } else {
      out.push(l);
    }
  }
  if (out.length > 1 && out[0].endMs - out[0].startMs < 150) {
    out[1].words.unshift(...out[0].words);
    out[1].startMs = out[0].startMs;
    out.shift();
  }
  // no overlaps (end at the next start), and fill short gaps so captions don't flicker
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    if (next) {
      if (next.startMs - out[i].endMs < 300) out[i].endMs = next.startMs;
      out[i].endMs = Math.min(out[i].endMs, next.startMs);
    }
    if (out[i].endMs - out[i].startMs < 150) out[i].endMs = next ? Math.max(out[i].endMs, Math.min(next.startMs, out[i].startMs + 400)) : out[i].startMs + 400;
    const l = out[i];
    l.words = l.words.map((w) => ({ ...w, startMs: Math.min(Math.max(w.startMs, l.startMs), l.endMs), endMs: Math.min(Math.max(w.endMs, l.startMs), l.endMs) }));
  }
  return out;
}

/** Silent ranges of the source files, moved onto the timeline (respects cuts and speed). */
export function silencesOnTimeline(clips: VideoClip[], silences: Record<string, Range[]>): Range[] {
  const out: Range[] = [];
  let start = 0;
  for (const c of clips) {
    for (const r of silences[c.mediaId] ?? []) {
      const a = Math.max(r.startMs, c.inMs), b = Math.min(r.endMs, c.outMs);
      if (b > a) out.push({ startMs: start + (a - c.inMs) / c.speed, endMs: start + (b - c.inMs) / c.speed });
    }
    start += clipDuration(c);
  }
  // join silences that touch across a cut
  out.sort((x, y) => x.startMs - y.startMs);
  const merged: Range[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.startMs <= last.endMs + 5) last.endMs = Math.max(last.endMs, r.endMs);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * Whisper's word times can be early or late. A word that starts inside a silence is moved to where
 * the talking resumes, and a word that runs on into a long silence is ended where the talking stopped.
 */
export function snapWordsToSpeech(words: Word[], silences: Range[], maxShiftMs = 1500): Word[] {
  if (!silences.length) return words;
  const find = (t: number) => silences.find((r) => t >= r.startMs && t < r.endMs);
  return words.map((w) => {
    let { startMs, endMs } = w;
    const s = find(startMs);
    if (s && s.endMs - startMs <= maxShiftMs) {
      const len = endMs - startMs;
      startMs = s.endMs;
      endMs = Math.max(endMs, startMs + Math.min(len, 600));
    }
    const e = find(endMs - 1);
    if (e && e.startMs > startMs && e.endMs - e.startMs > 400) endMs = Math.max(startMs + 80, e.startMs + 80);
    return { ...w, startMs: Math.round(startMs), endMs: Math.round(endMs) };
  }).reduce<Word[]>((acc, w) => {
    // keep words in order and at least 80 ms apart so the highlight moves word by word
    const prev = acc[acc.length - 1];
    if (prev && w.startMs < prev.startMs + 80) {
      const startMs = prev.startMs + 80;
      acc.push({ ...w, startMs, endMs: Math.max(w.endMs, startMs + 80) });
    } else acc.push(w);
    return acc;
  }, []);
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

// ---------- remove pauses ----------

export interface Range { startMs: number; endMs: number }

/** Parses ffmpeg silencedetect output into silent ranges (source time). */
export function parseSilences(stderr: string, durationMs: number): Range[] {
  const out: Range[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (a) { open = Math.max(0, Number(a[1]) * 1000); continue; }
    const b = /silence_end:\s*([\d.]+)/.exec(line);
    if (b && open !== null) { out.push({ startMs: open, endMs: Number(b[1]) * 1000 }); open = null; }
  }
  if (open !== null) out.push({ startMs: open, endMs: durationMs });
  return out;
}

/** Speech = the parts that are not silent. */
export function invertRanges(silences: Range[], durationMs: number): Range[] {
  const out: Range[] = [];
  let t = 0;
  for (const s of [...silences].sort((a, b) => a.startMs - b.startMs)) {
    if (s.startMs > t) out.push({ startMs: t, endMs: s.startMs });
    t = Math.max(t, s.endMs);
  }
  if (t < durationMs) out.push({ startMs: t, endMs: durationMs });
  return out;
}

/**
 * Cuts the silent parts (at least `minGapMs` long, keeping `padMs` of air on each side) out of every clip.
 * Returns the new clips and a function that maps old timeline times to new ones, so text, captions,
 * memes and sounds can follow the edit.
 */
export function removePauses(
  clips: VideoClip[], silences: Record<string, Range[]>, minGapMs: number, padMs: number, newId: () => string,
): { clips: VideoClip[]; map: (t: number) => number; removedMs: number; cuts: number } {
  const pieces: { clip: VideoClip; from: number }[] = [];  // from = old clip index
  const perOld: { inMs: number; outMs: number; newStart: number }[][] = [];
  let cuts = 0;
  clips.forEach((c, i) => {
    const sil = (silences[c.mediaId] ?? [])
      .map((r) => ({ startMs: Math.max(r.startMs, c.inMs) + padMs, endMs: Math.min(r.endMs, c.outMs) - padMs }))
      .filter((r) => r.endMs - r.startMs + 2 * padMs >= minGapMs && r.endMs > r.startMs);
    // a pause at the very start/end of a clip is cut right to the edge
    for (const r of sil) {
      if (r.startMs - padMs <= c.inMs + 1) r.startMs = c.inMs;
      if (r.endMs + padMs >= c.outMs - 1) r.endMs = c.outMs;
    }
    const keep: Range[] = [];
    let t = c.inMs;
    for (const r of sil.sort((a, b) => a.startMs - b.startMs)) {
      if (r.startMs > t) keep.push({ startMs: t, endMs: r.startMs });
      t = Math.max(t, r.endMs);
      cuts++;
    }
    if (t < c.outMs) keep.push({ startMs: t, endMs: c.outMs });
    const kept = keep.filter((k) => k.endMs - k.startMs >= 120);
    perOld.push([]);
    kept.forEach((k, j) => {
      pieces.push({ clip: { ...c, id: j === 0 ? c.id : newId(), inMs: Math.round(k.startMs), outMs: Math.round(k.endMs), trans: j === 0 ? c.trans : 'none' }, from: i });
    });
  });
  // new start times
  let acc = 0;
  for (const p of pieces) {
    perOld[p.from].push({ inMs: p.clip.inMs, outMs: p.clip.outMs, newStart: acc });
    acc += clipDuration(p.clip);
  }
  const oldStarts = clipStarts(clips);
  const nextKept = (from: number): number => {
    for (let i = from; i < perOld.length; i++) if (perOld[i].length) return perOld[i][0].newStart;
    return acc;
  };
  const map = (t: number): number => {
    const loc = locate(clips, t);
    if (!loc) return 0;
    const c = clips[loc.index];
    const src = c.inMs + (t - oldStarts[loc.index]) * c.speed;
    for (const k of perOld[loc.index]) {
      if (src < k.inMs) return k.newStart;
      if (src <= k.outMs) return k.newStart + (src - k.inMs) / c.speed;
    }
    return nextKept(loc.index + 1);
  };
  const before = clips.reduce((a, c) => a + clipDuration(c), 0);
  return { clips: pieces.map((p) => p.clip), map, removedMs: before - acc, cuts };
}

/** Moves every timeline item through `map` after an edit that removed time. Items that vanish are dropped. */
export function remapItems(tl: Timeline, map: (t: number) => number) {
  tl.texts = tl.texts.map((x) => ({ ...x, startMs: map(x.startMs), endMs: map(x.endMs) })).filter((x) => x.endMs - x.startMs >= 100);
  tl.images = (tl.images ?? []).map((x) => ({ ...x, startMs: map(x.startMs), endMs: map(x.endMs) })).filter((x) => x.endMs - x.startMs >= 100);
  tl.sounds = (tl.sounds ?? []).map((x) => ({ ...x, startMs: map(x.startMs) }));
  tl.music = (tl.music ?? []).map((x) => ({ ...x, startMs: map(x.startMs) }));
  const total = timelineDuration(tl);
  tl.layers = (tl.layers ?? []).map((x) => ({ ...x, startMs: map(x.startMs), endMs: x.endMs >= total ? x.endMs : map(x.endMs) }));
  tl.captions.lines = tl.captions.lines.map((l) => {
    const words = l.words.map((w) => ({ ...w, startMs: map(w.startMs), endMs: map(w.endMs) })).filter((w) => w.endMs - w.startMs >= 30);
    return { ...l, words, startMs: words[0]?.startMs ?? 0, endMs: words[words.length - 1]?.endMs ?? 0 };
  }).filter((l) => l.words.length);
}
