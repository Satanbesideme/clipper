import { icon, drawIcon, type IconName } from './icons';
import { gradeImage, drawVignette, isNeutral, gradeOf, registerLut, lutReady, LOOKS, NEUTRAL, hasColour, parseLut, cssFilterOf, LUT_EXT, type Grade, hasAdvanced, curveTable, LEVELS0, HSL0, BALANCE0, type Levels } from './grade';
import './styles.css';
import { dialog, fileSrc, invoke, isTauri, onDrop, extName, join, baseName, dirName } from './tauri';
import { qualityBitrate } from './ffmpeg';
import { autoEmoji, clearEmoji } from './emoji';
import { AI_MODELS, aiEngineReady, aiJson, aiModelReady, cancelAi, downloadAiModel, findMoments, frameScore, type AiModelId, type Moment } from './ai';
import {
  DEFAULT_CAPTION, DEFAULT_TEXT, clipDuration, clipStarts, locate, splitAt, timelineDuration,
  type CaptionLine, type ImageItem, type Watermark, type SoundItem, type TextItem, type TextStyle, type Trans, type VideoClip, type Word,
  transState, TRANS_IN_MS, textAnimState, unitOf, wordPulse, fadesOf, fadeGain, MUSIC_FADE_IN, MUSIC_FADE_OUT, wordScale, wordColor, lineAnimOf, SHOUT_COLOR, type WordFx, type TextAnim, type CapAnim, clipFx, removePauses, remapItems, invertRanges, DUCK_LEVEL,
  type ClipTrans, type Duck, type MusicItem, type Range, type VideoLayer, type Crop, NO_CROP, cropSize, type Marker, youtubeChapters, type Blend, BLENDS, type LayerGroup, type Tf, tfActive, anchoredCentre, type Mask, type ChromaKey, maskActive,
} from './render';
import {
  IMAGE_EXT, SOUND_EXT, VIDEO_MEME_EXT, addVideoMeme, addMeme, categoriesOf, deleteMeme, deletePad, deleteVideoMeme, importFiles as importLibFiles, loadLibrary, move, saveLibrary, soundOf,
  type Library, type Meme, type Pad, type VideoMeme,
} from './library';
import {
  dataDir, projectDir, deleteProject, duplicateProject, renameProject, type ProjectSummary, flush, listProjects, listVersions, loadVersion, onSaved, snapshotProject, loadProject, loadSettings, newProject, saveProject, saveSettings, uid,
  type MediaEntry, type Project, type Settings,
} from './store';
import {
  ENCODER_LABEL, MODELS, VIDEO_EXT, buildThumbs, cancelExport, detectEncoder, downloadModel, enqueueExport,
  importMedia, modelReady, onQueueChange, queue, thumbPath, transcribe, silencesOf, probeAudio, cancelTranscribe, calibrateFont, runTool,
} from './jobs';

// ================= helpers =================

type Kid = Node | string | null | false | undefined;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.value = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const app = document.getElementById('app')!;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function tc(ms: number, frac = false): string {
  ms = Math.max(0, Math.round(ms));
  const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000), ss = Math.floor((ms % 60000) / 1000);
  const base = `${hh ? `${hh}:` : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
  return frac ? `${base}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}` : base;
}

function toast(msg: string, kind: 'info' | 'error' = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  box.append(t);
  const life = kind === 'error' ? 8000 : 3000;
  setTimeout(() => t.classList.add('out'), life);
  setTimeout(() => t.remove(), life + 400);
}

const APP_NAME = 'Gals Clip Studio';

let lastSavedAt = 0;
let lastSnapshotAt = 0;
/** Saves a version when something changed since the last one. */
async function autoSnapshot(reason: string, force = false) {
  if (!P) return;
  if (!force && lastSavedAt <= lastSnapshotAt) return;
  try {
    await flush();
    await snapshotProject(P, reason);
    lastSnapshotAt = Date.now();
  } catch { /* history is a safety net; never interrupt editing */ }
}

/** The GALSURKU mark: two rings and a diamond. */
function logoMark(size: number, cls = 'mark'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const [r, w] of [[35, 1.6], [23, 1.6]] as const) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', String(w)); c.setAttribute('class', 'mark-ring');
    svg.append(c);
  }
  const d = document.createElementNS(ns, 'path');
  d.setAttribute('d', 'M50 45 L55 50 L50 55 L45 50 Z');
  d.setAttribute('class', 'mark-diamond');
  svg.append(d);
  return svg;
}

const FONTS = ['Segoe UI', 'Bahnschrift', 'Impact', 'Arial', 'Arial Black', 'Verdana', 'Trebuchet MS', 'Georgia', 'Comic Sans MS'];

/** Ready-made caption looks: font, colours, mode, animation and height in one click. */
interface CapTemplate { id: string; name: string; hint: string; style: TextStyle; mode: 'word' | 'line'; anim: CapAnim; y: number; caps: boolean; sample: string }
const CAP_TEMPLATES: CapTemplate[] = [
  { id: 'minimal', name: 'Minimal', hint: 'Tipis dan bersih, satu kalimat sekaligus.', mode: 'line', anim: 'fade', y: 0.78, caps: false, sample: 'cuma mau bilang',
    style: { font: 'Segoe UI', size: 62, color: '#ffffff', highlight: '#ffffff', outline: 3, bold: false, box: false } },
  { id: 'kinetic', name: 'Kinetic', hint: 'Huruf besar, kata yang diucapkan memantul.', mode: 'word', anim: 'bounce', y: 0.62, caps: true, sample: 'GAS TERUS',
    style: { font: 'Arial Black', size: 86, color: '#ffffff', highlight: '#3fc2cc', outline: 8, bold: true, box: false } },
  { id: 'documentary', name: 'Documentary', hint: 'Serif kalem di kotak gelap, seperti film dokumenter.', mode: 'line', anim: 'fade', y: 0.82, caps: false, sample: 'Malam itu…',
    style: { font: 'Georgia', size: 56, color: '#f3efe4', highlight: '#f3efe4', outline: 0, bold: false, box: true } },
  { id: 'gaming', name: 'Gaming', hint: 'Tebal, kuning menyala, muncul dengan pop.', mode: 'word', anim: 'pop', y: 0.6, caps: true, sample: 'CLUTCH!',
    style: { font: 'Impact', size: 104, color: '#ffffff', highlight: '#ffd400', outline: 10, bold: false, box: false } },
  { id: 'podcast', name: 'Podcast', hint: 'Kata muncul satu per satu di kotak, enak untuk ngobrol.', mode: 'word', anim: 'word', y: 0.72, caps: false, sample: 'jadi gini ya',
    style: { font: 'Bahnschrift', size: 70, color: '#ffffff', highlight: '#5bd6c8', outline: 0, bold: true, box: true } },
];

function captionTemplates(): HTMLElement {
  const cap = tl().captions;
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Template'),
    h('div', { class: 'cap-tpl-grid' }, ...CAP_TEMPLATES.map((tp) => {
      const st = tp.style;
      const shadow = st.outline ? `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000` : 'none';
      const words = tp.sample.split(' ');
      return h('button', {
        class: `cap-tpl${cap.preset === tp.id ? ' on' : ''}`, title: tp.hint,
        onclick: () => {
          snapshot();
          cap.style = { ...tp.style }; cap.mode = tp.mode; cap.anim = tp.anim; cap.y = tp.y; cap.caps = tp.caps; cap.preset = tp.id;
          changed({ left: true, inspector: false });
          const l = cap.lines.find((x) => x.endMs > t) ?? cap.lines[0];
          if (l) { seek(l.startMs); play(); setTimeout(() => pause(), Math.min(2500, l.endMs - l.startMs + 300)); }
          toast(`Template ${tp.name} dipasang ke semua subtitle. Masih bisa diubah di bawah.`);
        },
      },
        h('span', { class: 'cap-tpl-sample' },
          h('span', { class: `cap-tpl-text${st.box ? ' boxed' : ''}`, style: `font-family:"${st.font}";font-weight:${st.bold ? 700 : 400};color:${st.color};text-shadow:${shadow}` },
            ...words.map((w, i) => h('span', { style: i === words.length - 1 && tp.mode === 'word' ? `color:${st.highlight}` : '' }, `${w}${i < words.length - 1 ? ' ' : ''}`)))),
        h('span', { class: 'cap-tpl-name' }, tp.name),
      );
    })),
    h('div', { class: 'muted small' }, cap.preset ? (CAP_TEMPLATES.find((x) => x.id === cap.preset)?.hint ?? '') : 'Pilih template, lalu ubah detailnya di bawah kalau perlu.'),
  );
}


/** One-click helpers for the whole subtitle: emojis from the words, and tidy word timing. */
function captionTools(): HTMLElement {
  const cap = tl().captions;
  const has = cap.lines.some((l) => l.words.some((w) => w.emoji));
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Otomatis'),
    h('div', { class: 'quick-grid' },
      h('button', {
        class: 'chip', title: 'Kata seperti "wkwk", "menang", "takut", "gas" dapat emoji 😂 🏆 😱 🔥 (maksimal 1 per baris)',
        onclick: () => { snapshot(); const n = autoEmoji(cap.lines, 1); changed({ left: true }); toast(n ? `${n} emoji dipasang.` : 'Tidak ada kata yang cocok untuk emoji.'); },
      }, '😀 Auto emoji'),
      has ? h('button', { class: 'chip', onclick: () => { snapshot(); const n = clearEmoji(cap.lines); changed({ left: true }); toast(`${n} emoji dihapus.`); } }, 'Hapus emoji') : '',
      h('button', {
        class: 'chip', title: 'Membetulkan kata yang menyala terlalu cepat/lama: urutan waktu dirapikan dan tiap kata menyala minimal 0,12 detik',
        onclick: () => { snapshot(); const n = tidyWordTiming(cap.lines); changed({ left: true }); toast(n ? `Timing ${n} kata dirapikan.` : 'Timing kata sudah rapi.'); },
      }, '⏱ Rapikan timing kata'),
    ),
  );
}

/** Words in order, inside their line, each lit at least 120 ms; a word ends where the next one starts. */
function tidyWordTiming(lines: CaptionLine[]): number {
  let n = 0;
  for (const l of lines) {
    const ws = l.words;
    if (!ws.length) continue;
    const span = Math.max(1, l.endMs - l.startMs);
    const min = Math.min(120, span / ws.length);
    const chars = ws.map((w) => Math.max(1, w.text.length));
    const total = chars.reduce((a, b) => a + b, 0);
    let prev = l.startMs;
    ws.forEach((w, i) => {
      const before = `${w.startMs}|${w.endMs}`;
      // where the word would start if time were shared by length: used when its own start is missing or out of order
      const share = l.startMs + (span * chars.slice(0, i).reduce((a, b) => a + b, 0)) / total;
      let st = Number.isFinite(w.startMs) ? w.startMs : share;
      if (st < prev || st > l.endMs - min * (ws.length - i)) st = Math.max(prev, Math.min(share, l.endMs - min * (ws.length - i)));
      w.startMs = Math.round(Math.max(l.startMs, st));
      prev = w.startMs + min;
      if (`${w.startMs}|${w.endMs}` !== before) n++;
    });
    ws.forEach((w, i) => {
      const end = i + 1 < ws.length ? ws[i + 1].startMs : l.endMs;
      if (w.endMs !== end) { w.endMs = end; n++; }
    });
  }
  return n;
}

const capWordText = (w: Word, caps?: boolean) => `${caps ? w.text.toLocaleUpperCase('id-ID') : w.text}${w.emoji ? ` ${w.emoji}` : ''}`;

// ================= state =================

type SelKind = 'clip' | 'text' | 'line' | 'sound' | 'image' | 'music' | 'layer';
type Sel = { kind: SelKind; id: string } | null;
type LeftTab = 'media' | 'layers' | 'transform' | 'crop' | 'color' | 'music' | 'sound' | 'meme' | 'vmeme' | 'text' | 'captions' | 'ai';

let settings: Settings = { outDir: '', encoder: '', model: 'small' };
let P: Project | null = null;
let sel: Sel = null;
let tab: LeftTab = 'media';
let t = 0;                 // playhead, timeline ms
let playing = false;
let pxPerSec = 60;         // timeline zoom
let scrollX = 0;           // timeline scroll in px
let busy = '';             // long task message (captions, import)
const undoStack: string[] = [];
const redoStack: string[] = [];
const videos = new Map<string, HTMLVideoElement>();
const sheets = new Map<string, HTMLImageElement[]>();

const tl = () => P!.timeline;
const mediaOf = (id: string) => P!.media.find((m) => m.id === id);
const sounds = () => (tl().sounds ??= []);
const images = () => (tl().images ??= []);
const music = () => (tl().music ??= []);
const layers = () => (tl().layers ??= []);
function listOf(kind: SelKind): { id: string }[] {
  return kind === 'clip' ? tl().clips : kind === 'text' ? tl().texts : kind === 'line' ? tl().captions.lines : kind === 'sound' ? sounds() : kind === 'music' ? music() : kind === 'layer' ? layers() : images();
}
const selected = <T extends SelKind>(kind: T) =>
  (sel?.kind === kind ? listOf(kind).find((x) => x.id === sel!.id) : undefined) as
  (T extends 'clip' ? VideoClip : T extends 'text' ? TextItem : T extends 'line' ? CaptionLine : T extends 'sound' ? SoundItem : T extends 'music' ? MusicItem : T extends 'layer' ? VideoLayer : ImageItem) | undefined;
let library: Library | null = null;
/** Items picked together on the timeline (box select, Ctrl/Shift+click), as "kind:id". Main clips stay out: they are magnetic. */
const multi = new Set<string>();
const mkey = (kind: SelKind, id: string) => `${kind}:${id}`;
const isSelected = (kind: SelKind, id: string) => (sel?.kind === kind && sel.id === id) || multi.has(mkey(kind, id));
let marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
let libEdit = false;

/** Call before changing the timeline; records an undo step. */
function snapshot() {
  undoStack.push(JSON.stringify(P!.timeline));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
}
/** Call after changing the timeline. */
function changed(opts: { inspector?: boolean; left?: boolean } = {}) {
  void saveProject(P!);
  t = clamp(t, 0, playheadMax());
  drawTimeline();
  renderFrame();
  if (opts.inspector !== false) renderInspector();
  if (opts.left) renderLeft();
  updateTime();
  const fm = $('#fmt');
  if (fm) fm.textContent = fmtLabel();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(JSON.stringify(P!.timeline));
  P!.timeline = JSON.parse(s);
  sel = null;
  multi.clear();
  changed({ left: true });
}
function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(JSON.stringify(P!.timeline));
  P!.timeline = JSON.parse(s);
  sel = null;
  changed({ left: true });
}

// ================= boot / home =================

async function boot() {
  if (!isTauri()) {
    app.append(h('div', { class: 'center-msg' }, `Buka lewat aplikasi ${APP_NAME}.`));
    return;
  }
  settings = await loadSettings();
  void onDrop((paths) => void dropped(paths));
  // light up the home rings while a file is dragged over the window
  try {
    const wv = window.__TAURI__?.webview.getCurrentWebview() as unknown as { onDragDropEvent(cb: (e: { payload: { type: string } }) => void): Promise<unknown> };
    void wv?.onDragDropEvent((e) => document.body.classList.toggle('dragging', e.payload.type === 'enter' || e.payload.type === 'over'));
  } catch { /* cosmetic */ }
  onQueueChange(renderQueue);
  onSaved((at) => {
    const el = $('#saved');
    if (el) { el.textContent = `Tersimpan ${at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    lastSavedAt = at.getTime();
  });
  // a copy every 3 minutes while editing, kept in the project's history
  setInterval(() => { void autoSnapshot('auto'); }, 180_000);
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onPaste);
  setupTooltips();
  window.addEventListener('resize', () => { layoutPreview(); sizeTimeline(); });
  await renderHome();
  if (!settings.encoder) {
    settings.encoder = await detectEncoder();
    await saveSettings(settings);
    const enc = document.getElementById('hp-enc');
    if (enc && settings.encoder) enc.textContent = ENCODER_LABEL[settings.encoder];
  }
}

async function dropped(paths: string[]) {
  if (P && tab === 'vmeme') {
    const vids = paths.filter((p) => VIDEO_MEME_EXT.includes(extName(p)));
    if (vids.length) { await addVideoMemes(vids); return; }
  }
  const libFiles = paths.filter((p) => SOUND_EXT.includes(extName(p)) || IMAGE_EXT.includes(extName(p)));
  if (libFiles.length && P) await addToLibrary(libFiles);
  const vids = paths.filter((p) => VIDEO_EXT.includes(extName(p)));
  if (!vids.length && libFiles.length) return;
  if (!vids.length) { toast('Format belum didukung. Pakai MP4, MKV, MOV, FLV, atau TS.'); return; }
  if (!P) {
    const p = newProject(vids[0].split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''));
    if (settings.watermark) p.timeline.watermark = { ...settings.watermark };
    await saveProject(p, true);
    await openProject(p.id, vids);
  } else {
    await importFiles(vids, true);
  }
}

/** A blank canvas has no main video; it is as long as what is placed on it. */
const isBlank = () => !!P && !tl().clips.length && tl().background !== undefined;
/** Can things be placed? (a main video, or a blank canvas) */
const canPlace = () => !!P && (tl().clips.length > 0 || tl().background !== undefined);
/** How far the playhead may go: the video's end, or on a blank canvas a minute past the content. */
const playheadMax = () => (isBlank() ? timelineDuration(tl()) + 60_000 : Math.max(0, timelineDuration(tl()) - 1));

// ================= new project: from a video, or a blank canvas =================
const BG_COLORS: { name: string; hex: string }[] = [
  { name: 'Hitam', hex: '#000000' }, { name: 'Charcoal GALSURKU', hex: '#1a1b1b' }, { name: 'Putih', hex: '#ffffff' },
  { name: 'Teal', hex: '#3fc2cc' }, { name: 'Hijau (green screen)', hex: '#00b140' },
];
function closeNewProject() { document.querySelector('.np-overlay')?.remove(); }
function openNewProject(pickVideo: () => Promise<void>) {
  closeNewProject();
  const st = { aspect: '9:16' as Aspect, short: 1080, fps: 30 as 30 | 60, bg: '#1a1b1b', name: 'Proyek baru' };
  const form = h('div', { class: 'np-form', hidden: true });
  const paint = () => {
    form.replaceChildren(
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nama proyek'), h('input', { value: st.name, oninput: (e) => { st.name = (e.target as HTMLInputElement).value; } })),
      h('div', { class: 'label' }, 'Bentuk'),
      h('div', { class: 'canvas-aspects' }, ...ASPECTS.map((a) => h('button', {
        class: `canvas-aspect${st.aspect === a.id ? ' on' : ''}`, title: a.hint, onclick: () => { st.aspect = a.id; paint(); },
      }, h('span', { class: 'ca-box', style: a.wh[0] >= a.wh[1] ? `width:36px;height:${Math.round((36 * a.wh[1]) / a.wh[0])}px` : `height:32px;width:${Math.round((32 * a.wh[0]) / a.wh[1])}px` }), h('span', { class: 'ca-name' }, a.name), h('span', { class: 'ca-hint' }, a.hint)))),
      h('div', { class: 'np-row' },
        h('div', { class: 'np-col' }, h('div', { class: 'label' }, 'Resolusi'),
          h('div', { class: 'seg' }, ...RESOLUTIONS.map((r) => h('button', { class: st.short === r.short ? 'on' : '', onclick: () => { st.short = r.short; paint(); } }, r.name)))),
        h('div', { class: 'np-col' }, h('div', { class: 'label' }, 'Frame rate'),
          h('div', { class: 'seg' }, ...([30, 60] as const).map((f) => h('button', { class: st.fps === f ? 'on' : '', onclick: () => { st.fps = f; paint(); } }, `${f} fps`)))),
      ),
      h('div', { class: 'label' }, 'Latar'),
      h('div', { class: 'swatches' }, ...BG_COLORS.map((c) => h('button', { class: `swatch${st.bg === c.hex ? ' on' : ''}`, style: `background:${c.hex}`, title: c.name, onclick: () => { st.bg = c.hex; paint(); } })),
        h('input', { type: 'color', class: 'swatch-pick', value: st.bg, title: 'Warna lain', onchange: (e) => { st.bg = (e.target as HTMLInputElement).value; paint(); } })),
      h('div', { class: 'muted small mono' }, (() => { const d = canvasDims(st.aspect, st.short); return `${d.w} × ${d.h} px · ${st.fps} fps · durasi mengikuti isi`; })()),
      h('button', { class: 'primary wide with-ico', onclick: () => void createBlankProject(st) }, icon('plus', 16), 'Buat kanvas'),
    );
  };
  paint();
  const overlay = h('div', { class: 'np-overlay', onclick: (e) => { if (e.target === overlay) closeNewProject(); } },
    h('div', { class: 'np-card', role: 'dialog', 'aria-label': 'Proyek baru' },
      h('div', { class: 'row-between' }, h('h2', { class: 'np-title' }, 'Proyek baru'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: closeNewProject }, icon('x', 16))),
      h('div', { class: 'np-options' },
        h('button', { class: 'np-option', onclick: () => { closeNewProject(); void pickVideo(); } },
          h('span', { class: 'np-ico' }, icon('video', 26)),
          h('span', { class: 'np-name' }, 'Dari video'),
          h('span', { class: 'np-hint' }, 'Pilih rekaman OBS atau video yang sudah ada. Kanvas mengikuti videonya.'),
        ),
        h('button', { class: 'np-option', onclick: (e) => { (e.currentTarget as HTMLElement).classList.add('on'); form.hidden = false; overlay.classList.add('expanded'); } },
          h('span', { class: 'np-ico' }, icon('template', 26)),
          h('span', { class: 'np-name' }, 'Kanvas kosong'),
          h('span', { class: 'np-hint' }, 'Mulai dari latar polos: atur bentuk dan resolusi, lalu isi dengan video, layer, teks, meme, dan musik. Panjangnya mengikuti isinya, tanpa batas.'),
        ),
      ),
      form,
    ),
  );
  document.body.append(overlay);
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeNewProject(); window.removeEventListener('keydown', esc); } };
  window.addEventListener('keydown', esc);
}
function canvasDims(aspect: Aspect, short: number) {
  const [aw, ah] = ASPECTS.find((x) => x.id === aspect)!.wh;
  return aw <= ah ? { w: short, h: even((short * ah) / aw) } : { w: even((short * aw) / ah), h: short };
}
/** A blank canvas: chosen size and background, no main video. Its length follows what is put on it. */
async function createBlankProject(st: { aspect: Aspect; short: number; fps: 30 | 60; bg: string; name: string }) {
  const { w, h: hh } = canvasDims(st.aspect, st.short);
  const p = newProject(st.name.trim() || 'Kanvas kosong');
  p.timeline.width = w; p.timeline.height = hh; p.timeline.fps = st.fps; p.timeline.background = st.bg;
  if (settings.watermark) p.timeline.watermark = { ...settings.watermark };
  closeNewProject();
  await saveProject(p, true);
  await openProject(p.id);
  switchTab('media');
  toast('Kanvas kosong siap. Tambah video (jadi video utama) atau layer, teks, meme, musik. Panjang video mengikuti isinya.');
}

/** Saves the preview of the open project as its cover picture on the home page. */
async function saveCover() {
  if (!P || !preview || !preview.width) return;
  try {
    const W = 640, H = Math.round((640 * preview.height) / preview.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d')!.drawImage(preview, 0, 0, W, H);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) return;
    await invoke('write_bytes', { path: join(await projectDir(P.id), 'cover.jpg'), content: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    coverBust.set(P.id, Date.now());
  } catch { /* a cover is a nicety */ }
}
const coverBust = new Map<string, number>();

type HomeFilter = 'recent' | 'all' | 'starred' | 'archived';
let homeFilter: HomeFilter = 'recent';
let homeQuery = '';
const homePicked = new Set<string>();

async function renderHome() {
  if (P && tl().clips.length + layers().length + images().length > 0) await saveCover();
  pause();
  await flush();
  P = null;
  sel = null;
  videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  videos.clear();
  sheets.clear();
  const list = await listProjects();
  const dataD = await dataDir();
  const pick = async () => {
    const files = await dialog().open({ multiple: true, title: 'Pilih rekaman', filters: [{ name: 'Video', extensions: VIDEO_EXT }] });
    const arr = typeof files === 'string' ? [files] : files ?? [];
    if (arr.length) await dropped(arr);
  };
  const starred = new Set(settings.starred ?? []), archived = new Set(settings.archived ?? []);
  const saveFlags = () => { settings.starred = [...starred]; settings.archived = [...archived]; void saveSettings(settings); };
  const when = (iso: string) => {
    const d = new Date(iso), now = new Date();
    const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return `Hari ini, ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
    if (days === 1) return 'Kemarin';
    if (days < 7) return `${days} hari lalu`;
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const aspectLabel = (p: ProjectSummary) => {
    if (!p.width || !p.height) return '';
    const r = p.width / p.height;
    return Math.abs(r - 9 / 16) < 0.02 ? '9:16' : Math.abs(r - 16 / 9) < 0.02 ? '16:9' : Math.abs(r - 1) < 0.02 ? '1:1' : Math.abs(r - 0.8) < 0.02 ? '4:5' : `${p.width}×${p.height}`;
  };
  const view = () => settings.homeView ?? 'grid';
  const sortBy = () => settings.homeSort ?? 'recent';
  const totalMs = list.reduce((n, p) => n + (p.durationMs || 0), 0);
  const exported = await invoke<string[]>('list_dir', { path: settings.outDir }).then((f) => f.filter((x) => /\.(mp4|mkv|mov|webm)$/i.test(x)).length).catch(() => 0);

  /** The cover: the saved preview, else the first frame of the first video, else a placeholder. */
  const cover = (p: ProjectSummary) => {
    const box = h('div', { class: 'hc-img' });
    const dir = join(dataD, 'projects', p.id);
    const fallback = async () => {
      let mid = p.thumbMedia, asp = p.thumbAspect;
      if (!mid) {
        const full = await loadProject(p.id).catch(() => null);
        const m0 = full?.media.find((m) => m.id === full.timeline.clips[0]?.mediaId) ?? full?.media[0];
        mid = m0?.id; asp = m0?.thumbs ? m0.thumbs.tw / m0.thumbs.th : undefined;
      }
      if (!mid) { box.classList.add('empty'); box.replaceChildren(logoMark(34)); return; }
      const url = fileSrc(join(dir, `thumbs_${mid}_001.jpg`));
      box.style.setProperty('--bg', `url("${url}")`);
      box.replaceChildren(h('div', { class: 'hc-sheet', style: `background-image:url("${url}");aspect-ratio:${asp ?? 16 / 9}` }));
    };
    const img = h('img', { alt: '', loading: 'lazy', draggable: 'false' }) as HTMLImageElement;
    img.onload = () => box.style.setProperty('--bg', `url("${img.src}")`);
    img.onerror = () => { img.remove(); void fallback(); };
    img.src = `${fileSrc(join(dir, 'cover.jpg'))}?v=${coverBust.get(p.id) ?? new Date(p.updatedAt).getTime()}`;
    box.append(img);
    return box;
  };

  const projMenu = (e: MouseEvent, p: ProjectSummary) => {
    openMenu(e.clientX, e.clientY, [
      { label: 'Buka', icon: 'forward', run: () => void openProject(p.id) },
      { label: 'Ganti nama…', icon: 'pencil', run: () => void askText(e.clientX, e.clientY, 'Nama proyek', p.name).then(async (n) => { if (n?.trim() && n.trim() !== p.name) { await renameProject(p.id, n.trim()); await renderHome(); } }) },
      { label: 'Duplikat', icon: 'dup', run: async () => { setBusy('Menduplikat…'); await duplicateProject(p.id, `${p.name} (salinan)`); setBusy(''); await renderHome(); } },
      { label: starred.has(p.id) ? 'Hapus bintang' : 'Beri bintang', icon: 'star', run: () => { if (starred.has(p.id)) starred.delete(p.id); else starred.add(p.id); saveFlags(); fill(); } },
      { label: archived.has(p.id) ? 'Keluarkan dari arsip' : 'Arsipkan', icon: 'archive', run: () => { if (archived.has(p.id)) archived.delete(p.id); else archived.add(p.id); saveFlags(); fill(); } },
      'sep',
      { label: 'Hapus proyek', icon: 'trash', danger: true, run: () => void removeProjects([p]) },
    ]);
  };
  const removeProjects = async (ps: ProjectSummary[]) => {
    const msg = ps.length === 1 ? `Hapus proyek "${ps[0].name}"?` : `Hapus ${ps.length} proyek?`;
    if (!(await dialog().ask(`${msg}\nFile rekaman asli tidak ikut terhapus.`, { title: 'Hapus proyek', kind: 'warning' }))) return;
    for (const p of ps) { await deleteProject(p.id); starred.delete(p.id); archived.delete(p.id); homePicked.delete(p.id); }
    saveFlags();
    await renderHome();
  };

  const grid = h('div', { class: 'hm-grid' });
  const head = h('div', { class: 'hm-head' });
  const counts = h('div');
  const shownList = () => {
    const k = homeQuery.trim().toLowerCase();
    let ps = list.filter((p) => !k || p.name.toLowerCase().includes(k));
    if (homeFilter === 'archived') ps = ps.filter((p) => archived.has(p.id));
    else ps = ps.filter((p) => !archived.has(p.id));
    if (homeFilter === 'starred') ps = ps.filter((p) => starred.has(p.id));
    if (homeFilter === 'recent') ps = ps.slice(0, 12);
    const by = sortBy();
    if (by === 'name') ps = [...ps].sort((a, b) => a.name.localeCompare(b.name, 'id'));
    if (by === 'dur') ps = [...ps].sort((a, b) => b.durationMs - a.durationMs);
    return ps;
  };
  const TITLES: Record<HomeFilter, string> = { recent: 'Terbaru', all: 'Semua proyek', starred: 'Berbintang', archived: 'Arsip' };
  let firstFill = true;
  const fill = () => {
    const ps = shownList();
    for (const id of [...homePicked]) if (!list.some((p) => p.id === id)) homePicked.delete(id);
    const picked = list.filter((p) => homePicked.has(p.id));
    head.replaceChildren(
      h('div', { class: 'hm-title' }, h('h1', {}, TITLES[homeFilter]), h('span', { class: 'hm-count' }, String(ps.length))),
      picked.length ? h('div', { class: 'hm-bulk' },
        h('span', {}, `${picked.length} dipilih`),
        h('button', { class: 'hm-pill', onclick: () => { for (const p of picked) { if (homeFilter === 'archived') archived.delete(p.id); else archived.add(p.id); } homePicked.clear(); saveFlags(); fill(); } }, icon('archive', 15), homeFilter === 'archived' ? 'Keluarkan' : 'Arsipkan'),
        h('button', { class: 'hm-pill danger', onclick: () => void removeProjects(picked) }, icon('trash', 15), 'Hapus'),
        h('button', { class: 'hm-pill', onclick: () => { homePicked.clear(); fill(); } }, 'Batal'),
      ) : h('div', { class: 'hm-tools' },
        ps.length ? h('button', { class: 'hm-pill', onclick: () => { for (const p of ps) homePicked.add(p.id); fill(); } }, 'Pilih semua') : '',
        h('label', { class: 'hm-pill hm-select' }, h('select', {
          'aria-label': 'Urutkan', onchange: (e: Event) => { settings.homeSort = (e.target as HTMLSelectElement).value as 'recent'; void saveSettings(settings); fill(); },
        }, ...([['recent', 'Terakhir diedit'], ['name', 'Nama'], ['dur', 'Durasi terpanjang']] as const).map(([v, n]) => h('option', { value: v, selected: sortBy() === v }, n))), icon('chevDown', 14)),
        h('div', { class: 'hm-toggle' },
          h('button', { class: view() === 'grid' ? 'on' : '', 'aria-label': 'Tampilan grid', title: 'Grid', onclick: () => { settings.homeView = 'grid'; void saveSettings(settings); fill(); } }, icon('grid', 17)),
          h('button', { class: view() === 'list' ? 'on' : '', 'aria-label': 'Tampilan list', title: 'List', onclick: () => { settings.homeView = 'list'; void saveSettings(settings); fill(); } }, icon('list', 17)),
        ),
      ),
    );
    grid.className = `hm-grid ${view()}${homePicked.size ? ' picking' : ''}${firstFill ? ' intro' : ''}`;
    if (!ps.length) {
      grid.replaceChildren(list.length && homeFilter !== 'recent'
        ? h('div', { class: 'hm-empty' }, h('div', { class: 'hm-empty-t' }, homeQuery ? 'Tidak ada proyek dengan nama itu' : homeFilter === 'starred' ? 'Belum ada proyek berbintang' : 'Arsip kosong'),
          h('div', { class: 'muted' }, homeFilter === 'starred' ? 'Klik ☆ di kartu proyek untuk menandainya.' : 'Proyek yang diarsipkan tidak muncul di Terbaru, tapi tidak dihapus.'))
        : h('button', { class: 'hm-drop', onclick: () => openNewProject(pick) },
          h('span', { class: 'hm-drop-plus' }, icon('plus', 26)),
          h('span', { class: 'hm-empty-t' }, homeQuery ? 'Tidak ada proyek dengan nama itu' : 'Mulai proyek pertama'),
          h('span', { class: 'muted' }, 'Tarik rekaman OBS ke jendela ini, atau klik untuk memilih video / kanvas kosong.')));
    } else {
      grid.replaceChildren(...ps.map((p, i) => {
        const on = homePicked.has(p.id), star = starred.has(p.id);
        const card = h('article', {
          class: `hc${on ? ' picked' : ''}`, style: `animation-delay:${Math.min(i, 12) * 28}ms`, tabindex: '0',
          onclick: (ev: Event) => {
            const e = ev as MouseEvent;
            if ((e.target as HTMLElement).closest('button')) return;
            if (homePicked.size || e.ctrlKey || e.shiftKey) { if (on) homePicked.delete(p.id); else homePicked.add(p.id); fill(); return; }
            void openProject(p.id);
          },
          oncontextmenu: (e: Event) => { e.preventDefault(); projMenu(e as MouseEvent, p); },
          onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') void openProject(p.id); },
        },
          h('div', { class: 'hc-media' },
            cover(p),
            aspectLabel(p) ? h('span', { class: 'hc-badge hc-aspect' }, aspectLabel(p)) : '',
            h('span', { class: 'hc-badge hc-dur mono' }, tc(p.durationMs)),
            h('button', { class: `hc-star${star ? ' on' : ''}`, 'aria-label': star ? 'Hapus bintang' : 'Beri bintang', title: star ? 'Hapus bintang' : 'Beri bintang', onclick: () => { if (star) starred.delete(p.id); else starred.add(p.id); saveFlags(); fill(); } }, icon('star', 16)),
            archived.has(p.id) ? h('span', { class: 'hc-badge hc-arch' }, 'ARSIP') : '',
            h('span', { class: 'hc-open' }, icon('play', 16), 'Buka'),
          ),
          h('div', { class: 'hc-body' },
            h('button', { class: `hc-check${on ? ' on' : ''}`, 'aria-label': on ? 'Batal pilih' : 'Pilih', onclick: () => { if (on) homePicked.delete(p.id); else homePicked.add(p.id); fill(); } }, on ? icon('check', 14) : ''),
            h('div', { class: 'hc-text' },
              h('div', { class: 'hc-name', title: p.name }, p.name),
              h('div', { class: 'hc-meta' }, icon('calendar', 13), h('span', {}, `Diedit ${when(p.updatedAt)}`), h('span', { class: 'hc-dot' }), h('span', {}, `${p.clips} potongan`)),
            ),
            h('button', { class: 'hc-more', 'aria-label': 'Menu proyek', title: 'Menu', onclick: (e: Event) => projMenu(e as MouseEvent, p) }, icon('more', 18)),
          ),
        );
        return card;
      }));
    }
    counts.replaceChildren(...(['recent', 'all', 'starred', 'archived'] as HomeFilter[]).map((f) => {
      const n = f === 'archived' ? list.filter((p) => archived.has(p.id)).length : f === 'starred' ? list.filter((p) => starred.has(p.id) && !archived.has(p.id)).length : list.filter((p) => !archived.has(p.id)).length;
      const ic: IconName = f === 'recent' ? 'clock' : f === 'all' ? 'grid' : f === 'starred' ? 'star' : 'archive';
      return h('button', { class: `hm-nav${homeFilter === f ? ' on' : ''}`, onclick: () => { homeFilter = f; homePicked.clear(); fill(); } },
        icon(ic, 19), h('span', {}, TITLES[f].replace(' proyek', '')), f === 'recent' ? '' : h('span', { class: 'hm-nav-n' }, String(n)));
    }));
  };
  fill();
  firstFill = false;
  const stat = (k: string, v: string, id?: string) => h('div', { class: 'hp-stat' }, h('span', {}, k), h('span', { class: 'mono', id }, v));
  app.replaceChildren(
    h('main', { class: 'home3' },
      h('aside', { class: 'hm-side' },
        h('div', { class: 'hm-brand' }, logoMark(26), h('span', {}, 'Gals Clip ', h('b', {}, 'Studio'))),
        h('button', { class: 'hm-create hp-new', onclick: () => openNewProject(pick) }, icon('plus', 20), 'Buat baru'),
        h('label', { class: 'hm-search' }, icon('search', 18), h('input', {
          value: homeQuery, placeholder: 'Cari proyek', 'aria-label': 'Cari proyek',
          oninput: (e: Event) => { homeQuery = (e.target as HTMLInputElement).value; if (homeQuery && homeFilter === 'recent') homeFilter = 'all'; fill(); },
        })),
        h('div', { class: 'hm-label' }, 'Filter'),
        counts,
        h('div', { class: 'spacer' }),
        h('div', { class: 'hm-stats' },
          stat('Total durasi', tc(totalMs)),
          stat('Video diekspor', String(exported)),
          stat('Encoder', settings.encoder ? ENCODER_LABEL[settings.encoder] : 'Mengecek…', 'hp-enc'),
        ),
      ),
      h('section', { class: 'hm-main' }, head, grid),
    ),
  );
}

async function openProject(id: string, importNow: string[] = []) {
  const p = await loadProject(id);
  if (!p) { toast('Proyek tidak bisa dibuka.', 'error'); return; }
  P = p;
  lastSnapshotAt = 0; lastSavedAt = 0;
  void snapshotProject(p, 'dibuka').catch(() => undefined);
  p.timeline.sounds ??= [];
  p.timeline.images ??= [];
  p.timeline.music ??= [];
  p.timeline.layers ??= [];
  cropMode = false;
  sel = null;
  t = 0;
  void loadLibrary().then((l) => { library = l; if (tab === 'sound' || tab === 'meme' || tab === 'vmeme') renderLeft(); });
  scrollX = 0;
  undoStack.length = redoStack.length = 0;
  renderEditor();
  for (const m of p.media) void loadSheets(m);
  if (importNow.length) await importFiles(importNow, true);
  fitZoom();
}

// ================= import =================

async function pickAndImport() {
  const files = await dialog().open({ multiple: true, title: 'Tambah video', filters: [{ name: 'Video', extensions: VIDEO_EXT }] });
  const arr = typeof files === 'string' ? [files] : files ?? [];
  if (arr.length) await importFiles(arr, P!.timeline.clips.length === 0);
}

async function importFiles(paths: string[], addToTimeline: boolean) {
  const p = P!;
  for (const path of paths) {
    try {
      setBusy('Menambahkan video…');
      const m = await importMedia(path, setBusy);
      p.media.push(m);
      if (addToTimeline) {
        snapshot();
        tl().clips.push({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 1, fit: Math.abs(Math.log((m.width / m.height) / (tl().width / tl().height))) < 0.35 ? 'fill' : 'fit' });
        if (tl().clips.length === 1 && tl().background === undefined) tl().fps = m.fps >= 50 ? 60 : 30;
      }
      await saveProject(p);
      renderLeft();
      changed();
      fitZoom();
      setBusy('Membuat thumbnail…');
      await buildThumbs(p, m);
      await saveProject(p);
      await loadSheets(m);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }
}

async function loadSheets(m: MediaEntry) {
  if (!m.thumbs.ready || !P) return;
  const imgs: HTMLImageElement[] = [];
  for (let i = 0; i < m.thumbs.sheets; i++) {
    const img = new Image();
    img.src = fileSrc(await thumbPath(P, m, i));
    img.onload = () => { drawTimeline(); if (tab === 'media') renderLeft(); };
    imgs.push(img);
  }
  sheets.set(m.id, imgs);
}

function setBusy(msg: string) {
  busy = msg;
  const el = $('#busy');
  if (el) { el.textContent = msg; el.classList.toggle('show', !!msg); }
}

// ================= editor shell =================

let preview: HTMLCanvasElement;
let tlCanvas: HTMLCanvasElement;

function renderEditor() {
  const p = P!;
  const pd = previewDims();
  preview = h('canvas', { class: 'preview', width: pd.w, height: pd.h, 'aria-label': 'Preview video' });
  tlCanvas = h('canvas', { class: 'tl-canvas', 'aria-label': 'Timeline' });
  app.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'ghost home-btn', title: 'Kembali ke daftar proyek', onclick: () => void renderHome() }, logoMark(22), h('span', {}, 'Proyek')),
      h('input', {
        class: 'title-input', value: p.name, 'aria-label': 'Nama proyek',
        onchange: (e) => { p.name = (e.target as HTMLInputElement).value.trim() || p.name; void saveProject(p); },
      }),
      h('div', { class: 'spacer' }),
      h('span', { id: 'busy', class: 'busy muted small' }),
      h('span', { id: 'saved', class: 'saved muted small', title: 'Proyek tersimpan otomatis setiap ada perubahan' }, 'Tersimpan otomatis'),
      h('div', { class: 'panel-toggles' },
        h('button', { class: 'icon-btn', id: 'tog-left', title: 'Tampilkan / sembunyikan panel kiri', 'aria-label': 'Panel kiri', onclick: () => togglePanel('left') }, icon('panelLeft', 18)),
        h('button', { class: 'icon-btn', id: 'tog-right', title: 'Tampilkan / sembunyikan panel kanan', 'aria-label': 'Panel kanan', onclick: () => togglePanel('right') }, icon('panelRight', 18)),
      ),
      h('button', { class: 'icon-btn help-btn', title: 'Tombol keyboard', 'aria-label': 'Tombol keyboard', onclick: toggleHelp }, icon('help', 18)),
      h('button', { class: 'primary export-btn', id: 'export-btn', onclick: toggleExport }, icon('export', 16), h('span', {}, 'Ekspor')),
    ),
    h('div', { class: 'workspace' },
      h('nav', { class: 'rail', role: 'tablist', 'aria-label': 'Panel' },
        ...RAIL.flatMap(([k, ic, label]) => [RAIL_BREAKS.has(k) ? h('div', { class: 'rail-sep', 'aria-hidden': 'true' }) : null, h('button', {
          role: 'tab', class: railTab(tab) === k ? 'on' : '', 'aria-selected': railTab(tab) === k ? 'true' : 'false', 'data-tab': k, title: label,
          onclick: () => {
            libEdit = false;
            if (railTab(tab) === k && !settings.leftHidden) { togglePanel('left'); return; }
            if (settings.leftHidden) togglePanel('left');
            switchTab(k);
          },
        }, h('span', { class: 'rail-icon', 'aria-hidden': 'true' }, icon(ic, 20)), h('span', { class: 'rail-label' }, label))].filter((x): x is HTMLButtonElement | HTMLDivElement => !!x)),
      ),
      h('aside', { class: 'left' },
        h('div', { class: 'left-head', id: 'left-head' }, TAB_NAME[tab]),
        h('div', { class: 'left-body', id: 'left' }),
        h('div', { class: 'col-resize', 'data-side': 'left', title: 'Tarik untuk mengubah lebar. Klik dua kali untuk ukuran bawaan.', role: 'separator', 'aria-orientation': 'vertical' }),
      ),
      h('section', { class: 'viewer' },
        h('div', { class: 'stage', id: 'stage' }, preview),
        h('div', { class: 'transport' },
          h('span', { class: 'mono small', id: 'time' }),
          h('div', { class: 'transport-mid' },
            h('button', { class: 'icon-btn', title: 'Mundur 1 detik (Shift+←)', 'aria-label': 'Mundur 1 detik', onclick: () => seek(t - 1000) }, icon('back', 17)),
            h('button', { class: 'play', id: 'play', 'aria-label': 'Putar', onclick: togglePlay }, icon('play', 18)),
            h('button', { class: 'icon-btn', title: 'Maju 1 detik (Shift+→)', 'aria-label': 'Maju 1 detik', onclick: () => seek(t + 1000) }, icon('forward', 17)),
          ),
          h('div', { class: 'transport-right' },
            h('button', {
              class: `chip ${safeGuide ? 'on' : ''}`, id: 'safe-btn', title: 'Tandai area yang tertutup tombol dan teks TikTok/Shorts',
              onclick: (e) => { safeGuide = !safeGuide; (e.currentTarget as HTMLElement).classList.toggle('on', safeGuide); renderFrame(); },
            }, icon('safe', 14), h('span', { class: 'chip-label' }, 'Area aman')),
            h('button', { class: 'chip fmt-chip', id: 'fmt', title: 'Ukuran kanvas, resolusi, dan fps', onclick: toggleCanvasPop }, fmtLabel()),
          ),
        ),
      ),
      h('aside', { class: 'right-wrap' },
        h('div', { class: 'col-resize', 'data-side': 'right', title: 'Tarik untuk mengubah lebar. Klik dua kali untuk ukuran bawaan.', role: 'separator', 'aria-orientation': 'vertical' }),
        h('div', { class: 'right', id: 'inspector' }),
      ),
    ),
    h('div', { class: 'tl-resize', id: 'tl-resize', title: 'Tarik untuk mengubah tinggi timeline', role: 'separator', 'aria-orientation': 'horizontal' }),
    h('section', { class: 'timeline' },
      h('div', { class: 'tl-tools' },
        h('button', { class: 'tool icon', title: 'Urungkan (Ctrl+Z)', 'aria-label': 'Urungkan', onclick: undo }, icon('undo', 17)),
        h('button', { class: 'tool icon', title: 'Ulangi (Ctrl+Y)', 'aria-label': 'Ulangi', onclick: redo }, icon('redo', 17)),
        h('span', { class: 'sep' }),
        h('button', { class: 'tool', title: 'Potong di playhead (Ctrl+B)', onclick: splitHere }, icon('split', 16, 'ti'), h('span', { class: 'tlabel' }, 'Split')),
        h('button', { class: 'tool', title: 'Hapus yang dipilih (Delete)', onclick: deleteSelected }, icon('trash', 16, 'ti'), h('span', { class: 'tlabel' }, 'Hapus')),
        h('span', { class: 'sep' }),
        h('button', { class: 'tool', id: 'pause-btn', title: 'Potong semua bagian diam', onclick: togglePausePop }, icon('silence', 16, 'ti'), h('span', { class: 'tlabel' }, 'Hapus jeda')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'tool icon', title: 'Perkecil', 'aria-label': 'Perkecil', onclick: () => zoomBy(0.8) }, icon('minus', 16)),
        h('input', { type: 'range', id: 'zoom', min: 0, max: 100, 'aria-label': 'Zoom timeline', oninput: (e) => setZoomFromSlider(Number((e.target as HTMLInputElement).value)) }),
        h('button', { class: 'tool icon', title: 'Perbesar', 'aria-label': 'Perbesar', onclick: () => zoomBy(1.25) }, icon('plus', 16)),
        h('button', { class: 'tool', title: 'Muat seluruh timeline', onclick: fitZoom }, icon('fit', 15, 'ti'), h('span', { class: 'tlabel' }, 'Pas')),
      ),
      h('div', { class: 'tl-body', id: 'tl-body' }, tlCanvas),
    ),
    h('div', { class: 'export-pop', id: 'export-pop', hidden: true }),
    h('div', { class: 'export-pop pause-pop', id: 'pause-pop', hidden: true }),
    h('div', { class: 'export-pop help-pop', id: 'help-pop', hidden: true }),
    h('div', { class: 'export-pop canvas-pop', id: 'canvas-pop', hidden: true }),
  );
  setupTimeline();
  setupResize();
  setupColResize();
  applyCols();
  setupPreviewDrag();
  renderLeft();
  renderInspector();
  setBusy(busy);
  requestAnimationFrame(() => { layoutPreview(); sizeTimeline(); renderFrame(); updateTime(); });
  new ResizeObserver(() => { layoutPreview(); sizeTimeline(); }).observe($('#stage')!);
}

/** Rail: assets first (what you put in), then editing (what you do to it). Crop lives inside Transform. */
const RAIL: [LeftTab, IconName, string][] = [
  ['media', 'media', 'Media'], ['music', 'music', 'Musik'], ['sound', 'wave', 'Suara'], ['meme', 'meme', 'Meme'], ['vmeme', 'vmeme', 'Video meme'],
  ['transform', 'move', 'Transform'], ['color', 'color', 'Warna'], ['layers', 'layers', 'Layer'], ['text', 'text', 'Teks'], ['captions', 'captions', 'Subtitle'],
  ['ai', 'sparkle', 'AI'],
];
const RAIL_BREAKS = new Set<LeftTab>(['transform', 'ai']);
const TAB_NAME: Record<LeftTab, string> = { media: 'Media', music: 'Musik', sound: 'Suara', meme: 'Meme', vmeme: 'Video meme', transform: 'Transform', crop: 'Crop', color: 'Warna', layers: 'Layer', text: 'Teks', captions: 'Subtitle', ai: 'AI Asisten' };
const railTab = (k: LeftTab): LeftTab => (k === 'crop' ? 'transform' : k);
let safeGuide = false;

function readTlHeight() { try { return Number(localStorage.getItem('tlH')) || 300; } catch { return 300; } }
function setTlHeight(px: number, save = true) {
  const v = Math.round(clamp(px, 170, Math.max(220, window.innerHeight - 380)));
  // a short window gives the timeline less room so the preview stays usable; the saved height comes back when it grows
  const shown = Math.round(Math.min(v, Math.max(170, window.innerHeight * 0.34)));
  document.documentElement.style.setProperty('--tl-h', `${shown}px`);
  if (save) try { localStorage.setItem('tlH', String(v)); } catch { /* per-viewer convenience only */ }
}
setTlHeight(readTlHeight());

// ---------- range sliders show how far they are filled ----------
function paintRange(el: HTMLInputElement) {
  const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
  el.style.setProperty('--fill', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}
document.addEventListener('input', (e) => { const el = e.target; if (el instanceof HTMLInputElement && el.type === 'range') paintRange(el); }, true);
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n instanceof HTMLInputElement && n.type === 'range') paintRange(n);
    else if (n instanceof HTMLElement) n.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(paintRange);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ---------- flexible side panels ----------
const LEFT_DEF = 290, RIGHT_DEF = 310, RAIL_W = 76, MIN_VIEW = 300, GAPS = 50;
/**
 * Puts the saved panel widths on the grid, shrinking them (never the preview) when the window is narrow,
 * and folding the inspector away if there is still no room.
 */
function applyCols() {
  const ws = $('.workspace');
  if (!ws) return;
  const W = window.innerWidth;
  let L = settings.leftHidden ? 0 : clamp(settings.leftW ?? LEFT_DEF, 220, 520);
  let R = settings.rightHidden ? 0 : clamp(settings.rightW ?? RIGHT_DEF, 240, 520);
  const room = W - RAIL_W - MIN_VIEW - GAPS;
  if (L + R > room) {
    const minL = L ? 200 : 0, minR = R ? 220 : 0;
    const shrinkable = (L - minL) + (R - minR);
    const f = shrinkable > 0 ? Math.min(1, (L + R - room) / shrinkable) : 0;
    L = Math.round(L - (L - minL) * f);
    R = Math.round(R - (R - minR) * f);
  }
  const autoHideRight = !!R && L + R > room;
  if (autoHideRight) R = 0;
  // hidden panels are display:none and take no grid cell, so they get no column (and no gap) either
  ws.style.gridTemplateColumns = [`${RAIL_W}px`, L ? `${L}px` : '', 'minmax(0,1fr)', R ? `${R}px` : ''].filter(Boolean).join(' ');
  ws.classList.toggle('no-left', !L);
  ws.classList.toggle('no-right', !R);
  $('#tog-left')?.classList.toggle('on', !!L);
  $('#tog-right')?.classList.toggle('on', !!R);
  const tr = $('#tog-right');
  if (tr) tr.title = autoHideRight ? 'Jendela terlalu sempit untuk panel kanan. Perlebar jendela atau sembunyikan panel kiri.' : 'Tampilkan / sembunyikan panel kanan';
}
function togglePanel(side: 'left' | 'right') {
  if (side === 'left') settings.leftHidden = !settings.leftHidden;
  else settings.rightHidden = !settings.rightHidden;
  void saveSettings(settings);
  applyCols();
  requestAnimationFrame(() => { layoutPreview(); sizeTimeline(); renderFrame(); });
}
function setupColResize() {
  document.querySelectorAll<HTMLElement>('.col-resize').forEach((bar) => {
    const side = bar.dataset.side as 'left' | 'right';
    let start: { x: number; w: number } | null = null;
    bar.addEventListener('pointerdown', (e) => {
      const panel = side === 'left' ? $('.left') : $('.right-wrap');
      start = { x: e.clientX, w: panel?.getBoundingClientRect().width ?? (side === 'left' ? LEFT_DEF : RIGHT_DEF) };
      bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); document.body.classList.add('col-dragging');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!start) return;
      const d = e.clientX - start.x;
      const w = Math.round(clamp(side === 'left' ? start.w + d : start.w - d, 220, 520));
      if (side === 'left') settings.leftW = w; else settings.rightW = w;
      applyCols(); layoutPreview();
    });
    const end = () => {
      if (!start) return;
      start = null; bar.classList.remove('drag'); document.body.classList.remove('col-dragging');
      void saveSettings(settings);
      sizeTimeline(); renderFrame();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => {
      if (side === 'left') settings.leftW = LEFT_DEF; else settings.rightW = RIGHT_DEF;
      void saveSettings(settings); applyCols(); layoutPreview(); sizeTimeline();
    });
  });
}
window.addEventListener('resize', () => {
  if (!$('.workspace')) return;
  setTlHeight(readTlHeight(), false);
  applyCols();
  layoutPreview();
  sizeTimeline();
  renderFrame();
});

function setupResize() {
  const bar = $('#tl-resize');
  if (!bar) return;
  let start: { y: number; h: number } | null = null;
  bar.addEventListener('pointerdown', (e) => { start = { y: e.clientY, h: readTlHeight() }; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); });
  bar.addEventListener('pointermove', (e) => { if (start) { setTlHeight(start.h - (e.clientY - start.y)); layoutPreview(); sizeTimeline(); } });
  const end = () => { start = null; bar.classList.remove('drag'); };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

function toggleHelp() {
  const pop = $('#help-pop');
  if (!pop) return;
  pop.hidden = !pop.hidden;
  if (pop.hidden) return;
  const rows: [string, string][] = [
    ['Spasi', 'Putar / jeda'], ['Ctrl + T', 'Transform (Enter selesai, Esc batal)'], ['C', 'Crop'], ['Ctrl + U', 'Warna'],
    ['Ctrl + C / X / V', 'Salin / potong / tempel'], ['Ctrl + Shift + V', 'Tempel di waktu aslinya'], ['Ctrl + J / D', 'Duplikat'],
    ['Ctrl + [ / ]', 'Layer ke belakang / depan'], ['Ctrl + B', 'Split di playhead'], ['Delete', 'Hapus yang dipilih'],
    ['Ctrl + Z / Ctrl + Y', 'Urungkan / ulangi'], ['Ctrl + S', 'Simpan + salinan versi'], ['Ctrl + E', 'Ekspor'], ['Ctrl + Alt + C', 'Ukuran kanvas'],
    ['Tahan \\', 'Bandingkan tanpa warna'], ['← / →', 'Mundur / maju 1 frame (Shift: 1 detik)'], ['Ctrl + A', 'Pilih semua item'],
    ['J / K / L', 'Putar mundur / stop / maju (tekan lagi: 2×, 4×, 8×)'], ['M', 'Marker (M lagi: ganti nama)'], ['Shift + M / Ctrl + Shift + M', 'Ke marker berikut / sebelumnya'],
    ['I / O', 'Set In / Out (Shift: loncat ke sana)'], ['Ctrl + Shift + X', 'Hapus In/Out'], ['Q / W', 'Buang awal / sisa potongan sampai playhead'],
    ['Klik kanan', 'Menu di timeline dan preview'], ['Ctrl + 0', 'Muat seluruh timeline'], ['Esc', 'Batal pilih / stop preview suara'],
  ];

  pop.replaceChildren(
    h('div', { class: 'row-between' }, h('h3', {}, 'Tombol keyboard'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: toggleHelp }, icon('x', 15))),
    h('div', { class: 'keys' }, ...rows.flatMap(([k, d]) => [h('kbd', {}, k), h('span', {}, d)])),
  );
}

/** Highlights the caption line under the playhead in the Subtitle panel and keeps it in view. */
let lastActiveLine = '';
function markActiveLine() {
  if (tab !== 'captions' || !P) return;
  const line = tl().captions.lines.find((l) => t >= l.startMs && t < l.endMs);
  const id = line?.id ?? '';
  if (id === lastActiveLine) return;
  lastActiveLine = id;
  document.querySelectorAll('.lines li.now').forEach((el) => el.classList.remove('now'));
  if (!id) return;
  const el = document.querySelector(`.lines li[data-line="${id}"]`);
  el?.classList.add('now');
  if (playing) el?.scrollIntoView({ block: 'nearest' });
}

/** Moves caption timing; used by the sync buttons. */
function nudgeLines(lines: CaptionLine[], ms: number) {
  for (const l of lines) {
    l.startMs = Math.max(0, l.startMs + ms);
    l.endMs = Math.max(l.startMs + 100, l.endMs + ms);
    l.words = l.words.map((w) => ({ ...w, startMs: Math.max(0, w.startMs + ms), endMs: Math.max(0, w.endMs + ms) }));
  }
}

function layoutPreview() {
  const stage = $('#stage');
  if (!stage || !preview) return;
  const r = stage.getBoundingClientRect();
  const ar = tl().width / tl().height;
  let hgt = r.height - 16, w = hgt * ar;
  if (w > r.width - 16) { w = r.width - 16; hgt = w / ar; }
  preview.style.width = `${Math.max(10, w)}px`;
  preview.style.height = `${Math.max(10, hgt)}px`;
}

function updateTime() {
  const el = $('#time');
  if (el && P) el.replaceChildren(tc(t, true), h('span', { class: 't-total' }, ` / ${tc(timelineDuration(tl()), true)}`));
}

// ================= left panel =================

function renderLeft() { try { renderLeftInner(); } catch (e) { reportOnce(e); } }

function renderLeftInner() {
  const el = $('#left');
  if (!el || !P) return;
  if (tab === 'media') el.replaceChildren(...mediaPanel());
  else if (tab === 'layers') el.replaceChildren(...layerPanel());
  else if (tab === 'music') el.replaceChildren(...musicPanel());
  else if (tab === 'transform') el.replaceChildren(...transformPanel());
  else if (tab === 'crop') el.replaceChildren(...cropPanel());
  else if (tab === 'color') el.replaceChildren(...colorPanel());
  else if (tab === 'sound') el.replaceChildren(...soundPanel());
  else if (tab === 'vmeme') el.replaceChildren(...videoMemePanel());
  else if (tab === 'meme') el.replaceChildren(...memePanel());
  else if (tab === 'text') el.replaceChildren(...textPanel());
  else if (tab === 'ai') el.replaceChildren(...aiPanel());
  else el.replaceChildren(...captionPanel());
  markAuditionButtons();
}

// ================= stinger =================
let stingerFile = '';
async function stingerPath() {
  if (!stingerFile) stingerFile = join(dirName(await invoke<string>('starter_sfx_dir')), 'stinger', 'galsurku-stinger.mp4');
  return stingerFile;
}

/**
 * Puts the GALSURKU stinger before the first clip. Everything placed on the timeline moves along by the
 * stinger's length, so captions, memes and sounds stay on the moments they belong to.
 */
async function addStinger(atEnd = false) {
  if (!P) return;
  const path = await stingerPath();
  if (!(await invoke<boolean>('exists', { path }))) { toast('File stinger tidak ditemukan di folder aplikasi.', 'error'); return; }
  setBusy('Menyiapkan stinger…');
  try {
    let m = P.media.find((x) => x.path === path);
    if (!m) { m = await importMedia(path, setBusy); P.media.push(m); void buildThumbs(P, m).then(() => saveProject(P!)).then(() => loadSheets(m!)); }
    if (atEnd) {
      if (tl().clips[tl().clips.length - 1]?.mediaId === m.id) { toast('Stinger sudah ada di akhir video.'); return; }
      snapshot();
      tl().clips.push({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 0.8, fit: 'fill', trans: 'fade' });
      changed({ left: true }); fitZoom();
      toast('Stinger dipasang di akhir sebagai penutup.');
      return;
    }
    if (tl().clips[0]?.mediaId === m.id) { toast('Stinger sudah ada di awal video.'); return; }
    snapshot();
    const d = Math.round(m.durationMs);
    const sh = (x: { startMs: number; endMs?: number }) => { x.startMs += d; if (typeof x.endMs === 'number' && x.endMs < UNTIL_END) x.endMs += d; };
    tl().texts.forEach(sh); images().forEach(sh); sounds().forEach(sh); music().forEach(sh);
    layers().forEach((ly) => { if (ly.source === 'media') sh(ly); else if (ly.startMs > 0) sh(ly); });
    tl().captions.lines.forEach((l) => { sh(l); l.words.forEach((w) => { w.startMs += d; w.endMs += d; }); });
    const first = tl().clips[0];
    if (first && (first.trans ?? 'none') === 'none') first.trans = 'fade';   // the stinger ends dark: fade the video in from it
    tl().clips.unshift({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 0.8, fit: 'fill' });
    if (tl().clips.length === 1) tl().fps = 60;
    changed({ left: true });
    fitZoom();
    toast('Stinger dipasang di awal. Subtitle, meme, dan suara ikut bergeser supaya tetap pas.');
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setBusy('');
  }
}

async function saveStingerCopy() {
  try {
    const src = await stingerPath();
    await invoke('ensure_dir', { path: settings.outDir });
    const dest = join(settings.outDir, 'GALSURKU stinger.mp4');
    await invoke('copy_file', { src, dest });
    void invoke('reveal', { path: dest });
    toast(`Disimpan: ${dest}`);
  } catch (e) { toast((e as Error).message, 'error'); }
}

function stingerCard(): HTMLElement {
  const vid = h('video', { class: 'stinger-vid', muted: true, playsinline: true, loop: true, preload: 'metadata' });
  void stingerPath().then((p) => { vid.src = fileSrc(p); vid.muted = true; vid.currentTime = 0.9; }).catch(() => undefined);
  const has = !!P && tl().clips[0] && mediaOf(tl().clips[0].mediaId)?.path === stingerFile && !!stingerFile;
  return h('div', { class: 'stinger-card' },
    h('div', { class: 'stinger-thumb', onpointerenter: () => { vid.currentTime = 0; void vid.play().catch(() => undefined); }, onpointerleave: () => { vid.pause(); vid.currentTime = 0.9; } }, vid),
    h('div', { class: 'stinger-meta' },
      h('div', { class: 'stinger-title' }, 'Stinger GALSURKU'),
      h('div', { class: 'muted small' }, '1,9 dtk · 1080×1920 · dengan suara. Arahkan mouse untuk melihat.'),
      h('div', { class: 'stinger-actions' },
        h('button', { class: 'primary small-btn', disabled: has, onclick: () => void addStinger() }, has ? 'Sudah di awal' : 'Pasang di awal'),
        h('button', { class: 'secondary small-btn', title: 'Sebagai penutup video; subtitle dan lainnya tidak bergeser', onclick: () => void addStinger(true) }, 'Pasang di akhir'),
        h('button', { class: 'ghost small', title: 'Simpan file MP4-nya ke folder ekspor', onclick: () => void saveStingerCopy() }, 'Simpan file'),
      ),
    ),
  );
}

function mediaPanel(): Node[] {
  const p = P!;
  return [
    stingerCard(),
    h('button', { class: 'secondary wide with-ico', onclick: () => void pickAndImport() }, icon('video', 16), 'Tambah video'),
    p.media.length ? h('div', { class: 'media-tiles' },
      ...p.media.map((m) => {
        const thumb = h('div', { class: 'mt-thumb' });
        const img = sheets.get(m.id)?.[0];
        if (img?.complete && img.naturalWidth) {
          thumb.style.backgroundImage = `url("${img.src}")`;
          thumb.style.aspectRatio = `${m.thumbs.tw} / ${m.thumbs.th}`;
        }
        const addMain = () => {
          snapshot();
          tl().clips.push({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 1, fit: Math.abs(Math.log((m.width / m.height) / (tl().width / tl().height))) < 0.35 ? 'fill' : 'fit' });
          changed();
          fitZoom();
        };
        const used = tl().clips.some((c) => c.mediaId === m.id) || layers().some((l) => l.source === 'media' && l.mediaId === m.id);
        return h('div', { class: `media-tile${used ? ' used' : ''}`, title: `${m.path}\nKlik dua kali: tambahkan ke akhir timeline`, ondblclick: addMain },
          h('div', { class: 'mt-frame' }, thumb,
            h('span', { class: 'mt-dur mono' }, tc(m.durationMs)),
            used ? h('span', { class: 'mt-used', title: 'Sudah dipakai di timeline' }) : '',
            h('div', { class: 'mt-actions' },
              h('button', { class: 'mt-btn', 'aria-label': `Jadikan ${m.name} layer`, title: 'Jadikan layer di posisi playhead', onclick: (e: Event) => { e.stopPropagation(); addMediaLayer(m); } }, icon('layers', 15)),
              h('button', { class: 'mt-btn', 'aria-label': `Tambahkan ${m.name} ke timeline`, title: 'Tambahkan ke akhir timeline', onclick: (e: Event) => { e.stopPropagation(); addMain(); } }, icon('plus', 15)),
            ),
          ),
          h('div', { class: 'mt-name' }, m.name),
          h('div', { class: 'mt-meta mono' }, `${m.width}×${m.height} · ${Math.round(m.fps)} fps`),
        );
      }),
    ) : h('p', { class: 'muted small hint-p' }, 'Tarik rekaman dari OBS ke sini, atau klik tombol di atas.'),
  ];
}

const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: 'Putih tebal', style: { color: '#ffffff', outline: 6, box: false, font: 'Segoe UI', bold: true } },
  { name: 'Kotak gelap', style: { color: '#ffffff', box: true, font: 'Segoe UI', bold: true } },
  { name: 'Kuning', style: { color: '#ffd400', outline: 6, box: false, font: 'Bahnschrift', bold: true } },
  { name: 'Impact', style: { color: '#ffffff', outline: 7, box: false, font: 'Impact', bold: false, size: 96 } },
  { name: 'Api', style: { color: '#ffffff', outline: 5, outlineColor: '#3a0a00', box: false, font: 'Impact', bold: false, size: 104, gradient: { from: '#ffe259', to: '#ff5f00' }, shadow: { color: '#ff3c00aa', blur: 24, x: 0, y: 0 } } },
  { name: 'Neon', style: { color: '#7df9ff', outline: 0, box: false, font: 'Bahnschrift', bold: true, size: 90, spacing: 4, shadow: { color: '#00e5ffee', blur: 28, x: 0, y: 0 } } },
  { name: 'Elegan', style: { color: '#ffffff', outline: 0, box: false, font: 'Georgia', bold: false, italic: true, size: 80, spacing: 2, shadow: { color: '#000000aa', blur: 16, x: 0, y: 4 } } },
  { name: 'Komik', style: { color: '#ffd400', outline: 8, outlineColor: '#1a1a1a', box: false, font: 'Comic Sans MS', bold: true, size: 96, shadow: { color: '#000000ff', blur: 0, x: 6, y: 6 } } },
];

function textPanel(): Node[] {
  return [
    h('p', { class: 'muted small hint-p' }, 'Teks muncul di posisi playhead selama 3 detik. Geser di preview untuk memindahkan.'),
    h('div', { class: 'preset-grid' },
      ...[...TEXT_PRESETS, ...(settings.textPresets ?? [])].map((pr) => {
        const st = { ...DEFAULT_TEXT, ...pr.style };
        return h('button', {
          class: 'preset', style: `font-family:"${st.font}";font-weight:${st.bold ? 700 : 400};color:${st.color};${st.box ? 'background:rgba(0,0,0,.6);' : `-webkit-text-stroke:1px #000;`}`,
          onclick: () => addText(st),
        }, pr.name);
      }),
    ),
  ];
}

const CAP_ANIM_NAME: Record<CapAnim, string> = { none: 'Tanpa', pop: 'Pop', fade: 'Fade', rise: 'Naik', shake: 'Goyang', word: 'Per kata', bounce: 'Memantul' };
const CAP_ANIM_HINT: Record<CapAnim, string> = {
  none: 'Baris muncul dan hilang langsung.',
  pop: 'Tiap baris baru muncul membesar lalu pas.',
  fade: 'Tiap baris muncul dan hilang perlahan.',
  rise: 'Tiap baris naik sedikit saat muncul.',
  shake: 'Tiap baris bergoyang sebentar saat muncul.',
  word: 'Kata muncul satu per satu mengikuti ucapan.',
  bounce: 'Kata yang sedang diucapkan membesar sebentar. Cocok dengan gaya Kata menyala.',
};

/** Plays a short stretch so a style change can be seen straight away. */
function previewAt(ms: number, len = 1200) {
  seek(Math.max(0, ms));
  play();
  window.setTimeout(() => pause(), len);
}

function lineAnimBlock(line: CaptionLine): HTMLElement {
  const cap = tl().captions;
  const general = cap.anim ?? 'none';
  const set = (a: CapAnim | undefined) => { snapshot(); line.anim = a; changed({ left: true }); previewAt(line.startMs - 150, Math.min(2500, line.endMs - line.startMs + 300)); };
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Animasi baris ini'),
    h('div', { class: 'anim-grid' },
      h('button', { class: line.anim === undefined ? 'on' : '', title: 'Pakai animasi umum dari panel Subtitle', onclick: () => set(undefined) }, `Umum (${CAP_ANIM_NAME[general]})`),
      ...(['none', 'pop', 'fade', 'rise', 'shake', 'word', 'bounce'] as CapAnim[]).map((a) => h('button', {
        class: line.anim === a ? 'on' : '', title: CAP_ANIM_HINT[a], onclick: () => set(a),
      }, CAP_ANIM_NAME[a])),
    ),
    h('div', { class: 'muted small' }, line.anim === undefined ? 'Baris ini ikut animasi umum. Pilih yang lain untuk baris ini saja.' : 'Baris ini punya animasi sendiri. Pilih "Umum" untuk kembali ikut semua.'),
  );
}

const WORD_FX: { fx: WordFx | undefined; name: string; hint: string }[] = [
  { fx: undefined, name: 'Normal', hint: 'Ikut gaya baris' },
  { fx: 'pop', name: 'Pop', hint: 'Membesar sesaat ketika diucapkan' },
  { fx: 'big', name: 'Besar', hint: 'Lebih besar sepanjang baris' },
  { fx: 'shout', name: 'Teriak', hint: 'Besar, menghentak, dan merah. Cocok saat teriak' },
];
const WORD_COLORS = ['#ffffff', '#ffd400', SHOUT_COLOR, '#ff9f1a', '#38e07b', '#4db8ff', '#ff5fd2'];
/** Words picked in the line inspector (indexes into the selected line). */
let wordPick: { line: string; idx: Set<number> } = { line: '', idx: new Set() };

function wordFxBlock(line: CaptionLine): HTMLElement {
  if (wordPick.line !== line.id) wordPick = { line: line.id, idx: new Set() };
  const picked = [...wordPick.idx].filter((i) => i < line.words.length).sort((a, b) => a - b);
  const words = picked.map((i) => line.words[i]);
  const apply = (patch: Partial<Word>) => {
    if (!words.length) return;
    snapshot();
    for (const w of words) {
      Object.assign(w, patch);
      if (w.fx === undefined) delete w.fx;
      if (w.color === undefined) delete w.color;
    }
    changed({ left: true });
    previewAt(Math.max(line.startMs, words[0].startMs) - 250, 1100);
  };
  const same = <K extends keyof Word>(k: K) => (words.length && words.every((w) => w[k] === words[0][k]) ? words[0][k] : null);
  const color = same('color');
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Gaya per kata'),
    h('div', { class: 'word-chips' }, ...line.words.map((w, i) => h('button', {
      class: `word-chip${wordPick.idx.has(i) ? ' on' : ''}${w.fx || w.color ? ' fx' : ''}`,
      style: w.color || w.fx === 'shout' ? `--wc:${w.color ?? SHOUT_COLOR}` : '',
      title: w.fx ? WORD_FX.find((f) => f.fx === w.fx)?.name ?? '' : 'Klik untuk memilih. Ctrl/Shift + klik untuk beberapa kata.',
      onclick: (ev) => {
        const e = ev as MouseEvent;
        if (e.shiftKey && picked.length) { const a = Math.min(picked[0], i), b = Math.max(picked[picked.length - 1], i); for (let j = a; j <= b; j++) wordPick.idx.add(j); }
        else if (e.ctrlKey || e.metaKey) { if (wordPick.idx.has(i)) wordPick.idx.delete(i); else wordPick.idx.add(i); }
        else wordPick.idx = new Set(wordPick.idx.size === 1 && wordPick.idx.has(i) ? [] : [i]);
        seek(Math.max(line.startMs, w.startMs));
        renderInspector();
      },
    }, w.text))),
    words.length ? h('div', { class: 'stack' },
      h('div', { class: 'anim-grid four' }, ...WORD_FX.map((f) => h('button', {
        class: words.every((w) => w.fx === f.fx) ? 'on' : '',
        title: f.hint, onclick: () => apply({ fx: f.fx }),
      }, f.name))),
      h('div', { class: 'swatches' },
        h('button', { class: `swatch none${words.every((w) => !w.color) ? ' on' : ''}`, title: 'Warna ikut gaya subtitle', onclick: () => apply({ color: undefined }) }, '∅'),
        ...WORD_COLORS.map((c) => h('button', { class: `swatch${color === c ? ' on' : ''}`, style: `background:${c}`, title: c, onclick: () => apply({ color: c }) })),
        h('input', { type: 'color', class: 'swatch-pick', value: color ?? '#ffffff', title: 'Warna lain', onchange: (e) => apply({ color: (e.target as HTMLInputElement).value }) }),
      ),
      h('div', { class: 'muted small' }, `${words.length} kata dipilih: "${words.map((w) => w.text).join(' ')}"`),
    ) : h('div', { class: 'muted small' }, 'Klik kata di atas untuk memberi gaya sendiri, misalnya Teriak untuk kata yang diteriakkan. Animasi umum tetap berlaku untuk kata lain.'),
    line.words.some((w) => w.fx || w.color) ? h('button', {
      class: 'ghost small', onclick: () => { snapshot(); line.words.forEach((w) => { delete w.fx; delete w.color; }); changed({ left: true }); },
    }, 'Hapus gaya kata di baris ini') : h('span'),
  );
}

const ANIM_NAME: Record<TextAnim, string> = { none: 'Tanpa', pop: 'Pop', fade: 'Fade', rise: 'Naik', type: 'Ketik', shake: 'Goyang' };

function addText(style: TextStyle) {
  if (!P) return;
  snapshot();
  const total = Math.max(3000, timelineDuration(tl()));
  const start = isBlank() ? Math.round(t) : Math.round(clamp(t, 0, total - 500));
  const item: TextItem = { id: uid(), startMs: start, endMs: isBlank() ? start + 3000 : Math.min(total, start + 3000), text: 'Ketik teks', x: 0.5, y: 0.2, style: { ...style }, anim: 'pop' };
  tl().texts.push(item);
  sel = { kind: 'text', id: item.id };
  changed();
  setTimeout(() => { const ta = $<HTMLTextAreaElement>('#text-edit'); ta?.focus(); ta?.select(); }, 30);
}

let modelState: { base?: boolean; small?: boolean } = {};
let downloading = -1;

function captionPanel(): Node[] {
  const p = P!;
  const cap = tl().captions;
  const size = settings.model;
  if (modelState[size] === undefined) void modelReady(size).then((ok) => { modelState[size] = ok; if (tab === 'captions') renderLeft(); });
  const ready = modelState[size];
  const hasClips = tl().clips.length > 0;

  const modelSeg = h('div', { class: 'seg' },
    ...(['base', 'small'] as const).map((k) => h('button', {
      class: settings.model === k ? 'on' : '', disabled: downloading >= 0,
      onclick: async () => { settings.model = k; await saveSettings(settings); renderLeft(); },
    }, MODELS[k].label)),
  );

  const action = ready === false
    ? h('button', {
        class: 'primary wide', disabled: downloading >= 0,
        onclick: async () => {
          downloading = 0;
          renderLeft();
          try {
            await downloadModel(size, (f) => { downloading = f; const b = $('#dl-bar'); if (b) b.style.width = `${Math.round(f * 100)}%`; const l = $('#dl-label'); if (l) l.textContent = `Mengunduh model… ${Math.round(f * 100)}%`; });
            modelState[size] = true;
            toast('Model subtitle siap.');
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            downloading = -1;
            renderLeft();
          }
        },
      }, downloading >= 0 ? 'Mengunduh…' : `Unduh model (${MODELS[size].label.replace(/.*\(|\)/g, '')}, sekali saja)`)
    : captionsRunning
      ? h('button', { class: 'secondary wide', onclick: () => { void cancelTranscribe(); } }, 'Batal')
      : h('button', {
          class: 'primary wide', disabled: !hasClips || !ready || !!busy,
          onclick: () => void runCaptions(),
        }, cap.lines.length ? 'Buat ulang subtitle' : 'Buat subtitle otomatis');

  const st = cap.style;
  const styleSet = (patch: Partial<TextStyle>) => { snapshot(); Object.assign(cap.style, patch); changed({ inspector: false }); };

  return [
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Bahasa: Indonesia · jalan offline di PC ini'),
      modelSeg,
      sttOptions(),
      action,
      downloading >= 0 ? h('div', {}, h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', id: 'dl-bar', style: `width:${Math.round(downloading * 100)}%` })), h('div', { class: 'muted small', id: 'dl-label' }, 'Mengunduh model…')) : null,
      !hasClips ? h('div', { class: 'muted small' }, 'Tambahkan video ke timeline dulu.') : null,
    ),
    captionTemplates(),
    captionTools(),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Gaya'),
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: !!cap.caps,
        onchange: (e) => { snapshot(); cap.caps = (e.target as HTMLInputElement).checked; changed({ inspector: false }); },
      }), 'HURUF BESAR SEMUA'),
      h('div', { class: 'seg' },
        h('button', { class: cap.mode === 'word' ? 'on' : '', onclick: () => { snapshot(); cap.mode = 'word'; changed({ left: true, inspector: false }); } }, 'Kata menyala'),
        h('button', { class: cap.mode === 'line' ? 'on' : '', onclick: () => { snapshot(); cap.mode = 'line'; changed({ left: true, inspector: false }); } }, 'Per kalimat'),
      ),
      h('div', { class: 'label' }, 'Animasi'),
      h('div', { class: 'anim-grid' }, ...(['none', 'pop', 'fade', 'rise', 'shake', 'word', 'bounce'] as CapAnim[]).map((a) => h('button', {
        class: (cap.anim ?? 'none') === a ? 'on' : '', title: CAP_ANIM_HINT[a],
        onclick: () => {
          snapshot(); cap.anim = a; changed({ left: true, inspector: false });
          const l = cap.lines.find((x) => x.endMs > t) ?? cap.lines[0];
          if (l && a !== 'none') { seek(l.startMs); play(); setTimeout(() => pause(), Math.min(2500, l.endMs - l.startMs + 300)); }
        },
      }, CAP_ANIM_NAME[a]))),
      h('div', { class: 'muted small' }, CAP_ANIM_HINT[cap.anim ?? 'none']),
      ...styleControls(st, styleSet, cap.mode === 'word'),
      field('Posisi tinggi', h('input', { type: 'range', min: 8, max: 92, value: Math.round(cap.y * 100), oninput: (e) => { cap.y = Number((e.target as HTMLInputElement).value) / 100; void saveProject(p); renderFrame(); }, onchange: () => undefined })),
    ),
    cap.lines.length ? h('div', { class: 'block' },
      h('div', { class: 'row-between' },
        h('div', { class: 'label' }, `${cap.lines.length} baris`),
        h('button', { class: 'danger-ghost small', onclick: async () => { if (await dialog().ask('Hapus semua subtitle?', { title: 'Subtitle', kind: 'warning' })) { snapshot(); cap.lines = []; sel = null; changed({ left: true }); } } }, 'Hapus semua'),
      ),
      h('div', { class: 'sync' },
        h('span', { class: 'label' }, 'Geser semua'),
        ...([-200, -50, 50, 200] as const).map((ms) => h('button', {
          class: 'chip', title: ms < 0 ? 'Subtitle muncul lebih awal' : 'Subtitle muncul lebih lambat',
          onclick: () => { snapshot(); nudgeLines(cap.lines, ms); changed({ left: true, inspector: false }); toast(`Semua subtitle digeser ${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(2)} dtk.`); },
        }, `${ms > 0 ? '+' : '−'}${Math.abs(ms / 1000).toFixed(ms % 100 ? 2 : 1)}`)),
      ),
      h('ol', { class: 'lines' }, ...cap.lines.map((l) => h('li', { 'data-line': l.id, class: sel?.kind === 'line' && sel.id === l.id ? 'sel' : '' },
        h('button', { class: 'line-time mono', title: l.anim || l.words.some((w) => w.fx || w.color) ? 'Baris ini punya gaya sendiri' : '', onclick: () => { sel = { kind: 'line', id: l.id }; seek(l.startMs); renderInspector(); renderLeft(); } }, tc(l.startMs), l.anim || l.words.some((w) => w.fx || w.color) ? h('span', { class: 'own-style' }, '✦') : ''),
        h('input', {
          value: l.words.map((w) => w.text).join(' '), 'aria-label': `Subtitle ${tc(l.startMs)}`,
          onfocus: () => { sel = { kind: 'line', id: l.id }; seek(l.startMs); renderInspector(); },
          onchange: (e) => { snapshot(); setLineText(l, (e.target as HTMLInputElement).value); changed({ inspector: false }); },
        }),
      ))),
    ) : h('span'),
  ];
}

function sttOptions(): HTMLElement {
  const maxTracks = Math.max(1, ...(P?.media ?? []).map((m) => m.audioTracks ?? 1));
  const cur = settings.sttTracks ?? 'all';
  return h('div', { class: 'stack' },
    h('label', { class: 'check' }, h('input', {
      type: 'checkbox', checked: settings.sttCareful ?? true,
      onchange: async (e) => { settings.sttCareful = (e.target as HTMLInputElement).checked; await saveSettings(settings); },
    }), 'Mode cermat: tangkap suara pelan & teman di Discord (sedikit lebih lama)'),
    maxTracks > 1 ? h('div', { class: 'stack' },
      h('div', { class: 'label' }, 'Sumber suara'),
      h('div', { class: 'seg' },
        h('button', { class: cur === 'all' ? 'on' : '', onclick: async () => { settings.sttTracks = 'all'; await saveSettings(settings); renderLeft(); } }, 'Semua track'),
        ...Array.from({ length: maxTracks }, (_, i) => h('button', { class: cur === i ? 'on' : '', onclick: async () => { settings.sttTracks = i; await saveSettings(settings); renderLeft(); } }, `Track ${i + 1}`)),
      ),
      h('div', { class: 'muted small' }, 'Rekaman ini punya beberapa track audio (mis. mic, game, Discord). "Semua track" mendengarkan semuanya.'),
    ) : h('span'),
  );
}

function setLineText(l: CaptionLine, text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) { tl().captions.lines = tl().captions.lines.filter((x) => x.id !== l.id); return; }
  // keep the original word timing when the word count is unchanged, else spread evenly
  if (parts.length === l.words.length) { l.words = l.words.map((w, i) => ({ ...w, text: parts[i] })); return; }
  const d = (l.endMs - l.startMs) / parts.length;
  l.words = parts.map((w, i): Word => ({ text: w, startMs: Math.round(l.startMs + i * d), endMs: Math.round(l.startMs + (i + 1) * d) }));
}

let captionsRunning = false;
async function runCaptions() {
  const p = P!;
  if (tl().captions.lines.length && !(await dialog().ask('Subtitle yang sekarang akan diganti. Lanjut?', { title: 'Buat ulang subtitle', kind: 'warning' }))) return;
  pause();
  await autoSnapshot('sebelum-subtitle', true);
  captionsRunning = true;
  renderLeft();
  try {
    const lines = await transcribe(p, settings.model, (msg, frac) => setBusy(`${msg}${frac >= 0 && !/%$/.test(msg) ? ` ${Math.round(frac * 100)}%` : ''}`), { tracks: settings.sttTracks ?? 'all', careful: settings.sttCareful ?? true });
    snapshot();
    tl().captions.lines = lines;
    changed({ left: true });
    toast(lines.length ? `${lines.length} baris subtitle dibuat. Klik barisnya untuk koreksi.` : 'Tidak ada ucapan yang terdengar.');
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Dibatalkan.') toast('Pembuatan subtitle dibatalkan.');
    else toast(`Subtitle gagal: ${msg}`, 'error');
  } finally {
    captionsRunning = false;
    setBusy('');
    renderLeft();
  }
}

// ================= inspector =================

function field(label: string, control: HTMLElement) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
}

function styleControls(st: TextStyle, set: (p: Partial<TextStyle>) => void, showHighlight: boolean): HTMLElement[] {
  return [
    field('Font', h('select', { onchange: (e) => set({ font: (e.target as HTMLSelectElement).value }) },
      ...FONTS.map((f) => { const o = h('option', { value: f, style: `font-family:"${f}"` }, f); o.selected = f === st.font; return o; }))),
    field(`Ukuran ${st.size}`, h('input', { type: 'range', min: 32, max: 160, value: st.size, onchange: (e) => set({ size: Number((e.target as HTMLInputElement).value) }) })),
    h('div', { class: 'row2' },
      field('Warna', h('input', { type: 'color', value: st.color, onchange: (e) => set({ color: (e.target as HTMLInputElement).value }) })),
      showHighlight ? field('Warna kata aktif', h('input', { type: 'color', value: st.highlight, onchange: (e) => set({ highlight: (e.target as HTMLInputElement).value }) })) : h('span'),
    ),
    h('div', { class: 'seg' },
      h('button', { class: !st.box ? 'on' : '', onclick: () => set({ box: false }) }, 'Garis tepi'),
      h('button', { class: st.box ? 'on' : '', onclick: () => set({ box: true }) }, 'Kotak gelap'),
    ),
    h('div', { class: 'row2' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.bold, onchange: (e) => set({ bold: (e.target as HTMLInputElement).checked }) }), 'Tebal'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!st.italic, onchange: (e) => set({ italic: (e.target as HTMLInputElement).checked || undefined }) }), 'Miring'),
    ),
    typographyBlock(st, set),
  ];
}

/** Typography studio: spacing, line height, stroke colour, shadow, gradient. */
const typoOpen = { v: false };
function typographyBlock(st: TextStyle, set: (p: Partial<TextStyle>) => void): HTMLElement {
  const num = (label: string, v: number, min: number, max: number, step: number, fmt: (x: number) => string, on: (x: number) => void) =>
    field(`${label} ${fmt(v)}`, h('input', { type: 'range', min, max, step, value: v, oninput: (e) => { const x = Number((e.target as HTMLInputElement).value); ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `${label} ${fmt(x)}`; }, onchange: (e) => on(Number((e.target as HTMLInputElement).value)) }));
  const sh = st.shadow, gr = st.gradient;
  const d = h('details', { class: 'adv typo', ontoggle: (e: Event) => { typoOpen.v = (e.target as HTMLDetailsElement).open; } },
    h('summary', {}, h('span', { class: 'label' }, 'Typography studio')),
    num('Spasi huruf', st.spacing ?? 0, -6, 40, 0.5, (x) => `${x}`, (x) => set({ spacing: x || undefined })),
    num('Tinggi baris', st.lineHeight ?? 1.18, 0.8, 2.2, 0.02, (x) => x.toFixed(2), (x) => set({ lineHeight: Math.abs(x - 1.18) < 0.005 ? undefined : x })),
    h('div', { class: 'row2' },
      field('Tebal garis tepi', h('input', { type: 'number', min: 0, max: 30, value: st.outline, onchange: (e) => set({ outline: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) }) })),
      field('Warna garis tepi', h('input', { type: 'color', value: st.outlineColor ?? '#000000', onchange: (e) => set({ outlineColor: (e.target as HTMLInputElement).value }) })),
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!sh, onchange: (e) => set({ shadow: (e.target as HTMLInputElement).checked ? { color: '#000000cc', blur: 12, x: 0, y: 6 } : null }) }), 'Bayangan'),
    sh ? h('div', { class: 'row2' },
      field('Warna', h('input', { type: 'color', value: sh.color.slice(0, 7), onchange: (e) => set({ shadow: { ...sh, color: `${(e.target as HTMLInputElement).value}cc` } }) })),
      field(`Blur ${sh.blur}`, h('input', { type: 'range', min: 0, max: 60, value: sh.blur, onchange: (e) => set({ shadow: { ...sh, blur: Number((e.target as HTMLInputElement).value) } }) })),
      field(`Geser X ${sh.x}`, h('input', { type: 'range', min: -30, max: 30, value: sh.x, onchange: (e) => set({ shadow: { ...sh, x: Number((e.target as HTMLInputElement).value) } }) })),
      field(`Geser Y ${sh.y}`, h('input', { type: 'range', min: -30, max: 30, value: sh.y, onchange: (e) => set({ shadow: { ...sh, y: Number((e.target as HTMLInputElement).value) } }) })),
    ) : '',
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!gr, onchange: (e) => set({ gradient: (e.target as HTMLInputElement).checked ? { from: '#ffe259', to: '#ff7a00' } : null }) }), 'Teks gradasi'),
    gr ? h('div', { class: 'row2' },
      field('Atas', h('input', { type: 'color', value: gr.from, onchange: (e) => set({ gradient: { ...gr, from: (e.target as HTMLInputElement).value } }) })),
      field('Bawah', h('input', { type: 'color', value: gr.to, onchange: (e) => set({ gradient: { ...gr, to: (e.target as HTMLInputElement).value } }) })),
    ) : '',
  ) as HTMLDetailsElement;
  d.open = typoOpen.v;
  return d;
}

function renderInspector() {
  try { renderInspectorInner(); markAuditionButtons(); } catch (e) { reportOnce(e); }
  if (tab === 'transform' || tab === 'crop' || tab === 'color') renderLeft();
}

function groupInspector(): Node[] {
  const kinds: Record<string, number> = {};
  for (const k of multi) { const kind = k.split(':')[0]; kinds[kind] = (kinds[kind] ?? 0) + 1; }
  const NAME: Record<string, string> = { line: 'subtitle', text: 'teks', image: 'meme', sound: 'suara', music: 'musik', layer: 'layer' };
  const items = () => [...multi].map((k) => { const [kind, ...r] = k.split(':'); const id = r.join(':'); const sp = span(kind as SelKind, id); return sp ? { kind: kind as SelKind, id, a: sp.a, b: sp.b } : null; })
    .filter((i): i is { kind: SelKind; id: string; a: number; b: number } => !!i);
  const nudge = (ms: number) => { snapshot(); moveGroup(items(), ms); changed({ left: tab === 'captions' }); };
  return [
    h('h3', {}, `${multi.size} item dipilih`),
    h('div', { class: 'muted small' }, Object.entries(kinds).map(([k, n]) => `${n} ${NAME[k] ?? k}`).join(', ')),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Geser bersamaan'),
      h('div', { class: 'sync' }, ...([-1000, -100, 100, 1000] as const).map((ms) => h('button', { class: 'chip', onclick: () => nudge(ms) }, `${ms > 0 ? '+' : '−'}${Math.abs(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} dtk`))),
      h('div', { class: 'sync' },
        h('input', { type: 'number', step: 0.1, placeholder: '-1.9', class: 'cat-input', style: 'width:80px', id: 'group-shift', 'aria-label': 'Geser berapa detik' }),
        h('button', { class: 'chip', onclick: () => { const v = Number(($('#group-shift') as HTMLInputElement).value); if (Number.isFinite(v) && v) nudge(Math.round(v * 1000)); } }, 'Geser dtk'),
      ),
      h('div', { class: 'muted small' }, 'Atau tarik salah satu item yang dipilih di timeline. Ctrl/Shift + klik untuk menambah atau mengurangi pilihan, Esc untuk batal.'),
    ),
    h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, `Hapus ${multi.size} item`),
  ];
}

function renderInspectorInner() {
  const el = $('#inspector');
  if (el && P && multi.size > 1) { el.replaceChildren(...groupInspector()); return; }
  if (!el || !P) return;
  const clip = selected('clip');
  const text = selected('text');
  const line = selected('line');

  if (clip) {
    const m = mediaOf(clip.mediaId);
    const set = (patch: Partial<VideoClip>, rerender = true) => { snapshot(); Object.assign(clip, patch); changed({ inspector: rerender }); };
    el.replaceChildren(
      h('h3', {}, 'Video'),
      h('div', { class: 'muted small' }, m?.name ?? ''),
      h('div', { class: 'muted small mono' }, `${tc(clip.inMs, true)} → ${tc(clip.outMs, true)} · ${tc(clipDuration(clip), true)}`),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Isi layar'),
        h('div', { class: 'seg' },
          h('button', { class: clip.fit === 'fill' ? 'on' : '', onclick: () => set({ fit: 'fill' }) }, 'Penuh'),
          h('button', { class: clip.fit === 'fit' ? 'on' : '', onclick: () => set({ fit: 'fit' }) }, 'Utuh (bar hitam)'),
        ),
      ),
      h('div', { class: 'block' },
        field(`Kecepatan ${clip.speed}×`, h('input', {
          type: 'range', min: 0, max: 8, step: 1, value: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].indexOf(clip.speed),
          oninput: (e) => { const v = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4][Number((e.target as HTMLInputElement).value)]; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Kecepatan ${v}×`; },
          onchange: (e) => { const before = clipMap(); snapshot(); clip.speed = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4][Number((e.target as HTMLInputElement).value)]; followMainTrack(before); changed(); },
        })),
        field(`Volume ${Math.round(clip.volume * 100)}%`, h('input', {
          type: 'range', min: 0, max: 200, step: 5, value: Math.round(clip.volume * 100),
          oninput: (e) => { ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Volume ${(e.target as HTMLInputElement).value}%`; },
          onchange: (e) => set({ volume: Number((e.target as HTMLInputElement).value) / 100 }),
        })),
      ),
      h('div', { class: 'block' },
        field(`Zoom ${Math.round((clip.zoom ?? 1) * 100)}%`, h('input', {
          type: 'range', min: 100, max: 300, step: 5, value: Math.round((clip.zoom ?? 1) * 100),
          onpointerdown: () => snapshot(),
          oninput: (e) => { clip.zoom = Number((e.target as HTMLInputElement).value) / 100; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Zoom ${Math.round(clip.zoom * 100)}%`; renderFrame(); },
          onchange: () => {
            const i = tl().clips.indexOf(clip);
            if (i > 0 && (clip.zoom ?? 1) > 1 && (clip.trans ?? 'none') === 'none') { clip.trans = 'punch'; toast('Transisi Punch dipasang otomatis di sambungan ini.'); }
            void saveProject(P!); drawTimeline(); renderInspector();
          },
        })),
        (clip.zoom ?? 1) > 1 ? h('div', { class: 'muted small' }, 'Geser di preview untuk mengarahkan zoom ke wajah atau momennya.') : h('div', { class: 'muted small' }, 'Tip punch-in: split di momen lucu, lalu zoom potongan itu 130–160%.'),
        (clip.zoom ?? 1) > 1 ? h('button', { class: 'ghost small', onclick: () => set({ zoom: 1, zx: 0.5, zy: 0.5 }) }, 'Reset zoom') : h('span'),
      ),
      transBlock(clip),
      m?.hasAudio ? fadeBlock('clip', clip.id) : h('span'),
      h('div', { class: 'block' },
        h('button', { class: 'secondary wide', onclick: splitHere }, '✂ Split di playhead'),
        h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus potongan'),
      ),
    );
    return;
  }

  const lay = selected('layer');
  if (lay) { el.replaceChildren(...layerInspector(lay)); return; }

  const mus = selected('music');
  if (mus) {
    const set = (patch: Partial<MusicItem>) => { snapshot(); Object.assign(mus, patch); changed(); };
    el.replaceChildren(
      h('h3', {}, 'Musik latar'),
      h('div', { class: 'muted small' }, mus.name),
      h('div', { class: 'muted small mono' }, `${tc(mus.startMs, true)} · ${tc(mus.lengthMs, true)}`),
      h('div', { class: 'block' },
        field(`Volume ${Math.round(mus.volume * 100)}%`, h('input', {
          type: 'range', min: 0, max: 150, step: 5, value: Math.round(mus.volume * 100),
          oninput: (e) => { ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Volume ${(e.target as HTMLInputElement).value}%`; },
          onchange: (e) => set({ volume: Number((e.target as HTMLInputElement).value) / 100 }),
        })),
        h('div', { class: 'label' }, 'Auto-ducking (musik mengecil saat kamu bicara)'),
        h('div', { class: 'seg' }, ...(['off', 'light', 'medium', 'strong'] as Duck[]).map((d) =>
          h('button', { class: mus.duck === d ? 'on' : '', onclick: () => { set({ duck: d }); void ensureSpeech(); } }, { off: 'Mati', light: 'Ringan', medium: 'Sedang', strong: 'Kuat' }[d]))),
        field(`Mulai lagu dari ${tc(mus.inMs)}`, h('input', {
          type: 'range', min: 0, max: Math.max(0, Math.floor((mus.sourceMs - 1000) / 1000)), value: Math.floor(mus.inMs / 1000),
          oninput: (e) => { ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Mulai lagu dari ${tc(Number((e.target as HTMLInputElement).value) * 1000)}`; },
          onchange: (e) => { const v = Number((e.target as HTMLInputElement).value) * 1000; set({ inMs: v, lengthMs: Math.min(mus.lengthMs, mus.sourceMs - v) }); },
        })),
        h('div', { class: 'muted small' }, 'Tarik ujung kanannya di timeline untuk memendekkan.'),
      ),
      fadeBlock('music', mus.id),
      h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus musik'),
    );
    return;
  }

  const snd = selected('sound');
  if (snd) {
    el.replaceChildren(
      h('h3', {}, 'Suara'),
      h('div', { class: 'muted small' }, snd.name),
      h('div', { class: 'muted small mono' }, `${tc(snd.startMs, true)} · ${tc(snd.lengthMs, true)}`),
      h('div', { class: 'block' },
        field(`Volume ${Math.round(snd.volume * 100)}%`, h('input', {
          type: 'range', min: 0, max: 200, step: 5, value: Math.round(snd.volume * 100),
          oninput: (e) => { ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Volume ${(e.target as HTMLInputElement).value}%`; },
          onchange: (e) => { snapshot(); snd.volume = Number((e.target as HTMLInputElement).value) / 100; changed(); },
        })),
        h('button', { class: 'secondary wide with-ico', 'data-aud': snd.file, 'data-aud-label': 'Dengarkan', 'data-aud-size': 15, onclick: () => toggleAudition(snd.file, snd.volume, snd.name) }, icon('play', 15), h('span', {}, 'Dengarkan')),
        h('div', { class: 'muted small' }, 'Geser di timeline untuk memindah. Tarik ujung kanannya untuk memotong.'),
      ),
      fadeBlock('sound', snd.id),
      h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus suara'),
    );
    return;
  }

  const img = selected('image');
  if (img) {
    el.replaceChildren(
      h('h3', {}, 'Gambar'),
      h('div', { class: 'muted small' }, img.name),
      h('div', { class: 'muted small mono' }, `${tc(img.startMs, true)} → ${tc(img.endMs, true)}`),
      blendBlock(img),
      h('div', { class: 'block' },
        field(`Ukuran ${Math.round(img.scale * 100)}%`, h('input', {
          type: 'range', min: 10, max: 100, value: Math.round(img.scale * 100),
          oninput: (e) => { img.scale = Number((e.target as HTMLInputElement).value) / 100; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Ukuran ${Math.round(img.scale * 100)}%`; renderFrame(); },
          onchange: () => { void saveProject(P!); },
          onpointerdown: () => snapshot(),
        })),
        h('div', { class: 'muted small' }, 'Geser gambarnya langsung di preview. Ctrl + scroll di atas gambar untuk ubah ukuran.'),
      ),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Animasi masuk'),
        transSeg(img.transIn ?? 'none', (v) => { snapshot(); img.transIn = v; changed(); seek(img.startMs); previewTrans(); }),
        h('div', { class: 'label' }, 'Animasi keluar'),
        transSeg(img.transOut ?? 'none', (v) => { snapshot(); img.transOut = v; changed(); seek(Math.max(img.startMs, img.endMs - 700)); previewTrans(); }),
        library?.memes.some((m) => m.file === img.file) ? h('button', {
          class: 'ghost small', onclick: async () => {
            const m = library!.memes.find((x) => x.file === img.file)!;
            m.transIn = img.transIn ?? 'none'; m.transOut = img.transOut ?? 'none'; m.durationMs = img.endMs - img.startMs;
            await saveLibrary(); toast(`Jadi default untuk "${m.name}".`);
          },
        }, 'Jadikan default untuk meme ini') : h('span'),
        img.animated ? h('div', { class: 'muted small' }, 'GIF bergerak di preview saat diputar, dan berulang terus selama tampil.') : h('span'),
        h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus gambar'),
      ),
    );
    return;
  }

  if (text) {
    const set = (patch: Partial<TextStyle>) => { snapshot(); Object.assign(text.style, patch); changed(); };
    el.replaceChildren(
      h('h3', {}, 'Teks'),
      h('textarea', {
        id: 'text-edit', rows: 3, 'aria-label': 'Isi teks', value: text.text,
        onfocus: () => snapshot(),
        oninput: (e) => { text.text = (e.target as HTMLTextAreaElement).value; void saveProject(P!); renderFrame(); drawTimeline(); },
      }),
      /\p{Extended_Pictographic}/u.test(text.text) ? h('div', { class: 'muted small' }, 'Emoji belum ikut di video hasil ekspor.') : h('span'),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Animasi'),
        h('div', { class: 'anim-grid' }, ...(['none', 'pop', 'fade', 'rise', 'type', 'shake'] as TextAnim[]).map((a) => h('button', {
          class: (text.anim ?? 'none') === a ? 'on' : '',
          onclick: () => { snapshot(); text.anim = a; changed(); seek(text.startMs); if (a !== 'none') { play(); setTimeout(() => pause(), 1100); } },
        }, ANIM_NAME[a]))),
      ),
      h('div', { class: 'block' }, ...styleControls(text.style, set, false),
        h('button', { class: 'ghost small', onclick: () => {
          void askText(window.innerWidth / 2 - 140, 160, 'Nama preset teks', `Preset ${(settings.textPresets?.length ?? 0) + 1}`).then((n) => {
            if (!n) return;
            (settings.textPresets ??= []).push({ name: n.trim(), style: structuredClone(text.style) });
            void saveSettings(settings);
            toast(`Preset "${n.trim()}" disimpan. Ada di tab Teks.`);
          });
        } }, '+ Simpan gaya ini sebagai preset')),
      h('div', { class: 'block' },
        h('div', { class: 'muted small mono' }, `${tc(text.startMs, true)} → ${tc(text.endMs, true)}`),
        h('div', { class: 'muted small' }, 'Atur durasi dengan menarik ujung kotak teks di timeline.'),
        h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus teks'),
      ),
    );
    return;
  }

  if (line) {
    el.replaceChildren(
      h('h3', {}, 'Baris subtitle'),
      h('div', { class: 'muted small mono' }, `${tc(line.startMs, true)} → ${tc(line.endMs, true)}`),
      h('input', {
        value: line.words.map((w) => w.text).join(' '), 'aria-label': 'Teks subtitle',
        onchange: (e) => { snapshot(); setLineText(line, (e.target as HTMLInputElement).value); changed({ left: true }); },
      }),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Waktu baris ini'),
        h('div', { class: 'sync' },
          h('button', { class: 'chip', onclick: () => { snapshot(); nudgeLines([line], -100); changed(); } }, '← 0.1'),
          h('button', { class: 'chip', onclick: () => { snapshot(); nudgeLines([line], 100); changed(); } }, '0.1 →'),
          h('button', {
            class: 'chip', title: 'Mulai baris ini di posisi playhead',
            onclick: () => { snapshot(); nudgeLines([line], Math.round(t) - line.startMs); changed(); },
          }, 'Mulai di playhead'),
        ),
        h('div', { class: 'muted small' }, 'Tarik ujung kotak subtitle di timeline untuk mengatur durasinya. Gaya semua subtitle ada di panel Subtitle.'),
      ),
      lineAnimBlock(line),
      wordFxBlock(line),
      h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus baris ini'),
    );
    return;
  }

  el.replaceChildren(
    h('h3', {}, 'Proyek'),
    canvasBlock(),
    h('div', { class: 'muted small' }, `Durasi ${tc(timelineDuration(tl()), true)} · ${tl().clips.length} potongan · ${tl().texts.length} teks · ${tl().captions.lines.length} baris subtitle`),
    watermarkBlock(),
    historyBlock(),
    h('div', { class: 'block muted small' },
      h('div', {}, h('kbd', {}, 'Spasi'), ' putar / jeda'),
      h('div', {}, h('kbd', {}, 'Ctrl'), h('kbd', {}, 'B'), ' split di playhead'),
      h('div', {}, h('kbd', {}, 'Delete'), ' hapus yang dipilih'),
      h('div', {}, h('kbd', {}, 'Ctrl'), h('kbd', {}, 'Z'), ' urungkan'),
      h('div', {}, h('kbd', {}, '←'), h('kbd', {}, '→'), ' 1 frame · ', h('kbd', {}, 'Shift'), ' 1 detik'),
      h('div', {}, h('kbd', {}, 'Ctrl'), ' + scroll di timeline: zoom'),
    ),
  );
}

// ================= editing actions =================

// ================= keep everything on its footage when the main track changes =================
type ClipMap = { id: string; start: number; end: number; inMs: number; speed: number }[];
function clipMap(): ClipMap {
  const starts = clipStarts(tl().clips);
  return tl().clips.map((c, i) => ({ id: c.id, start: starts[i], end: starts[i] + clipDuration(c), inMs: c.inMs, speed: c.speed }));
}
/**
 * After the main track was reordered, trimmed, sped up or had a clip removed, moves subtitles, text, memes,
 * sounds, music and layers so each stays on the same moment of the footage it was placed on.
 */
function followMainTrack(before: ClipMap) {
  if (!P || !before.length) return;
  const now = new Map(clipMap().map((c) => [c.id, c]));
  const oldTotal = before[before.length - 1].end, newTotal = timelineDuration(tl());
  const delta = (t: number): number => {
    let k = before.findIndex((b) => t >= b.start && t < b.end);
    if (k < 0) return t >= oldTotal ? newTotal - oldTotal : 0;
    const b = before[k], n = now.get(b.id);
    if (n) {
      const src = b.inMs + (t - b.start) * b.speed;
      const nt = clamp(n.start + (src - n.inMs) / n.speed, n.start, n.end);
      return nt - t;
    }
    // its clip was removed: move along with the next clip that is still there
    for (k++; k < before.length; k++) { const nx = now.get(before[k].id); if (nx) return nx.start - before[k].start; }
    return newTotal - oldTotal;
  };
  const sh = (x: { startMs: number; endMs?: number }) => {
    const d = Math.round(delta(x.startMs));
    if (!d) return;
    x.startMs = Math.max(0, x.startMs + d);
    if (typeof x.endMs === 'number' && x.endMs < UNTIL_END) x.endMs = Math.max(x.startMs + 50, x.endMs + d);
    return d;
  };
  tl().texts.forEach(sh); images().forEach(sh); sounds().forEach(sh); music().forEach(sh);
  layers().forEach((ly) => { if (ly.source === 'media' || ly.endMs < UNTIL_END) sh(ly); });
  for (const l of tl().captions.lines) {
    const d = Math.round(delta(l.startMs));
    if (!d) continue;
    l.startMs = Math.max(0, l.startMs + d); l.endMs = Math.max(l.startMs + 50, l.endMs + d);
    l.words = l.words.map((w) => ({ ...w, startMs: Math.max(0, w.startMs + d), endMs: Math.max(0, w.endMs + d) }));
  }
  tl().captions.lines.sort((a, b) => a.startMs - b.startMs);
}
let clipMapAtDown: ClipMap | null = null;

// ================= clipboard =================
type ClipEntry = { kind: SelKind; data: unknown; start: number };
let clipboard: { items: ClipEntry[]; base: number } | null = null;

/** The picked items: the group selection, else the single selection. */
function pickedItems(): { kind: SelKind; id: string }[] {
  if (multi.size) return [...multi].map((k) => { const [kind, ...r] = k.split(':'); return { kind: kind as SelKind, id: r.join(':') }; });
  return sel ? [sel] : [];
}

function copySelection(cut = false): boolean {
  if (!P) return false;
  const picked = pickedItems();
  const items: ClipEntry[] = [];
  for (const { kind, id } of picked) {
    if (kind === 'clip') {
      const i = tl().clips.findIndex((c) => c.id === id);
      if (i >= 0) items.push({ kind, data: structuredClone(tl().clips[i]), start: clipStarts(tl().clips)[i] });
      continue;
    }
    const obj = (listOf(kind) as { id: string }[]).find((x) => x.id === id);
    const sp = span(kind, id);
    if (obj && sp) items.push({ kind, data: structuredClone(obj), start: sp.a });
  }
  if (!items.length) { toast('Pilih dulu item di timeline untuk disalin.'); return false; }
  clipboard = { items, base: Math.min(...items.map((i) => i.start)) };
  if (cut) {
    if (items.some((i) => i.kind === 'clip')) { toast('Potongan video utama tidak bisa dipotong-tempel. Pakai Salin lalu hapus potongannya.'); }
    else deleteSelected();
  }
  toast(`${items.length} item ${cut ? 'dipotong' : 'disalin'}. Ctrl+V untuk menempel.`);
  return true;
}

/** A main-track clip becomes a video layer: same file, same part, its own place on the canvas. */
function clipAsLayer(c: VideoClip, start: number): VideoLayer | null {
  const m = mediaOf(c.mediaId);
  if (!m) return null;
  const ly: VideoLayer = {
    id: uid(), name: `${m.name} (salinan)`, source: 'media', mediaId: m.id, inMs: c.inMs, startMs: Math.max(0, Math.round(start)),
    endMs: Math.max(0, Math.round(start)) + Math.round((c.outMs - c.inMs) / c.speed), crop: { ...NO_CROP }, box: { x: 0.5, y: 0.5, w: 1, h: 1 }, opacity: 1, volume: 0,
  };
  fillArea(ly, { x: 0.5, y: 0.5, w: 1, h: 1 });
  return ly;
}

/**
 * Pastes the clipboard. `at`: where the earliest item lands (default the playhead). Video clips from the main
 * track always land at their own time as a new layer, so the copy stays in sync with the original.
 */
function pasteClipboard(at?: number) {
  if (!P || !clipboard) { toast('Belum ada yang disalin. Pilih item lalu Ctrl+C.'); return; }
  snapshot();
  const shift = (at ?? t) - clipboard.base;
  const fresh: { kind: SelKind; id: string }[] = [];
  let videoLayers = 0, speedNote = false;
  for (const it of clipboard.items) {
    const d = structuredClone(it.data) as Record<string, unknown> & { id: string };
    if (it.kind === 'clip') {
      const c = d as unknown as VideoClip;
      const ly = clipAsLayer(c, it.start);
      if (!ly) continue;
      if (c.speed !== 1) speedNote = true;
      layers().push(ly); fresh.push({ kind: 'layer', id: ly.id }); videoLayers++;
      continue;
    }
    d.id = uid();
    const mv = (k: string) => { if (typeof d[k] === 'number' && (d[k] as number) < UNTIL_END) d[k] = Math.max(0, Math.round((d[k] as number) + shift)); };
    mv('startMs'); mv('endMs');
    if (it.kind === 'line') (d as unknown as CaptionLine).words = (d as unknown as CaptionLine).words.map((w) => ({ ...w, startMs: Math.max(0, w.startMs + shift), endMs: Math.max(0, w.endMs + shift) }));
    if (it.kind === 'layer' && !/\(salinan\)$/.test((d as unknown as VideoLayer).name)) (d as unknown as VideoLayer).name = `${(d as unknown as VideoLayer).name} (salinan)`;
    (listOf(it.kind) as unknown[]).push(d);
    fresh.push({ kind: it.kind, id: d.id });
  }
  tl().captions.lines.sort((a, b) => a.startMs - b.startMs);
  multi.clear();
  if (fresh.length === 1) sel = fresh[0];
  else { sel = null; for (const f of fresh) multi.add(mkey(f.kind, f.id)); }
  changed({ left: true });
  toast(videoLayers
    ? `Video ditempel jadi layer baru di waktu yang sama.${speedNote ? ' Kecepatan potongan aslinya tidak ikut (layer diputar 1×).' : ''} Atur lewat tab Transform dan Crop.`
    : `${fresh.length} item ditempel di ${tc(Math.max(0, (at ?? t)))}.`);
}

/** Copy + paste right after (clips: as a layer on the same time). */
function duplicateSelection() {
  if (!copySelection()) return;
  const end = Math.max(...pickedItems().map(({ kind, id }) => (kind === 'clip' ? 0 : span(kind, id)?.b ?? 0)));
  pasteClipboard(clipboard!.items.every((i) => i.kind === 'clip') ? undefined : end);
}

// ================= right-click menu =================
type MenuItem = { label: string; icon?: IconName; keys?: string; run: () => void; danger?: boolean; disabled?: boolean } | 'sep';

function closeMenu() { document.querySelector('.ctx-menu')?.remove(); }
function openMenu(clientX: number, clientY: number, items: MenuItem[]) {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' },
    ...items.map((it) => it === 'sep' ? h('div', { class: 'ctx-sep' }) : h('button', {
      class: `ctx-item${it.danger ? ' danger' : ''}`, role: 'menuitem', disabled: it.disabled,
      onclick: () => { closeMenu(); it.run(); },
    }, it.icon ? icon(it.icon, 15) : h('span', { class: 'ctx-ico' }), h('span', { class: 'ctx-label' }, it.label), it.keys ? h('kbd', {}, it.keys) : '')));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - r.height - 8)}px`;
  const away = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.ctx-menu')) { closeMenu(); off(); } };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeMenu(); off(); } };
  const off = () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); window.removeEventListener('blur', closeMenu); };
  setTimeout(() => { window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', esc, true); window.addEventListener('blur', closeMenu); }, 0);
}

function setFade(kind: FadeKind, id: string, which: 'in' | 'out' | 'none', ms = 500) {
  const ft = fadeTarget(kind, id);
  if (!ft) return;
  snapshot();
  if (which === 'none') { ft.obj.fadeInMs = 0; ft.obj.fadeOutMs = 0; }
  else if (which === 'in') ft.obj.fadeInMs = Math.min(ms, Math.max(0, ft.len / 2 - 25));
  else ft.obj.fadeOutMs = Math.min(ms, Math.max(0, ft.len / 2 - 25));
  changed();
}

/** Right-click on the timeline: actions for what is under the pointer (or the picked group). */
function timelineMenu(e: MouseEvent, x: number, y: number) {
  if (!P) return;
  if (y < RULER) { rulerMenu(e, x); return; }
  const hit = hitTest(x, y);
  if (hit && !hit.marker && !isSelected(hit.kind, hit.id)) { multi.clear(); sel = { kind: hit.kind, id: hit.id }; renderInspector(); drawTimeline(); renderFrame(); }
  if (!hit && !multi.size) { sel = null; renderInspector(); drawTimeline(); }
  selectionMenu(e, Math.max(0, xToMs(x)));
}

/** Right-click on the preview: the thing under the pointer, else the video at the playhead. */
function previewMenu(e: MouseEvent) {
  if (!P) return;
  const r = preview.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * preview.width, py = ((e.clientY - r.top) / r.height) * preview.height;
  const hit = [...boxes].reverse().find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  multi.clear();
  if (hit) sel = { kind: hit.kind === 'captions' ? 'line' : hit.kind, id: hit.id };
  else { const loc = locate(tl().clips, t); sel = loc ? { kind: 'clip', id: tl().clips[loc.index].id } : null; }
  renderInspector(); drawTimeline(); renderFrame();
  selectionMenu(e, t);
}

function selectionMenu(e: MouseEvent, atMs: number) {
  const picked = pickedItems();
  const one = picked.length === 1 ? picked[0] : null;
  const paste: MenuItem[] = [
    { label: 'Tempel di sini', icon: 'paste', disabled: !clipboard, run: () => pasteClipboard(atMs) },
    { label: 'Tempel di playhead', icon: 'paste', keys: 'Ctrl+V', disabled: !clipboard, run: () => pasteClipboard() },
    { label: 'Tempel di waktu aslinya', icon: 'paste', keys: 'Ctrl+Shift+V', disabled: !clipboard, run: () => pasteClipboard(clipboard?.base) },
  ];
  if (!picked.length) {
    openMenu(e.clientX, e.clientY, [
      ...paste, 'sep',
      { label: 'Pilih semua item', icon: 'select', keys: 'Ctrl+A', run: () => { multi.clear(); for (const r of itemRects()) multi.add(mkey(r.kind, r.id)); sel = null; renderInspector(); drawTimeline(); } },
      { label: 'Layer dari seluruh video utama', icon: 'layers', run: () => { snapshot(); const ly = addMainLayer(); if (ly) { sel = { kind: 'layer', id: ly.id }; changed({ left: true }); switchTab('transform'); } } },
      { label: 'Tempel gambar dari web', icon: 'image', keys: 'Ctrl+V', run: () => void pasteFromClipboardApi() },
      { label: 'Adjustment layer baru', icon: 'color', run: () => void addAdjustmentLayer() },
      { label: 'Ukuran kanvas…', icon: 'fit', keys: 'Ctrl+Alt+C', run: toggleCanvasPop },
    ]);
    return;
  }
  const items: MenuItem[] = [];
  const visual = !!one && ['clip', 'layer', 'image', 'text'].includes(one.kind);
  const video = !!one && (one.kind === 'clip' || one.kind === 'layer');
  if (visual) items.push({ label: 'Transform', icon: 'move', keys: 'Ctrl+T', run: () => startTransform('transform') });
  if (video) {
    items.push(
      { label: 'Crop', icon: 'crop', keys: 'C', run: () => startTransform('crop') },
      { label: 'Warna', icon: 'color', keys: 'Ctrl+U', run: () => switchTab('color') },
    );
  }
  if (items.length) items.push('sep');
  items.push(
    { label: picked.length > 1 ? `Salin ${picked.length} item` : 'Salin', icon: 'copy', keys: 'Ctrl+C', run: () => copySelection() },
    ...paste,
    { label: 'Potong', icon: 'split', keys: 'Ctrl+X', disabled: picked.some((p) => p.kind === 'clip'), run: () => copySelection(true) },
    { label: 'Duplikat', icon: 'dup', keys: 'Ctrl+J', run: duplicateSelection },
  );
  if (one?.kind === 'clip') items.push({ label: 'Salin ke layer baru', icon: 'layers', run: () => { if (copySelection()) { pasteClipboard(); switchTab('transform'); } } });
  if (one?.kind === 'clip') {
    const c = tl().clips.find((x) => x.id === one.id);
    if (c) items.push({ label: c.reversedFrom ? 'Putar normal lagi' : 'Putar mundur (reverse)', icon: 'back', run: () => void reverseClip(c) });
  }
  if (video && one) {
    const obj = (listOf(one.kind) as (Gradable & { id: string })[]).find((x) => x.id === one.id);
    items.push('sep',
      { label: 'Salin warna', icon: 'color', disabled: !obj?.grade, run: () => { gradeClipboard = obj?.grade ? structuredClone(obj.grade) : null; toast('Warna disalin. Klik kanan video lain → Tempel warna.'); } },
      { label: 'Tempel warna', icon: 'color', disabled: !gradeClipboard, run: () => { if (!obj || !gradeClipboard) return; snapshot(); obj.grade = structuredClone(gradeClipboard); changed(); } },
    );
  }
  if (one) {
    const fadeKind: FadeKind | null = one.kind === 'clip' ? (mediaOf(selected('clip')?.mediaId ?? '')?.hasAudio ? 'clip' : null)
      : one.kind === 'sound' || one.kind === 'music' ? one.kind : one.kind === 'layer' && selected('layer')?.source === 'media' ? 'layer' : null;
    if (fadeKind) {
      items.push('sep',
        { label: 'Fade in suara 0,5 dtk', icon: 'fadeIn', run: () => setFade(fadeKind, one.id, 'in') },
        { label: 'Fade out suara 0,5 dtk', icon: 'fadeOut', run: () => setFade(fadeKind, one.id, 'out') },
        { label: 'Hapus fade', run: () => setFade(fadeKind, one.id, 'none') },
      );
    }
    if (one.kind === 'layer') {
      items.push('sep',
        { label: 'Bawa ke depan', icon: 'up', keys: 'Ctrl+]', run: () => arrangeLayer(1, false) },
        { label: 'Bawa ke belakang', icon: 'down', keys: 'Ctrl+[', run: () => arrangeLayer(-1, false) },
      );
    }
    items.push('sep', { label: 'Split di playhead', icon: 'split', keys: 'Ctrl+B', run: splitHere });
  } else items.push('sep');
  items.push({ label: picked.length > 1 ? `Hapus ${picked.length} item` : 'Hapus', icon: 'trash', keys: 'Del', danger: true, run: deleteSelected });
  openMenu(e.clientX, e.clientY, items);
}

function splitHere() {
  if (!P) return;
  const text = selected('text');
  if (text && t > text.startMs + 100 && t < text.endMs - 100) {
    snapshot();
    const b: TextItem = { ...structuredClone(text), id: uid(), startMs: t };
    text.endMs = t;
    tl().texts.push(b);
    changed();
    return;
  }
  const next = splitAt(tl().clips, t, uid());
  if (!next) { toast('Geser playhead ke tengah potongan video untuk split.'); return; }
  snapshot();
  tl().clips = next;
  const loc = locate(next, t + 1);
  if (loc) sel = { kind: 'clip', id: next[loc.index].id };
  changed();
}

function deleteSelected() {
  if (P && multi.size) {
    snapshot();
    const n = multi.size;
    const drop = (kind: SelKind) => (x: { id: string }) => !multi.has(mkey(kind, x.id));
    tl().texts = tl().texts.filter(drop('text'));
    tl().sounds = sounds().filter(drop('sound'));
    tl().images = images().filter(drop('image'));
    tl().music = music().filter(drop('music'));
    tl().layers = layers().filter(drop('layer'));
    tl().captions.lines = tl().captions.lines.filter(drop('line'));
    multi.clear();
    sel = null;
    changed({ left: tab === 'captions' });
    toast(`${n} item dihapus.`);
    return;
  }
  if (!P || !sel) { toast('Pilih dulu potongan, teks, atau subtitle di timeline.'); return; }
  snapshot();
  if (sel.kind === 'clip') { const before = clipMap(); tl().clips = tl().clips.filter((c) => c.id !== sel!.id); followMainTrack(before); }
  else if (sel.kind === 'text') tl().texts = tl().texts.filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'sound') tl().sounds = sounds().filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'image') tl().images = images().filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'music') tl().music = music().filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'layer') { tl().layers = layers().filter((x) => x.id !== sel!.id); cropMode = false; }
  else tl().captions.lines = tl().captions.lines.filter((x) => x.id !== sel!.id);
  sel = null;
  changed({ left: tab === 'captions' });
}

// ================= preview engine =================

/**
 * Loads a file as CORS-clean media so the colour grading (WebGL) may read its pixels. Tauri's asset
 * protocol answers with Access-Control-Allow-Origin; if a file still refuses, it loads again the plain way.
 */
function corsSrc(el: HTMLVideoElement | HTMLImageElement, url: string) {
  el.crossOrigin = 'anonymous';
  el.addEventListener('error', () => {
    if (el.crossOrigin === null) return;
    el.removeAttribute('crossorigin');
    el.src = url;
  }, { once: true });
  el.src = url;
}

function videoFor(mediaId: string): HTMLVideoElement | null {
  let v = videos.get(mediaId);
  if (v) return v;
  const m = mediaOf(mediaId);
  if (!m) return null;
  v = h('video', { preload: 'auto', playsinline: true });
  corsSrc(v, fileSrc(m.playable));
  v.addEventListener('seeked', () => { if (!playing) renderFrame(); });
  v.addEventListener('loadeddata', () => { if (!playing) { syncVideo(); renderFrame(); } });
  v.addEventListener('error', () => { if (v!.crossOrigin === null) toast(`Video ${m.name} tidak bisa diputar di preview (codec belum didukung). Ekspor tetap bisa.`, 'error'); });
  videos.set(mediaId, v);
  return v;
}

let activeVideo: HTMLVideoElement | null = null;
let activeIndex = -1;

/** The main video's volume follows its clip's audio fades while playing. */
function clipFadeVolume() {
  const c = tl().clips[activeIndex], v = activeVideo;
  if (!c || !v) return;
  const start = clipStarts(tl().clips)[activeIndex];
  const len = clipDuration(c);
  const fd = fadesOf(c, len);
  v.volume = clamp(c.volume * fadeGain(t - start, len, fd.fi, fd.fo), 0, 1);
}

/** Points the right <video> at the right source time for the playhead. */
function syncVideo() {
  if (!P) return;
  const loc = locate(tl().clips, t);
  if (!loc) { activeVideo = null; activeIndex = -1; return; }
  const c = tl().clips[loc.index];
  const v = videoFor(c.mediaId);
  if (!v) return;
  if (activeVideo && activeVideo !== v) activeVideo.pause();
  activeVideo = v;
  activeIndex = loc.index;
  v.playbackRate = Math.min(16, c.speed * playRate());
  v.volume = clamp(c.volume, 0, 1);
  if (Math.abs(v.currentTime * 1000 - loc.sourceMs) > 40) v.currentTime = loc.sourceMs / 1000;
}

function seek(ms: number) {
  if (!P) return;
  t = clamp(ms, 0, playheadMax());
  if (playing) clock = { at: performance.now(), t };
  setTimeout(markActiveLine, 0);
  syncVideo();
  syncLayers();
  if (playing && activeVideo) void activeVideo.play().catch(() => undefined);
  renderFrame();
  drawTimeline();
  updateTime();
}

function togglePlay() { if (reverseTimer) { stopReverse(); shuttle = 0; showSpeed(); return; } if (playing) pause(); else play(); }

let clock: { at: number; t: number } | null = null;   // playback clock when no main video drives time
function play() {
  if (!P || !timelineDuration(tl())) return;
  stopAudition();
  if (t >= timelineDuration(tl()) - 50) t = 0;
  playing = true;
  clock = { at: performance.now(), t };
  syncVideo();
  void activeVideo?.play().catch(() => undefined);
  const btn = $('#play');
  if (btn) { btn.replaceChildren(icon('pause', 18)); btn.setAttribute('aria-label', 'Jeda'); }
  requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  if (shuttle > 0) { shuttle = 0; showSpeed(); }
  activeVideo?.pause();
  sfxEls.forEach((a) => a.pause());
  musicEls.forEach((a) => a.pause());
  layerVideos.forEach((v) => v.pause());
  vmPreview?.pause();
  const btn = $('#play');
  if (btn) { btn.replaceChildren(icon('play', 18)); btn.setAttribute('aria-label', 'Putar'); }
}

function tick() {
  try { tickInner(); } catch (e) { reportOnce(e); }
  if (playing) requestAnimationFrame(tick);
}

function tickInner() {
  if (!playing || !P) return;
  const clips = tl().clips;
  const c = clips[activeIndex];
  const v = activeVideo;
  if (c && v) {
    const starts = clipStarts(clips);
    const src = v.currentTime * 1000;
    t = starts[activeIndex] + (src - c.inMs) / c.speed;
    if (src >= c.outMs - 20 || v.ended) {
      if (activeIndex + 1 < clips.length) {
        t = starts[activeIndex + 1];
        syncVideo();
        void activeVideo?.play().catch(() => undefined);
      } else {
        t = timelineDuration(tl());
        pause();
      }
    }
  } else if (clock) {
    // blank canvas (no main video): time runs on the clock
    t = clock.t + (performance.now() - clock.at) * playRate();
    if (t >= timelineDuration(tl())) { t = timelineDuration(tl()); pause(); }
  }
  // keep the playhead in view
  const tb = $('#tl-body');
  if (tb) {
    const x = HEAD_W + (t / 1000) * pxPerSec - scrollX;
    if (x > tb.clientWidth - 40) scrollX += tb.clientWidth * 0.6;
  }
  syncSfx();
  syncMusic();
  syncLayers();
  clipFadeVolume();
  renderFrame();
  drawTimeline();
  updateTime();
  markActiveLine();
}

interface Box { kind: 'text' | 'captions' | 'image' | 'layer'; id: string; x: number; y: number; w: number; h: number }
let boxes: Box[] = [];

function renderFrame() {
  try { renderFrameInner(); } catch (e) {
    reportOnce(e);
    const ctx = preview?.getContext('2d');
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; }
  }
}

// ---------- canvas size ----------
type Aspect = '9:16' | '16:9' | '1:1' | '4:5';
const ASPECTS: { id: Aspect; name: string; hint: string; wh: [number, number] }[] = [
  { id: '9:16', name: '9:16', hint: 'Shorts, TikTok, Reels', wh: [9, 16] },
  { id: '16:9', name: '16:9', hint: 'YouTube biasa', wh: [16, 9] },
  { id: '1:1', name: '1:1', hint: 'Feed persegi', wh: [1, 1] },
  { id: '4:5', name: '4:5', hint: 'Feed Instagram', wh: [4, 5] },
];
const RESOLUTIONS: { id: string; name: string; short: number }[] = [
  { id: 'fhd', name: 'FHD', short: 1080 }, { id: '2k', name: '2K', short: 1440 }, { id: '4k', name: '4K', short: 2160 },
];
const even = (n: number) => Math.round(n / 2) * 2;
function aspectOf(w: number, h: number): Aspect {
  const r = w / h;
  return ASPECTS.reduce((best, a) => (Math.abs(a.wh[0] / a.wh[1] - r) < Math.abs(best.wh[0] / best.wh[1] - r) ? a : best)).id;
}
const resOf = (w: number, h: number) => RESOLUTIONS.reduce((best, r) => (Math.abs(r.short - Math.min(w, h)) < Math.abs(best.short - Math.min(w, h)) ? r : best));
function fmtLabel() {
  if (!P) return '';
  return `${aspectOf(tl().width, tl().height)} · ${resOf(tl().width, tl().height).name} · ${tl().fps}`;
}
/** Size of the preview canvas in pixels: the long side 960 (portrait) or 1280 (landscape). */
function previewDims() {
  const W = P ? tl().width : 1080, H = P ? tl().height : 1920;
  return W >= H ? { w: 1280, h: Math.round((1280 * H) / W) } : { w: Math.round((960 * W) / H), h: 960 };
}
function setCanvas(aspect: Aspect, short: number, fps?: 30 | 60) {
  if (!P) return;
  const a = ASPECTS.find((x) => x.id === aspect)!;
  const [aw, ah] = a.wh;
  const w = aw <= ah ? short : even((short * aw) / ah), hgt = aw <= ah ? even((short * ah) / aw) : short;
  snapshot();
  tl().width = w; tl().height = hgt;
  if (fps) tl().fps = fps;
  const pd = previewDims();
  if (preview) { preview.width = pd.w; preview.height = pd.h; }
  layoutPreview();
  changed({ left: true });
  renderCanvasPop();
}
function canvasControls(): HTMLElement[] {
  const asp = aspectOf(tl().width, tl().height), res = resOf(tl().width, tl().height);
  return [
    h('div', { class: 'label' }, 'Bentuk'),
    h('div', { class: 'canvas-aspects' }, ...ASPECTS.map((a) => h('button', {
      class: `canvas-aspect${asp === a.id ? ' on' : ''}`, title: a.hint, onclick: () => setCanvas(a.id, res.short),
    }, h('span', { class: 'ca-box', style: a.wh[0] >= a.wh[1] ? `width:36px;height:${Math.round((36 * a.wh[1]) / a.wh[0])}px` : `height:32px;width:${Math.round((32 * a.wh[0]) / a.wh[1])}px` }), h('span', { class: 'ca-name' }, a.name), h('span', { class: 'ca-hint' }, a.hint)))),
    h('div', { class: 'label' }, 'Resolusi'),
    h('div', { class: 'seg' }, ...RESOLUTIONS.map((r) => h('button', { class: res.id === r.id ? 'on' : '', onclick: () => setCanvas(asp, r.short) }, r.name))),
    h('div', { class: 'label' }, 'Frame rate'),
    h('div', { class: 'seg' }, ...([30, 60] as const).map((f) => h('button', { class: tl().fps === f ? 'on' : '', onclick: () => setCanvas(asp, res.short, f) }, `${f} fps`))),
    h('div', { class: 'muted small mono' }, `${tl().width} × ${tl().height} px`),
  ];
}
function canvasBlock(): HTMLElement {
  return h('div', { class: 'block' }, h('div', { class: 'label' }, 'Kanvas'), h('button', { class: 'secondary wide', onclick: toggleCanvasPop }, `${fmtLabel()} · ubah`));
}
function toggleCanvasPop() {
  const pop = $('#canvas-pop');
  if (!pop) return;
  pop.hidden = !pop.hidden;
  renderCanvasPop();
}
function renderCanvasPop() {
  const pop = $('#canvas-pop');
  if (!pop || pop.hidden || !P) return;
  pop.replaceChildren(
    h('div', { class: 'row-between' }, h('h3', {}, 'Kanvas'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: toggleCanvasPop }, icon('x', 15))),
    ...canvasControls(),
    h('div', { class: 'muted small' }, 'Posisi teks, meme, dan layer ikut menyesuaikan. Video utama mengisi kanvas baru (atur di Transform kalau perlu).'),
  );
}

// ---------- colour grading in the preview ----------
let gradeBypass = false;   // "Bandingkan": show the picture without grading
const lutLoading = new Set<string>();
function ensureLut(path?: string) {
  if (!path || lutReady(path) || lutLoading.has(path)) return;
  lutLoading.add(path);
  invoke<string>('read_text', { path }).then((txt) => { registerLut(path, parseLut(txt)); renderFrame(); })
    .catch(() => toast('File LUT tidak bisa dibaca.', 'error')).finally(() => lutLoading.delete(path));
}
/** The graded picture of a source for the preview, or null when it needs no grading. */
let gradeCss = '';   // set when WebGL could not grade: the caller draws with this CSS filter instead
let warnedGrade = false;
function graded(src: TexImageSource, g: Grade | undefined, w: number, h: number): HTMLCanvasElement | null {
  gradeCss = '';
  if (gradeBypass || !g || isNeutral(g)) return null;
  const x = gradeOf(g);
  if (!hasColour(x) && x.sharpen < 0.005) return null;
  ensureLut(x.lut);
  const k = Math.min(1, 1600 / Math.max(w, h));
  const out = gradeImage(src, w * k, h * k, x);
  if (!out) {
    gradeCss = cssFilterOf(x);
    if (!warnedGrade && x.lut) { warnedGrade = true; toast('Preview LUT tidak tersedia untuk file ini; hasil ekspor tetap memakai LUT.'); }
  }
  return out;
}
/** drawImage with the grade applied (WebGL, or the CSS fallback). */
function drawGraded(ctx: CanvasRenderingContext2D, src: CanvasImageSource, g: Grade | undefined, sw: number, sh: number,
  crop: [number, number, number, number] | null, dx: number, dy: number, dw: number, dh: number) {
  const out = graded(src as TexImageSource, g, sw, sh);
  const prev = ctx.filter;
  if (!out && gradeCss) ctx.filter = prev && prev !== 'none' ? `${prev} ${gradeCss}` : gradeCss;
  const img = out ?? src;
  const kx = out ? out.width / sw : 1, ky = out ? out.height / sh : 1;
  if (crop) ctx.drawImage(img, crop[0] * kx, crop[1] * ky, crop[2] * kx, crop[3] * ky, dx, dy, dw, dh);
  else ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = prev;
}
const vignetteOf = (g?: Grade) => (gradeBypass || !g ? 0 : gradeOf(g).vignette);

function renderFrameInner() {
  if (!preview || !P) return;
  const ctx = preview.getContext('2d');
  if (!ctx) return;
  const W = preview.width, H = preview.height;
  ctx.fillStyle = tl().background ?? '#000';
  ctx.fillRect(0, 0, W, H);
  boxes = [];
  const loc = locate(tl().clips, t);
  if (loc) {
    const c = tl().clips[loc.index];
    const v = videos.get(c.mediaId) ?? videoFor(c.mediaId);
    if (v && v.readyState >= 2 && v.videoWidth) {
      const vw = v.videoWidth, vh = v.videoHeight;
      const kk = W / tl().width;
      const fx = clipFx(loc.index > 0 ? (c.trans ?? 'none') : 'none', t - loc.startMs, Math.max(1, c.zoom ?? 1));
      const z = fx.zoom;
      if (fx.blur) ctx.filter = `blur(${Math.round(10 * kk * 2)}px)`;
      ctx.translate(-fx.dx * kk, -fx.dy * kk);
      const s = c.fit === 'fill' ? Math.max((W * z) / vw, (H * z) / vh) : Math.min((W * z) / vw, (H * z) / vh);
      const dw = vw * s, dh = vh * s;
      const pw = Math.max(dw, W), ph = Math.max(dh, H);
      const ox = (pw - W) * (c.zx ?? 0.5), oy = (ph - H) * (c.zy ?? 0.5);
      drawGraded(ctx, v, c.grade, vw, vh, null, (pw - dw) / 2 - ox, (ph - dh) / 2 - oy, dw, dh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = 'none';
      drawVignette(ctx, 0, 0, W, H, vignetteOf(c.grade));
      // flash / dip-to-black, and the fade-out before a "Gelap" cut
      const next = tl().clips[loc.index + 1];
      const left = loc.startMs + clipDuration(c) - t;
      const black = Math.max(fx.black, next?.trans === 'fade' && left < 250 ? 1 - left / 250 : 0);
      if (fx.white > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.white})`; ctx.fillRect(0, 0, W, H); }
      if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${black})`; ctx.fillRect(0, 0, W, H); }
    }
  } else if (!isBlank()) {
    ctx.fillStyle = '#6b6b6b';
    ctx.font = '500 18px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tambahkan video dari tab Media', W / 2, H / 2);
  }
  drawLayers(ctx, W, H);
  const k = (W / tl().width) * unitOf(tl());
  for (const im of images()) {
    if (t < im.startMs || t >= im.endMs || im.hidden) continue;
    const img = imageEl(im.file);
    // animated GIF: the frame for this moment, like the export (which loops it from its start)
    const ga = im.animated ? gifAnim(im.file) : null;
    const el: CanvasImageSource & { naturalWidth: number; naturalHeight: number; complete: boolean } = ga
      ? Object.assign(gifFrameAt(ga, t - im.startMs), { naturalWidth: ga.w, naturalHeight: ga.h, complete: true })
      : img;
    const w = im.scale * W, hh = w / im.aspect;
    const x = im.x * W - w / 2, y = im.y * H - hh / 2;
    const an = transState(im, t - im.startMs);
    if (el.complete && el.naturalWidth) {
      const aw = w * an.scale, ah = hh * an.scale;
      ctx.globalAlpha = an.alpha;
      ctx.globalCompositeOperation = blendCss(im.blend);
      drawTf(ctx, im.tf, im.x * W, im.y * H + an.dy * H, aw, ah, (c, x, y, w, hh) => {
        if (!needsFx(im)) { drawGraded(c, el, im.grade, el.naturalWidth, el.naturalHeight, null, x, y, w, hh); return; }
        c.drawImage(withMaskKey(w, hh, im, (fc) => drawGraded(fc, el, im.grade, el.naturalWidth, el.naturalHeight, null, 0, 0, Math.round(w), Math.round(hh))), x, y, w, hh);
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    boxes.push({ kind: 'image', id: im.id, x, y, w, h: hh });
    if (sel?.kind === 'image' && sel.id === im.id) {
      ctx.strokeStyle = '#2ec4b6'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(x - 3, y - 3, w + 6, hh + 6); ctx.setLineDash([]);
    }
  }
  const wm = tl().watermark;
  if (wm && loc) {
    const el = imageEl(wm.file);
    if (el.complete && el.naturalWidth) {
      const w = wm.scale * Math.min(W, H), hh = w / wm.aspect, m = 40 * k;
      ctx.globalAlpha = wm.opacity;
      ctx.drawImage(el, wm.corner.endsWith('l') ? m : W - w - m, wm.corner.startsWith('t') ? m + 60 * k : H - hh - m - (H > W ? 220 : 40) * k, w, hh);
      ctx.globalAlpha = 1;
    }
  }
  drawOverlays(ctx, overlayPlan(t, W, H, k), k, true);
  drawSafeGuide(ctx, W, H);
  drawDistortHandles(ctx);
}

type AnimSt = ReturnType<typeof textAnimState>;
/** What the captions and text look like at one moment: plain data, so the export can tell when a frame changes. */
type OverlayPlan = {
  cap?: { id: string; lines: Seg[][]; cx: number; cy: number; dy: number; style: TextStyle; an: AnimSt };
  texts: { id: string; full: Seg[][]; shown: Seg[][] | null; cx: number; cy: number; dy: number; style: TextStyle; an: AnimSt; rot?: number }[];
};

function overlayPlan(tt: number, W: number, H: number, k: number): OverlayPlan {
  const plan: OverlayPlan = { texts: [] };
  const cap = tl().captions;
  const line = cap.hidden ? undefined : cap.lines.find((l) => tt >= l.startMs && tt < l.endMs);
  if (line) {
    const anim: CapAnim = lineAnimOf(line, cap);
    let active = -1;
    line.words.forEach((w, i) => { if (tt >= w.startMs) active = i; });
    const segs: Seg[] = line.words.map((w, i) => ({
      text: capWordText(w, cap.caps),
      color: wordColor(w, i === active, cap),
      scale: wordScale(w.fx, anim, i === active, i <= active ? tt - Math.max(line.startMs, w.startMs) : -1),
      hidden: anim === 'word' && i > active,
    }));
    // line entrance/exit like the export: pop, fade, rise and shake reuse the text animation curves
    const entrance = anim === 'pop' || anim === 'fade' || anim === 'rise' || anim === 'shake' ? anim : 'none';
    const an = textAnimState(entrance, tt - line.startMs, line.endMs - line.startMs, 0);
    plan.cap = { id: line.id, lines: rowsByBreaks(segs, captionBreaks(line)), cx: W / 2, cy: cap.y * H, dy: an.dy * (60 / 90) * k, style: cap.style, an };
  }
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const mctx = measureCtx!;
  for (const x of tl().texts) {
    if (tt < x.startMs || tt >= x.endMs || !x.text.trim() || x.hidden) continue;
    const full = x.text.split('\n').flatMap((l) => wrapSegs(mctx, l.split(/\s+/).filter(Boolean).map((w) => ({ text: w, color: x.style.color })), x.style, k, W - 120 * k));
    const total = [...x.text].filter((c) => c !== '\n').length;
    const an = textAnimState(x.anim, tt - x.startMs, x.endMs - x.startMs, total);
    let shown: Seg[][] | null = null;
    if (an.chars < total) {
      // typewriter: keep the final layout, draw only the characters revealed so far
      let left = an.chars;
      shown = full.map((ln) => ln.map((seg) => {
        const take = Math.max(0, Math.min(seg.text.length, left));
        left -= seg.text.length;
        return { ...seg, text: seg.text.slice(0, take) };
      }));
    }
    plan.texts.push({ id: x.id, full, shown, cx: x.x * W, cy: x.y * H, dy: an.dy * k, style: x.style, an, rot: x.rot });
  }
  return plan;
}

/** Draws a plan. With `ui`, also records hit boxes and outlines the selected text. */
function drawOverlays(ctx: CanvasRenderingContext2D, plan: OverlayPlan, k: number, ui: boolean) {
  const c = plan.cap;
  if (c) {
    if (ui) {
      ctx.save(); ctx.globalAlpha = 0;
      const b = drawText(ctx, c.lines, c.cx, c.cy, c.style, k);
      ctx.restore();
      boxes.push({ kind: 'captions', id: c.id, ...b });
    }
    if (c.an.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = c.an.alpha;
      ctx.translate(c.cx, c.cy + c.dy);
      if (c.an.rot) ctx.rotate((-c.an.rot * Math.PI) / 180);
      ctx.scale(c.an.scale, c.an.scale);
      ctx.translate(-c.cx, -c.cy);
      drawText(ctx, c.lines, c.cx, c.cy, c.style, k);
      ctx.restore();
    }
  }
  for (const x of plan.texts) {
    if (x.an.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = x.an.alpha;
      const cx = x.cx, cy = x.cy + x.dy;
      ctx.translate(cx, cy);
      if (x.rot) ctx.rotate((x.rot * Math.PI) / 180);
      if (x.an.rot) ctx.rotate((-x.an.rot * Math.PI) / 180);
      ctx.scale(x.an.scale, x.an.scale);
      ctx.translate(-cx, -cy);
      if (x.shown) drawTextFixed(ctx, x.full, x.shown, cx, cy, x.style, k);
      else drawText(ctx, x.full, cx, cy, x.style, k);
      ctx.restore();
    }
    if (!ui) continue;
    // the box for selecting/dragging is the full, still text; the drawing above may be animated
    ctx.save(); ctx.globalAlpha = 0;
    const b = drawText(ctx, x.full, x.cx, x.cy, x.style, k);
    ctx.restore();
    boxes.push({ kind: 'text', id: x.id, ...b });
    if (sel?.kind === 'text' && sel.id === x.id) {
      ctx.strokeStyle = '#3fc2cc';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.setLineDash([]);
    }
  }
}

/** Rough area a plan can paint (scaled words, outline, box and animation included), for cropping export frames. */
function planBounds(ctx: CanvasRenderingContext2D, plan: OverlayPlan, k: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let r: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const add = (lines: Seg[][], cx: number, cy: number, dy: number, st: TextStyle, an: AnimSt, rot = 0) => {
    const b = drawText(ctx, lines, cx, cy, st, k);
    const segMax = Math.max(1, ...lines.flat().map((s) => s.scale ?? 1));
    const sc = Math.max(1, an.scale) * segMax * (an.rot ? 1.25 : 1);
    const pad = (st.outline * 2 + (st.box ? 24 : 0) + 12) * k;
    const sp = (st.spacing ?? 0) * k * 30 + (st.shadow ? (st.shadow.blur + Math.max(Math.abs(st.shadow.x), Math.abs(st.shadow.y))) * k * 2 : 0);
    let hw = (b.w / 2) * sc + pad + sp, hh = (b.h / 2) * sc * 1.25 * Math.max(1, (st.lineHeight ?? 1.18) / 1.18) + pad + sp;
    if (rot) { const d = Math.hypot(hw, hh); hw = d; hh = d; }
    const bx = b.x + b.w / 2, by = b.y + b.h / 2 + dy;
    const q = { x0: bx - hw, y0: by - hh, x1: bx + hw, y1: by + hh };
    r = r ? { x0: Math.min(r.x0, q.x0), y0: Math.min(r.y0, q.y0), x1: Math.max(r.x1, q.x1), y1: Math.max(r.y1, q.y1) } : q;
  };
  ctx.save(); ctx.globalAlpha = 0;
  if (plan.cap) add(plan.cap.lines, plan.cap.cx, plan.cap.cy, plan.cap.dy, plan.cap.style, plan.cap.an);
  for (const x of plan.texts) add(x.full, x.cx, x.cy, x.dy, x.style, x.an, x.rot);
  ctx.restore();
  return r;
}

const planKey = (plan: OverlayPlan) => (plan.cap || plan.texts.length
  ? JSON.stringify(plan, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
  : '');

/**
 * Draws the captions and text for the whole export with the same code as the preview, as PNG frames plus an
 * ffconcat list (one frame per change, held for as long as it stays the same). This way the video shows exactly
 * what the editor showed: same fonts, same line breaks, same positions and the same animation.
 */
async function renderOverlayTrack(dir: string, onProgress: (f: number) => void): Promise<{ list: string; x: number; y: number; dir: string } | null> {
  const T = tl();
  if (!T.captions.lines.length && !T.texts.some((x) => x.text.trim())) return null;
  await document.fonts?.ready;
  const W = T.width, H = T.height, k = unitOf(T);
  const total = timelineDuration(T);
  const step = 1000 / Math.min(30, T.fps || 30);
  const times = new Set<number>([0]);
  const span = (s: number, e: number) => {
    times.add(Math.max(0, Math.round(s))); times.add(Math.max(0, Math.round(e)));
    for (let x = s + step; x < e; x += step) times.add(Math.round(x));
  };
  for (const l of T.captions.lines) { span(l.startMs, l.endMs); for (const w of l.words) times.add(Math.round(w.startMs)); }
  for (const x of T.texts) if (x.text.trim()) span(x.startMs, x.endMs);
  const ts = [...times].filter((x) => x >= 0 && x < total).sort((a, b) => a - b);
  // pass 1: what changes when, and the area it all fits in
  const mctx = (measureCtx ??= document.createElement('canvas').getContext('2d'))!;
  const steps: { t: number; key: string; plan: OverlayPlan }[] = [];
  let r: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const x of ts) {
    const plan = overlayPlan(x, W, H, k);
    const key = planKey(plan);
    if (steps.length && steps[steps.length - 1].key === key) continue;
    steps.push({ t: x, key, plan });
    if (key) {
      const q = planBounds(mctx, plan, k);
      if (q) r = r ? { x0: Math.min(r.x0, q.x0), y0: Math.min(r.y0, q.y0), x1: Math.max(r.x1, q.x1), y1: Math.max(r.y1, q.y1) } : q;
    }
  }
  if (!r) return null;
  const bb = r as { x0: number; y0: number; x1: number; y1: number };
  const x0 = Math.max(0, Math.floor(bb.x0 / 2) * 2), y0 = Math.max(0, Math.floor(bb.y0 / 2) * 2);
  const x1 = Math.min(W, Math.ceil(bb.x1 / 2) * 2), y1 = Math.min(H, Math.ceil(bb.y1 / 2) * 2);
  const cw = Math.max(2, x1 - x0), ch = Math.max(2, y1 - y0);
  // pass 2: draw each different frame once
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d')!;
  const files = new Map<string, string>();
  let n = 0;
  const fileFor = async (key: string, plan: OverlayPlan) => {
    const have = files.get(key);
    if (have) return have;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(-x0, -y0);
    if (key) drawOverlays(ctx, plan, k, false);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Gagal menggambar teks untuk ekspor.');
    const name = `f${n++}.png`;
    await invoke('write_bytes', { path: join(dir, name), content: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    files.set(key, name);
    return name;
  };
  const lines = ['ffconcat version 1.0'];
  if (steps[0].t > 0) steps.unshift({ t: 0, key: '', plan: { texts: [] } });
  for (let i = 0; i < steps.length; i++) {
    const end = i + 1 < steps.length ? steps[i + 1].t : total;
    const name = await fileFor(steps[i].key, steps[i].plan);
    lines.push(`file '${name}'`, `duration ${((end - steps[i].t) / 1000).toFixed(4)}`);
    if (i % 20 === 0) { onProgress(i / steps.length); await new Promise((res) => setTimeout(res, 0)); }
  }
  // the concat demuxer drops the last duration unless the last file is listed once more
  lines.push(`file '${await fileFor('', { texts: [] })}'`);
  const list = join(dir, 'list.ffconcat');
  await invoke('write_text', { path: list, content: lines.join('\n') + '\n' });
  onProgress(1);
  return { list, x: x0, y: y0, dir };
}

/** Shades where TikTok / YouTube Shorts put their buttons and captions, so nothing important lands there. */
function drawSafeGuide(ctx: CanvasRenderingContext2D, W: number, H: number) {
  if (!safeGuide || H <= W) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,92,92,.18)';
  ctx.strokeStyle = 'rgba(255,92,92,.7)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  const zones = [
    { x: 0, y: 0, w: W, h: H * 0.08, label: 'Atas: judul/tab' },
    { x: W * 0.84, y: H * 0.38, w: W * 0.16, h: H * 0.44, label: 'Tombol' },
    { x: 0, y: H * 0.8, w: W, h: H * 0.2, label: 'Nama & deskripsi' },
  ];
  ctx.font = `600 ${Math.round(W / 34)}px "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const z of zones) {
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(z.label, z.x + 6, z.y + 5, z.w - 10);
    ctx.fillStyle = 'rgba(255,92,92,.18)';
  }
  ctx.restore();
}

type Seg = { text: string; color: string; scale?: number; hidden?: boolean };
const fontOf = (st: TextStyle, k: number) => `${st.italic ? 'italic ' : ''}${st.bold ? 700 : 400} ${st.size * k}px "${st.font}", "Segoe UI", sans-serif`;
/** Font and letter spacing of a style, at scale k. */
function setFont(ctx: CanvasRenderingContext2D, st: TextStyle, k: number) {
  ctx.font = fontOf(st, k);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(st.spacing ?? 0) * k}px`;
}
const lineH = (st: TextStyle, k: number) => st.size * k * (st.lineHeight ?? 1.18);
/** One word with outline, shadow and solid or gradient fill. */
function paintSeg(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, st: TextStyle, k: number, color: string, lh: number) {
  const sh = st.shadow;
  const withShadow = (fn: () => void) => {
    if (!sh) { fn(); return; }
    ctx.save(); ctx.shadowColor = sh.color; ctx.shadowBlur = sh.blur * k; ctx.shadowOffsetX = sh.x * k; ctx.shadowOffsetY = sh.y * k; fn(); ctx.restore();
  };
  const outline = !st.box && st.outline > 0;
  if (outline) withShadow(() => { ctx.lineJoin = 'round'; ctx.lineWidth = st.outline * 2 * k; ctx.strokeStyle = st.outlineColor ?? '#000'; ctx.strokeText(text, x, y); });
  if (st.gradient && color === st.color) {
    const gr = ctx.createLinearGradient(0, y - lh * 0.42, 0, y + lh * 0.42);
    gr.addColorStop(0, st.gradient.from); gr.addColorStop(1, st.gradient.to);
    ctx.fillStyle = gr;
  } else ctx.fillStyle = color;
  if (outline) ctx.fillText(text, x, y); else withShadow(() => ctx.fillText(text, x, y));
}

/**
 * Rows of a caption line, measured once with the real font at canvas size and normal word size, so the
 * preview and the export break the line at the same words and the line never re-wraps while words grow.
 */
let measureCtx: CanvasRenderingContext2D | null = null;
function captionBreaks(line: CaptionLine): number[] {
  if (!P) return [];
  const cap = tl().captions;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  const u = unitOf(tl());
  setFont(ctx, cap.style, u);
  const space = ctx.measureText(' ').width;
  const anim = lineAnimOf(line, cap);
  const widths = line.words.map((wd) => ctx.measureText(capWordText(wd, cap.caps)).width);
  // leave room for the word that grows while it is said (bounce, pop, shout), so it stays inside the screen
  const grow = Math.max(0, ...line.words.map((wd, i) => { const p = wordPulse(wd.fx, anim); return (Math.max(p.peak, p.base) - 1) * widths[i]; }));
  const maxW = tl().width - 120 * u - grow;
  const out: number[] = [];
  let w = 0;
  line.words.forEach((wd, i) => {
    const sw = widths[i];
    if (i && w + space + sw > maxW) { out.push(i); w = 0; }
    w += (w ? space : 0) + sw;
  });
  return out;
}
function rowsByBreaks<T>(items: T[], breaks: number[]): T[][] {
  const rows: T[][] = [];
  let cur: T[] = [];
  items.forEach((it, i) => { if (i && breaks.includes(i)) { rows.push(cur); cur = []; } cur.push(it); });
  if (cur.length) rows.push(cur);
  return rows;
}

function wrapSegs(ctx: CanvasRenderingContext2D, segs: Seg[], st: TextStyle, k: number, maxW: number): Seg[][] {
  setFont(ctx, st, k);
  const space = ctx.measureText(' ').width;
  const lines: Seg[][] = [];
  let cur: Seg[] = [], w = 0;
  for (const s of segs) {
    const sw = ctx.measureText(s.text).width;
    if (cur.length && w + space + sw > maxW) { lines.push(cur); cur = []; w = 0; }
    w += (cur.length ? space : 0) + sw;
    cur.push(s);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Draws `shown` (a prefix of `full`) at the positions `full` would have, so typing does not shift the text. */
function drawTextFixed(ctx: CanvasRenderingContext2D, full: Seg[][], shown: Seg[][], cx: number, cy: number, st: TextStyle, k: number) {
  setFont(ctx, st, k);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  const lh = lineH(st, k);
  const widths = full.map((l) => l.reduce((s, x, i) => s + ctx.measureText(x.text).width + (i ? space : 0), 0));
  const top = cy - (lh * full.length) / 2;
  full.forEach((l, li) => {
    let x = cx - widths[li] / 2;
    const y = top + lh * (li + 0.5);
    l.forEach((seg, si) => {
      const part = shown[li]?.[si]?.text ?? '';
      if (part) {
        if (st.box) { ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(x - 4 * k, y - lh / 2, ctx.measureText(part).width + 8 * k, lh); }
        paintSeg(ctx, part, x, y, st, k, seg.color, lh);
      }
      x += ctx.measureText(seg.text).width + space;
    });
  });
}

function drawText(ctx: CanvasRenderingContext2D, lines: Seg[][], cx: number, cy: number, st: TextStyle, k: number) {
  setFont(ctx, st, k);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  const lh = lineH(st, k);
  // a scaled word (bounce) takes its scaled width, so the words beside it make room, as in the export
  const segW = (x: Seg) => ctx.measureText(x.text).width * (x.hidden ? 1 : (x.scale ?? 1));
  const widths = lines.map((l) => l.reduce((s, x, i) => s + segW(x) + (i ? space : 0), 0));
  const totalH = lh * lines.length;
  const top = cy - totalH / 2;
  const maxW = Math.max(0, ...widths);
  lines.forEach((l, li) => {
    let x = cx - widths[li] / 2;
    const y = top + lh * (li + 0.5);
    if (st.box) {
      const pad = 18 * k;
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.fillRect(x - pad, y - lh / 2 - pad / 3, widths[li] + pad * 2, lh + (pad * 2) / 3);
    }
    for (const s of l) {
      const sw = segW(s);
      if (!s.hidden) {
        const sc = s.scale ?? 1;
        if (sc !== 1) { ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y); }
        paintSeg(ctx, s.text, x, y, st, k, s.color, lh);
        if (sc !== 1) ctx.restore();
      }
      x += sw + space;
    }
  });
  return { x: cx - maxW / 2, y: top, w: maxW, h: totalH };
}

/** Drag text (or the captions) around on the preview. */
function setupPreviewDrag() {
  preview.addEventListener('contextmenu', (e) => { e.preventDefault(); previewMenu(e); });
  let pan: { c: VideoClip; sx: number; sy: number; ox: number; oy: number } | null = null;
  let drag: { box: Box; sx: number; sy: number; ox: number; oy: number } | null = null;
  const toCanvas = (e: PointerEvent) => {
    const r = preview.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * preview.width, y: ((e.clientY - r.top) / r.height) * preview.height };
  };
  let distortDrag: ((q: { x: number; y: number }) => void) | null = null;
  preview.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = toCanvas(e);
    if (pickingKey) {
      const kk = pickingKey; pickingKey = null; preview.style.cursor = '';
      keyBypass = true; renderFrame();
      try {
        const px = preview.getContext('2d')!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        snapshot(); kk.color = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        toast(`Warna latar ${kk.color} dipakai.`);
      } catch { toast('Warna tidak bisa diambil dari preview ini.', 'error'); }
      keyBypass = false; changed();
      return;
    }
    distortDrag = distortPointerDown(p);
    if (distortDrag) { preview.setPointerCapture(e.pointerId); return; }
    if (layerPointerDown(p, e)) { preview.setPointerCapture(e.pointerId); return; }
    const hit = [...boxes].reverse().find((b) => b.kind !== 'layer' && p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10)
      ?? [...boxes].reverse().find((b) => b.kind === 'layer' && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (hit?.kind === 'layer') {
      sel = { kind: 'layer', id: hit.id };
      renderInspector(); drawTimeline(); renderFrame();
      layerPointerDown(p, e);
      preview.setPointerCapture(e.pointerId);
      return;
    }
    if (!hit) {
      const loc = locate(tl().clips, t);
      const c = loc ? tl().clips[loc.index] : undefined;
      if (c && (c.zoom ?? 1) > 1) {
        snapshot();
        sel = { kind: 'clip', id: c.id };
        pan = { c, sx: p.x, sy: p.y, ox: c.zx ?? 0.5, oy: c.zy ?? 0.5 };
        preview.setPointerCapture(e.pointerId);
        renderInspector(); drawTimeline();
        return;
      }
      if (sel?.kind === 'text' || sel?.kind === 'image') { sel = null; renderInspector(); renderFrame(); drawTimeline(); }
      return;
    }
    if (isLocked(hit.kind === 'captions' ? 'line' : hit.kind, hit.id)) {
      sel = { kind: hit.kind === 'captions' ? 'line' : hit.kind as SelKind, id: hit.id };
      renderInspector(); drawTimeline(); renderFrame();
      lockedToast();
      return;
    }
    snapshot();
    if (hit.kind === 'text') {
      const x = tl().texts.find((q) => q.id === hit.id)!;
      sel = { kind: 'text', id: x.id };
      drag = { box: hit, sx: p.x, sy: p.y, ox: x.x, oy: x.y };
    } else if (hit.kind === 'image') {
      const x = images().find((q) => q.id === hit.id)!;
      sel = { kind: 'image', id: x.id };
      drag = { box: hit, sx: p.x, sy: p.y, ox: x.x, oy: x.y };
    } else {
      sel = { kind: 'line', id: hit.id };
      drag = { box: hit, sx: p.x, sy: p.y, ox: 0.5, oy: tl().captions.y };
    }
    renderInspector();
    drawTimeline();
    preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener('pointermove', (e) => {
    if (distortDrag) { distortDrag(toCanvas(e)); return; }
    const p = toCanvas(e);
    if (layerPointerMove(p, e)) return;
    if (pan) {
      const z = Math.max(1.01, pan.c.zoom ?? 1);
      pan.c.zx = clamp(pan.ox - (p.x - pan.sx) / preview.width / (z - 1), 0, 1);
      pan.c.zy = clamp(pan.oy - (p.y - pan.sy) / preview.height / (z - 1), 0, 1);
      renderFrame();
      return;
    }
    if (!drag) {
      preview.style.cursor = boxes.some((b) => p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) ? 'move' : 'default';
      return;
    }
    const dx = (p.x - drag.sx) / preview.width, dy = (p.y - drag.sy) / preview.height;
    if (drag.box.kind === 'text') {
      const x = tl().texts.find((q) => q.id === drag!.box.id);
      if (x) { x.x = snap(clamp(drag.ox + dx, 0.05, 0.95), 0.5); x.y = clamp(drag.oy + dy, 0.03, 0.97); }
    } else if (drag.box.kind === 'image') {
      const x = images().find((q) => q.id === drag!.box.id);
      if (x) { x.x = snap(clamp(drag.ox + dx, 0, 1), 0.5); x.y = clamp(drag.oy + dy, 0, 1); }
    } else {
      tl().captions.y = clamp(drag.oy + dy, 0.08, 0.92);
    }
    renderFrame();
  });
  const end = () => { if (distortDrag) { distortDrag = null; changed(); return; } if (layerPointerUp()) return; if (drag || pan) { void saveProject(P!); drag = null; pan = null; } };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);
  preview.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !P) return;
    const r = preview.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * preview.width, py = ((e.clientY - r.top) / r.height) * preview.height;
    const hit = [...boxes].reverse().find((b) => b.kind === 'image' && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    if (!hit) return;
    e.preventDefault();
    const im = images().find((q) => q.id === hit.id);
    if (!im) return;
    im.scale = clamp(im.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 0.08, 1.2);
    sel = { kind: 'image', id: im.id };
    void saveProject(P);
    renderFrame();
  }, { passive: false });
}
const snap = (v: number, to: number) => (Math.abs(v - to) < 0.015 ? to : v);

// ================= timeline =================

const HEAD_W = 0;
const RULER = 24, ROW_TEXT = 26, ROW_CAP = 26, ROW_MAIN = 64, GAP = 6;

interface Lane { kind: 'text' | 'image' | 'layer' | 'captions' | 'main' | 'sound' | 'music'; y: number; h: number }
let lanes: Lane[] = [];
let textRows = new Map<string, number>();
const ROW_SOUND = 24;

/** Packs overlapping items into rows; returns row per id and the row count. */
function pack(items: { id: string; startMs: number; endMs: number }[], rows: Map<string, number>) {
  const ends: number[] = [];
  for (const x of [...items].sort((a, b) => a.startMs - b.startMs)) {
    let r = ends.findIndex((e) => e <= x.startMs);
    if (r < 0) { r = ends.length; ends.push(0); }
    ends[r] = x.endMs;
    rows.set(x.id, r);
  }
  return Math.max(1, ends.length);
}
const soundEnd = (s: SoundItem) => s.startMs + s.lengthMs;

function computeLanes() {
  textRows = new Map();
  const nText = pack(tl().texts, textRows);
  const nImg = pack(images(), textRows);
  const nSnd = pack(sounds().map((s) => ({ id: s.id, startMs: s.startMs, endMs: soundEnd(s) })), textRows);
  let y = RULER + GAP;
  lanes = [];
  for (let i = 0; i < nText; i++) { lanes.push({ kind: 'text', y, h: ROW_TEXT }); y += ROW_TEXT + 3; }
  for (let i = 0; i < nImg; i++) { lanes.push({ kind: 'image', y, h: ROW_TEXT }); y += ROW_TEXT + 3; }
  const nLay = layers().length ? pack(layers(), textRows) : 0;
  for (let i = 0; i < nLay; i++) { lanes.push({ kind: 'layer', y, h: ROW_TEXT }); y += ROW_TEXT + 3; }
  y += GAP - 3;
  lanes.push({ kind: 'captions', y, h: ROW_CAP }); y += ROW_CAP + GAP;
  lanes.push({ kind: 'main', y, h: ROW_MAIN }); y += ROW_MAIN + GAP;
  for (let i = 0; i < nSnd; i++) { lanes.push({ kind: 'sound', y, h: ROW_SOUND }); y += ROW_SOUND + 3; }
  const nMus = pack(music().map((m) => ({ id: m.id, startMs: m.startMs, endMs: m.startMs + m.lengthMs })), textRows);
  for (let i = 0; i < nMus; i++) { lanes.push({ kind: 'music', y, h: ROW_SOUND }); y += ROW_SOUND + 3; }
  return y + GAP;
}

function sizeTimeline() {
  if (!tlCanvas || !P) return;
  const body = $('#tl-body')!;
  const dpr = window.devicePixelRatio || 1;
  const hgt = Math.max(computeLanes(), body.clientHeight);
  tlCanvas.width = Math.floor(body.clientWidth * dpr);
  tlCanvas.height = Math.floor(hgt * dpr);
  tlCanvas.style.width = `${body.clientWidth}px`;
  tlCanvas.style.height = `${hgt}px`;
  drawTimeline();
}

const msToX = (ms: number) => HEAD_W + (ms / 1000) * pxPerSec - scrollX;
const xToMs = (x: number) => ((x - HEAD_W + scrollX) / pxPerSec) * 1000;

function zoomBy(f: number, anchorX?: number) {
  const body = $('#tl-body');
  const ax = anchorX ?? msToX(t);
  const at = xToMs(ax);
  pxPerSec = clamp(pxPerSec * f, 2, 600);
  scrollX = Math.max(0, (at / 1000) * pxPerSec - (ax - HEAD_W));
  const z = $<HTMLInputElement>('#zoom');
  if (z) { z.value = String(Math.round((Math.log(pxPerSec / 2) / Math.log(300)) * 100)); paintRange(z as HTMLInputElement); }
  if (body) drawTimeline();
}
function setZoomFromSlider(v: number) { zoomBy((2 * Math.pow(300, v / 100)) / pxPerSec); }
function fitZoom() {
  const body = $('#tl-body');
  if (!body || !P) return;
  const total = Math.max(isBlank() ? 30000 : 5000, timelineDuration(tl()));
  pxPerSec = clamp(((body.clientWidth - 60) / total) * 1000, 2, 600);
  scrollX = 0;
  const z = $<HTMLInputElement>('#zoom');
  if (z) { z.value = String(Math.round((Math.log(pxPerSec / 2) / Math.log(300)) * 100)); paintRange(z as HTMLInputElement); }
  sizeTimeline();
}

function niceStep() {
  const target = 90 / pxPerSec * 1000;
  return [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000].find((s) => s >= target) ?? 600000;
}

function laneOf(kind: Lane['kind'], row = 0) {
  return lanes.filter((l) => l.kind === kind)[row] ?? lanes.find((l) => l.kind === kind)!;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  // very short items can be narrower than a pixel when zoomed out; never pass a negative size or radius
  const ww = Math.max(1, w), hhh = Math.max(1, hh);
  ctx.beginPath();
  ctx.roundRect(x, y, ww, hhh, Math.max(0, Math.min(r, ww / 2, hhh / 2)));
}

/** Reports a drawing error once (not every frame) and lets the rest of the app keep working. */
const reported = new Set<string>();
function reportOnce(e: unknown) {
  const msg = (e as Error)?.message ?? String(e);
  console.error(e);
  if (reported.has(msg)) return;
  reported.add(msg);
  toast(`Terjadi error tampilan: ${msg}`, 'error');
}

function drawTimeline() { try { drawTimelineInner(); } catch (e) { reportOnce(e); } }

/** Timeline colours per item type: a soft tinted capsule, solid when selected. */
const TL_HUE: Record<'line' | 'text' | 'layer' | 'image' | 'music' | 'sound', { hue: string; ink: string; icon: IconName }> = {
  line: { hue: '#f2c14e', ink: '#f7dc98', icon: 'captions' },
  text: { hue: '#ff8a73', ink: '#ffc2b5', icon: 'text' },
  layer: { hue: '#5aa9ff', ink: '#bcdcff', icon: 'layers' },
  image: { hue: '#3fc2cc', ink: '#a5ece3', icon: 'image' },
  music: { hue: '#b98cff', ink: '#dcc6ff', icon: 'music' },
  sound: { hue: '#59d38c', ink: '#b2efcb', icon: 'wave' },
};
const TL_FONT = 'Inter, "Segoe UI Variable Text", "Segoe UI", sans-serif';

function capsule(ctx: CanvasRenderingContext2D, kind: keyof typeof TL_HUE, x: number, y: number, w: number, hgt: number, isSel: boolean, label: string, dim = false, thumb?: (lx: number) => number) {
  const c = TL_HUE[kind];
  const r = Math.min(8, hgt / 2);
  const ww = Math.max(6, w - 2);
  roundRect(ctx, x + 1, y + 0.5, ww, hgt - 1, r);
  ctx.globalAlpha = dim ? 0.5 : 1;
  ctx.fillStyle = isSel ? c.hue : `${c.hue}2b`;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isSel ? '#ffffff' : `${c.hue}6e`;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (ww < 18) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 2, y, ww - 4, hgt); ctx.clip();
  let lx = x + 8;
  if (thumb) lx = thumb(lx);
  else if (ww > 34) { drawIcon(ctx, c.icon, lx, y + hgt / 2 - 6, 12, isSel ? '#10201e' : c.hue); lx += 17; }
  ctx.fillStyle = isSel ? '#111414' : c.ink;
  ctx.font = `600 10.5px ${TL_FONT}`;
  ctx.fillText(label, lx, y + hgt / 2 + 0.5);
  ctx.restore();
}

// ---------- audio fades on the timeline ----------
type FadeKind = 'clip' | 'sound' | 'music' | 'layer';
let fadeHandles: { kind: FadeKind; id: string; which: 'in' | 'out'; x: number; y: number }[] = [];
/** The item whose audio fades, where it sits on the timeline, and its fade defaults. */
function fadeTarget(kind: FadeKind, id: string) {
  if (kind === 'clip') {
    const i = tl().clips.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = tl().clips[i];
    return { obj: c as { fadeInMs?: number; fadeOutMs?: number }, start: clipStarts(tl().clips)[i], len: clipDuration(c), defIn: 0, defOut: 0 };
  }
  if (kind === 'sound') { const x = sounds().find((q) => q.id === id); return x ? { obj: x, start: x.startMs, len: x.lengthMs, defIn: 0, defOut: 0 } : null; }
  if (kind === 'music') { const x = music().find((q) => q.id === id); return x ? { obj: x, start: x.startMs, len: Math.min(x.lengthMs, timelineDuration(tl()) - x.startMs), defIn: MUSIC_FADE_IN, defOut: MUSIC_FADE_OUT } : null; }
  const x = layers().find((q) => q.id === id);
  return x ? { obj: x, start: x.startMs, len: Math.min(x.endMs, timelineDuration(tl())) - x.startMs, defIn: 0, defOut: 0 } : null;
}
/** Ramps showing an audio fade, plus draggable dots when the item is selected. */
function drawFades(ctx: CanvasRenderingContext2D, kind: FadeKind, id: string, x: number, y: number, w: number, hgt: number, isSel: boolean) {
  const ft = fadeTarget(kind, id);
  if (!ft) return;
  const { fi, fo } = fadesOf(ft.obj, ft.len, ft.defIn, ft.defOut);
  const fiPx = (fi / 1000) * pxPerSec, foPx = (fo / 1000) * pxPerSec;
  ctx.save();
  roundRect(ctx, x + 1, y + 0.5, Math.max(6, w - 2), hgt - 1, Math.min(8, hgt / 2));
  ctx.clip();
  ctx.fillStyle = 'rgba(8,10,10,.45)';
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.lineWidth = 1.2;
  if (fiPx > 1) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + fiPx, y); ctx.lineTo(x, y + hgt); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y + hgt); ctx.lineTo(x + fiPx, y); ctx.stroke();
  }
  if (foPx > 1) {
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w - foPx, y); ctx.lineTo(x + w, y + hgt); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w, y + hgt); ctx.lineTo(x + w - foPx, y); ctx.stroke();
  }
  ctx.restore();
  if (!isSel || w < 30) return;
  for (const [which, hx] of [['in', x + Math.max(6, fiPx)], ['out', x + w - Math.max(6, foPx)]] as const) {
    ctx.beginPath(); ctx.arc(hx, y + 5, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#0f1414'; ctx.lineWidth = 1.5; ctx.stroke();
    fadeHandles.push({ kind, id, which, x: hx, y: y + 5 });
  }
}

/** Fade in / fade out sliders, mirrored by the dots on the timeline. */
function fadeBlock(kind: FadeKind, id: string): HTMLElement {
  const ft = fadeTarget(kind, id);
  if (!ft) return h('span');
  const cur = fadesOf(ft.obj, ft.len, ft.defIn, ft.defOut);
  const maxS = Math.max(0.1, Math.min(10, (ft.len - 100) / 1000));
  const slider = (which: 'in' | 'out') => {
    const v = (which === 'in' ? cur.fi : cur.fo) / 1000;
    const name = which === 'in' ? 'Fade in' : 'Fade out';
    return field(`${name} ${v.toFixed(1)} dtk`, h('input', {
      type: 'range', min: 0, max: maxS, step: 0.1, value: Math.min(v, maxS),
      onpointerdown: () => snapshot(),
      oninput: (e) => {
        const val = Number((e.target as HTMLInputElement).value) * 1000;
        const other = which === 'in' ? fadesOf(ft.obj, ft.len, ft.defIn, ft.defOut).fo : fadesOf(ft.obj, ft.len, ft.defIn, ft.defOut).fi;
        const ok = Math.round(clamp(val, 0, ft.len - other - 50));
        if (which === 'in') ft.obj.fadeInMs = ok; else ft.obj.fadeOutMs = ok;
        ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `${name} ${(ok / 1000).toFixed(1)} dtk`;
        drawTimeline();
      },
      onchange: () => changed({ inspector: false, left: tab === 'music' }),
    }));
  };
  return h('div', { class: 'block fade-block' },
    h('div', { class: 'label' }, 'Fade suara'),
    h('div', { class: 'fade-pic', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(45, (cur.fi / ft.len) * 100)}%` }), h('b'), h('i', { style: `width:${Math.min(45, (cur.fo / ft.len) * 100)}%` })),
    slider('in'), slider('out'),
    h('div', { class: 'muted small' }, 'Atau tarik titik putih di pojok atas kotaknya di timeline.'),
  );
}

function laneHint(ctx: CanvasRenderingContext2D, name: IconName, text: string, y: number, hgt: number) {
  drawIcon(ctx, name, 10, y + hgt / 2 - 6, 12, '#4d5452');
  ctx.fillStyle = '#5e6562';
  ctx.font = `500 11px ${TL_FONT}`;
  ctx.fillText(text, 27, y + hgt / 2 + 0.5);
}

function drawTimelineInner() {
  if (!tlCanvas || !P) return;
  const ctx = tlCanvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = tlCanvas.width / dpr, H = tlCanvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#10161c';
  ctx.fillRect(0, 0, W, H);
  computeLanes();
  fadeHandles = [];

  // lane backgrounds
  for (const l of lanes) {
    ctx.fillStyle = l.kind === 'main' ? '#141c23' : '#121920';
    roundRect(ctx, 4, l.y - 1, W - 8, l.h + 2, 8);
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  const lt = laneOf('text'), lc = laneOf('captions');
  if (!tl().texts.length) laneHint(ctx, 'text', 'Teks', lt.y, lt.h);
  if (!tl().clips.length) { const lmn = laneOf('main'); laneHint(ctx, 'video', isBlank() ? `Kanvas kosong · ${tc(timelineDuration(tl()))} · tambah video di panel Media, atau taruh layer, teks, meme, musik` : 'Video utama', lmn.y, lmn.h); }
  if (!tl().captions.lines.length) laneHint(ctx, 'captions', 'Subtitle', lc.y, lc.h);
  const li = laneOf('image'), ls = laneOf('sound');
  if (!images().length) laneHint(ctx, 'image', 'Meme', li.y, li.h);
  if (!sounds().length) laneHint(ctx, 'wave', 'Suara: pause, lalu klik pad di panel Suara', ls.y, ls.h);
  const lmu = laneOf('music');
  if (!music().length) laneHint(ctx, 'music', 'Musik latar: panel Musik', lmu.y, lmu.h);

  // ruler
  ctx.fillStyle = '#0e1419';
  ctx.fillRect(0, 0, W, RULER);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(0, RULER - 1, W, 1);
  const step = niceStep();
  ctx.font = '10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  for (let ms = Math.floor(xToMs(0) / step) * step; msToX(ms) < W; ms += step) {
    if (ms < 0) continue;
    const x = msToX(ms);
    ctx.fillStyle = '#3d4342';
    ctx.fillRect(x, RULER - 8, 1, 7);
    ctx.fillStyle = '#8d9390';
    ctx.fillText(step < 1000 ? tc(ms, true) : tc(ms), x + 4, 9);
    for (let s = 1; s < 5; s++) { ctx.fillStyle = '#2a2e2d'; ctx.fillRect(x + (s * step * pxPerSec) / 5000, RULER - 4, 1, 3); }
  }

  // main track: clips with filmstrip
  const lm = laneOf('main');
  const starts = clipStarts(tl().clips);
  tl().clips.forEach((c, i) => {
    const x = msToX(starts[i]), w = (clipDuration(c) / 1000) * pxPerSec;
    if (x + w < 0 || x > W) return;
    const isSel = sel?.kind === 'clip' && sel.id === c.id;
    ctx.save();
    roundRect(ctx, x + 1, lm.y, w - 2, lm.h, 9);
    ctx.clip();
    ctx.fillStyle = '#1c2630';
    ctx.fillRect(x, lm.y, w, lm.h);
    const m = mediaOf(c.mediaId);
    const imgs = m ? sheets.get(m.id) : undefined;
    if (m && imgs?.length) {
      const fw = m.thumbs.tw * (lm.h / m.thumbs.th);
      for (let fx = Math.max(x, -fw); fx < Math.min(x + w, W); fx += fw) {
        const src = c.inMs + ((fx - x + fw / 2) / pxPerSec) * 1000 * c.speed;
        const idx = Math.floor(src / 1000 / m.thumbs.everySec);
        const sheet = imgs[Math.floor(idx / 100)];
        if (!sheet?.complete || !sheet.naturalWidth) continue;
        const kk = idx % 100;
        ctx.drawImage(sheet, (kk % 10) * m.thumbs.tw, Math.floor(kk / 10) * m.thumbs.th, m.thumbs.tw, m.thumbs.th, fx, lm.y, fw, lm.h);
      }
    }
    const grad = ctx.createLinearGradient(0, lm.y + lm.h - 22, 0, lm.y + lm.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, lm.y + lm.h - 22, w, 22);
    const wv = m?.hasAudio ? waveOf(m.playable) : undefined;
    if (wv) drawWave(ctx, wv, x, lm.y + lm.h - 26, w, 24, W, (dx) => c.inMs + (dx / pxPerSec) * 1000 * c.speed, 'rgba(120,214,226,.55)');
    ctx.fillStyle = '#f2f4f1';
    ctx.font = `600 10px ${TL_FONT}`;
    const label = `${c.speed !== 1 ? `${c.speed}× · ` : ''}${tc(clipDuration(c), true)}`;
    ctx.fillText(label, x + 6, lm.y + lm.h - 8);
    ctx.restore();
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#3fc2cc' : 'rgba(0,0,0,.6)';
    roundRect(ctx, x + 1, lm.y, w - 2, lm.h, 9);
    ctx.stroke();
    if (isSel) {
      ctx.fillStyle = '#3fc2cc';
      roundRect(ctx, x + 2, lm.y + lm.h / 2 - 11, 5, 22, 2.5); ctx.fill();
      roundRect(ctx, x + w - 7, lm.y + lm.h / 2 - 11, 5, 22, 2.5); ctx.fill();
    }
    if (mediaOf(c.mediaId)?.hasAudio) drawFades(ctx, 'clip', c.id, x, lm.y, w, lm.h, isSel);
  });

  // transition markers on the cuts
  cutMarkers = [];
  for (let i = 1; i < tl().clips.length; i++) {
    const x = msToX(starts[i]);
    if (x < -10 || x > W + 10) continue;
    const tr = tl().clips[i].trans ?? 'none';
    const box = { x: x - 8, y: lm.y + 3, w: 16, h: 16, index: i };
    cutMarkers.push(box);
    roundRect(ctx, box.x, box.y, box.w, box.h, 8);
    ctx.fillStyle = tr === 'none' ? 'rgba(20,22,22,.9)' : '#3fc2cc';
    ctx.fill();
    ctx.strokeStyle = tr === 'none' ? '#58605d' : '#0f1414';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = tr === 'none' ? '#a3a3a3' : '#121212';
    ctx.font = '700 9px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(TRANS_SHORT[tr], x, box.y + 8.5);
    ctx.textAlign = 'left';
  }

  // captions
  for (const l of tl().captions.lines) {
    const x = msToX(l.startMs), w = ((l.endMs - l.startMs) / 1000) * pxPerSec;
    if (x + w < 0 || x > W) continue;
    const own = !!l.anim || l.words.some((q) => q.fx || q.color);
    capsule(ctx, 'line', x, lc.y, w, lc.h, isSelected('line', l.id), `${own ? '✦ ' : ''}${l.words.map((q) => q.text).join(' ')}`, false, (lx) => lx - 2);
  }

  // texts
  for (const x of tl().texts) {
    const ln = laneOf('text', textRows.get(x.id) ?? 0);
    const xx = msToX(x.startMs), w = ((x.endMs - x.startMs) / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    capsule(ctx, 'text', xx, ln.y, w, ln.h, isSelected('text', x.id), x.text.replace(/\n/g, ' '));
  }

  // video layers
  for (const ly of layers()) {
    const ln = lanes.filter((q) => q.kind === 'layer')[textRows.get(ly.id) ?? 0];
    if (!ln) continue;
    const xx = msToX(ly.startMs), w = ((Math.min(ly.endMs, timelineDuration(tl())) - ly.startMs) / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    capsule(ctx, 'layer', xx, ln.y, w, ln.h, isSelected('layer', ly.id), `${ly.source === 'adjust' ? '◐ ' : ''}${ly.name}${ly.source === 'main' ? ' · video utama' : ly.source === 'adjust' ? ' · adjustment' : ''}${ly.hidden ? ' · disembunyikan' : ''}`, !!ly.hidden);
    if (ly.source === 'media' && ly.volume > 0.001) drawFades(ctx, 'layer', ly.id, xx, ln.y, w, ln.h, isSelected('layer', ly.id) && !multi.size);
  }

  // meme pictures
  for (const im of images()) {
    const ln = laneOf('image', textRows.get(im.id) ?? 0);
    const xx = msToX(im.startMs), w = ((im.endMs - im.startMs) / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    capsule(ctx, 'image', xx, ln.y, w, ln.h, isSelected('image', im.id), im.name, false, (lx) => {
      const el = imageEl(im.file);
      const th = ln.h - 8, tw = th * im.aspect;
      if (el.complete && el.naturalWidth) { ctx.save(); roundRect(ctx, lx - 3, ln.y + 4, tw, th, 3); ctx.clip(); ctx.drawImage(el, lx - 3, ln.y + 4, tw, th); ctx.restore(); }
      return lx + tw + 3;
    });
  }

  // background music
  for (const mu of music()) {
    const ln = laneOf('music', textRows.get(mu.id) ?? 0);
    const xx = msToX(mu.startMs), w = (mu.lengthMs / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    capsule(ctx, 'music', xx, ln.y, w, ln.h, isSelected('music', mu.id), `${mu.name}${mu.duck !== 'off' ? '  · ducking' : ''}`);
    const mw = waveOf(mu.file);
    if (mw) drawWave(ctx, mw, xx, ln.y + 3, w, ln.h - 6, W, (dx) => mu.inMs + (dx / pxPerSec) * 1000, 'rgba(255,255,255,.16)');
    drawFades(ctx, 'music', mu.id, xx, ln.y, Math.min(w, ((timelineDuration(tl()) - mu.startMs) / 1000) * pxPerSec), ln.h, isSelected('music', mu.id) && !multi.size);
  }

  // sound effects
  for (const sn of sounds()) {
    const ln = laneOf('sound', textRows.get(sn.id) ?? 0);
    const xx = msToX(sn.startMs), w = (sn.lengthMs / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    capsule(ctx, 'sound', xx, ln.y, w, ln.h, isSelected('sound', sn.id), sn.name);
    const sw = waveOf(sn.file);
    if (sw) drawWave(ctx, sw, xx, ln.y + 3, w, ln.h - 6, W, (dx) => (dx / pxPerSec) * 1000, 'rgba(255,255,255,.16)');
    drawFades(ctx, 'sound', sn.id, xx, ln.y, w, ln.h, isSelected('sound', sn.id) && !multi.size);
  }

  // drop marker while dragging a clip
  if (dropX !== null) {
    ctx.fillStyle = '#3fc2cc';
    ctx.fillRect(dropX - 1, lm.y - 4, 3, lm.h + 8);
  }

  // selection box
  if (marquee) {
    const mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1);
    ctx.fillStyle = 'rgba(63,194,204,.1)';
    ctx.fillRect(mx, my, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    ctx.strokeStyle = '#3fc2cc'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(mx + 0.5, my + 0.5, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    ctx.setLineDash([]);
  }

  drawMarkersAndRange(ctx, W, H);

  // playhead
  const px = msToX(t);
  ctx.save();
  ctx.shadowColor = 'rgba(63,194,204,.55)'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#3fc2cc';
  ctx.fillRect(px - 1, 8, 2, H);
  ctx.beginPath(); ctx.moveTo(px, 1); ctx.lineTo(px + 7, 8); ctx.lineTo(px, 15); ctx.lineTo(px - 7, 8); ctx.closePath(); ctx.fill();
  ctx.restore();
}

let dropX: number | null = null;

type Hit = { kind: SelKind; id: string; edge: 'in' | 'out' | null; marker?: boolean } | null;

function hitTest(x: number, y: number): Hit {
  const EDGE = 7;
  const mk = cutMarkers.find((b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2);
  if (mk) return { kind: 'clip', id: tl().clips[mk.index].id, edge: null, marker: true };
  const lm = laneOf('main');
  if (y >= lm.y && y <= lm.y + lm.h) {
    const starts = clipStarts(tl().clips);
    for (let i = 0; i < tl().clips.length; i++) {
      const c = tl().clips[i];
      const a = msToX(starts[i]), b = a + (clipDuration(c) / 1000) * pxPerSec;
      if (x >= a && x <= b) return { kind: 'clip', id: c.id, edge: x - a < EDGE ? 'in' : b - x < EDGE ? 'out' : null };
    }
    return null;
  }
  const lc = laneOf('captions');
  if (y >= lc.y && y <= lc.y + lc.h) {
    for (const l of tl().captions.lines) {
      const a = msToX(l.startMs), b = msToX(l.endMs);
      if (x >= a && x <= b) return { kind: 'line', id: l.id, edge: x - a < EDGE ? 'in' : b - x < EDGE ? 'out' : null };
    }
    return null;
  }
  const groups: [SelKind, Lane['kind'], { id: string; startMs: number; endMs: number }[]][] = [
    ['text', 'text', tl().texts],
    ['image', 'image', images()],
    ['layer', 'layer', layers().map((q) => ({ id: q.id, startMs: q.startMs, endMs: Math.min(q.endMs, timelineDuration(tl())) }))],
    ['sound', 'sound', sounds().map((q) => ({ id: q.id, startMs: q.startMs, endMs: soundEnd(q) }))],
    ['music', 'music', music().map((q) => ({ id: q.id, startMs: q.startMs, endMs: q.startMs + q.lengthMs }))],
  ];
  for (const [kind, laneKind, items] of groups) {
    for (const x2 of items) {
      const ln = laneOf(laneKind, textRows.get(x2.id) ?? 0);
      if (y < ln.y || y > ln.y + ln.h) continue;
      const a = msToX(x2.startMs), b = Math.max(a + 6, msToX(x2.endMs));
      if (x >= a && x <= b) {
        const edge = x - a < EDGE && kind !== 'sound' && kind !== 'music' ? 'in' : b - x < EDGE ? 'out' : null;
        return { kind, id: x2.id, edge };
      }
    }
  }
  return null;
}

/** Where every movable (non-clip) item sits on the timeline canvas. */
function itemRects(): { kind: SelKind; id: string; x: number; y: number; w: number; h: number }[] {
  const out: { kind: SelKind; id: string; x: number; y: number; w: number; h: number }[] = [];
  const lc = laneOf('captions');
  for (const l of tl().captions.lines) out.push({ kind: 'line', id: l.id, x: msToX(l.startMs), y: lc.y, w: msToX(l.endMs) - msToX(l.startMs), h: lc.h });
  const groups: [SelKind, Lane['kind'], { id: string; startMs: number; endMs: number }[]][] = [
    ['text', 'text', tl().texts],
    ['image', 'image', images()],
    ['layer', 'layer', layers().map((q) => ({ id: q.id, startMs: q.startMs, endMs: Math.min(q.endMs, timelineDuration(tl())) }))],
    ['sound', 'sound', sounds().map((q) => ({ id: q.id, startMs: q.startMs, endMs: soundEnd(q) }))],
    ['music', 'music', music().map((q) => ({ id: q.id, startMs: q.startMs, endMs: q.startMs + q.lengthMs }))],
  ];
  for (const [kind, laneKind, items] of groups) {
    for (const it of items) {
      const ln = lanes.filter((q) => q.kind === laneKind)[textRows.get(it.id) ?? 0];
      if (!ln) continue;
      out.push({ kind, id: it.id, x: msToX(it.startMs), y: ln.y, w: Math.max(6, msToX(it.endMs) - msToX(it.startMs)), h: ln.h });
    }
  }
  return out;
}

/** Moves every picked item by the same amount; the earliest one stops at 0. */
function moveGroup(items: { kind: SelKind; id: string; a: number; b: number }[], dms: number) {
  const minA = Math.min(...items.map((i) => i.a));
  let d = Math.max(dms, -minA);
  // snap the group's first edge to the playhead and clip cuts
  const lead = items.find((i) => i.a === minA)!;
  const snapped = snapMs(lead.a + d, lead.id);
  if (snapped !== lead.a + d && multi.size) d = snapped - lead.a;
  for (const it of items) span(it.kind, it.id)?.set(Math.round(it.a + d), Math.round(it.b + d));
}

/** Start/end of any movable item, and a setter, so one drag handler serves them all. */
function span(kind: SelKind, id: string): { a: number; b: number; set: (a: number, b: number) => void; max: number } | null {
  if (kind === 'layer') {
    const ly = layers().find((q) => q.id === id);
    if (!ly) return null;
    const total = timelineDuration(tl());
    return {
      a: ly.startMs, b: Math.min(ly.endMs, total), max: Infinity,
      set: (a, b) => {
        const oldA = ly.startMs, len = Math.min(ly.endMs, total) - ly.startMs;
        if (ly.source === 'media' && b - a !== len) ly.inMs = Math.max(0, ly.inMs + (a - oldA));  // trimming the start
        ly.startMs = a;
        ly.endMs = b;
      },
    };
  }
  if (kind === 'music') {
    const m = music().find((q) => q.id === id);
    if (!m) return null;
    return { a: m.startMs, b: m.startMs + m.lengthMs, max: m.sourceMs - m.inMs, set: (a, b) => { m.startMs = a; m.lengthMs = clamp(b - a, 300, m.sourceMs - m.inMs); } };
  }
  if (kind === 'sound') {
    const s = sounds().find((q) => q.id === id);
    if (!s) return null;
    return { a: s.startMs, b: soundEnd(s), max: s.sourceMs, set: (a, b) => { s.startMs = a; s.lengthMs = clamp(b - a, 50, s.sourceMs); } };
  }
  const item = (kind === 'text' ? tl().texts : kind === 'image' ? images() : tl().captions.lines).find((q) => q.id === id) as
    (TextItem | ImageItem | CaptionLine | undefined);
  if (!item) return null;
  return {
    a: item.startMs, b: item.endMs, max: Infinity,
    set: (a, b) => {
      const shift = a - item.startMs;
      const moving = b - a === item.endMs - item.startMs;
      item.startMs = a;
      item.endMs = b;
      if ('words' in item) {
        item.words = moving
          ? item.words.map((w) => ({ ...w, startMs: w.startMs + shift, endMs: w.endMs + shift }))
          : item.words.map((w) => ({ ...w, startMs: clamp(w.startMs, a, b), endMs: clamp(w.endMs, a, b) }));
      }
    },
  };
}

/** Snap a time to the playhead, clip boundaries and item edges when close (8 px). */
function snapMs(ms: number, ignoreId?: string): number {
  const pts = [t, 0, ...clipStarts(tl().clips), timelineDuration(tl())];
  for (const x of tl().texts) if (x.id !== ignoreId) pts.push(x.startMs, x.endMs);
  for (const x of images()) if (x.id !== ignoreId) pts.push(x.startMs, x.endMs);
  for (const x of sounds()) if (x.id !== ignoreId) pts.push(x.startMs, soundEnd(x));
  for (const x of music()) if (x.id !== ignoreId) pts.push(x.startMs, x.startMs + x.lengthMs);
  for (const m of markers()) pts.push(m.ms);
  if (tl().range) pts.push(tl().range!.inMs, tl().range!.outMs);
  const tol = (8 / pxPerSec) * 1000;
  let best = ms, d = tol;
  for (const p of pts) if (Math.abs(p - ms) < d) { d = Math.abs(p - ms); best = p; }
  return best;
}

function setupTimeline() {
  type Drag =
    | { mode: 'scrub' }
    | { mode: 'trim-clip'; id: string; edge: 'in' | 'out'; start: VideoClip; sx: number }
    | { mode: 'move-clip'; id: string; sx: number; moved: boolean }
    | { mode: 'item'; kind: SelKind; id: string; edge: 'in' | 'out' | null; sx: number; a: number; b: number }
    | { mode: 'group'; sx: number; items: { kind: SelKind; id: string; a: number; b: number }[]; moved: boolean }
    | { mode: 'marquee'; x0: number; y0: number; add: Set<string>; moved: boolean }
    | { mode: 'fade'; kind: FadeKind; id: string; which: 'in' | 'out' };
  let drag: Drag | null = null;
  const pos = (e: MouseEvent) => { const r = tlCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  tlCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    drag = null;
    const { x, y } = pos(e);
    timelineMenu(e, x, y);
  });
  tlCanvas.addEventListener('pointermove', (e) => {
    if (drag) return;
    const { x, y } = pos(e);
    tlCanvas.style.cursor = fadeHandles.some((q) => Math.hypot(q.x - x, q.y - y) <= 8) ? 'ew-resize' : '';
  });
  tlCanvas.addEventListener('pointerdown', (e) => {
    if (!P || e.button === 2) return;
    const { x, y } = pos(e);
    tlCanvas.setPointerCapture(e.pointerId);
    if (y < RULER) { drag = { mode: 'scrub' }; const mk = markerAtX(x); seek(mk ? mk.ms : xToMs(x)); return; }
    const fh = fadeHandles.find((q) => Math.hypot(q.x - x, q.y - y) <= 8);
    if (fh && e.button === 0) { snapshot(); drag = { mode: 'fade', kind: fh.kind, id: fh.id, which: fh.which }; return; }
    const hit = hitTest(x, y);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!hit) {
      // empty area: drag draws a selection box; a plain click moves the playhead
      drag = { mode: 'marquee', x0: x, y0: y, add: additive ? new Set(multi) : new Set(), moved: false };
      return;
    }
    if (additive && hit.kind !== 'clip' && !hit.marker) {
      if (sel && sel.kind !== 'clip' && !multi.size) multi.add(mkey(sel.kind, sel.id));
      const k = mkey(hit.kind, hit.id);
      if (multi.has(k)) multi.delete(k); else multi.add(k);
      sel = multi.size === 1 ? (() => { const [kk, ...rest] = [...multi][0].split(':'); return { kind: kk as SelKind, id: rest.join(':') }; })() : null;
      if (multi.size === 1) multi.clear();
      drag = null;
      renderInspector(); drawTimeline(); renderFrame();
      return;
    }
    if (multi.size > 1 && multi.has(mkey(hit.kind, hit.id)) && !hit.edge) {
      snapshot();
      const items = [...multi].map((k) => { const [kind, ...r] = k.split(':'); const id = r.join(':'); const sp = span(kind as SelKind, id); return sp ? { kind: kind as SelKind, id, a: sp.a, b: sp.b } : null; })
        .filter((i): i is { kind: SelKind; id: string; a: number; b: number } => !!i);
      drag = { mode: 'group', sx: x, items, moved: false };
      return;
    }
    multi.clear();
    sel = { kind: hit.kind, id: hit.id };
    if (!hit.marker && isLocked(hit.kind, hit.id)) { renderInspector(); drawTimeline(); renderFrame(); lockedToast(); drag = null; return; }
    snapshot();
    if (hit.marker) {
      const c = tl().clips.find((q) => q.id === hit.id)!;
      seek(clipStarts(tl().clips)[tl().clips.indexOf(c)]);
      renderInspector();
      setTimeout(() => $('#trans-block')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
      drag = { mode: 'scrub' };
      drawTimeline();
      return;
    }
    if (hit.kind === 'clip') {
      const c = tl().clips.find((q) => q.id === hit.id)!;
      clipMapAtDown = clipMap();
      drag = hit.edge ? { mode: 'trim-clip', id: c.id, edge: hit.edge, start: { ...c }, sx: x } : { mode: 'move-clip', id: c.id, sx: x, moved: false };
      if (!hit.edge) {
        const i = tl().clips.indexOf(c);
        const start = clipStarts(tl().clips)[i];
        if (t < start || t >= start + clipDuration(c)) seek(start + 1);
      }
    } else {
      const sp = span(hit.kind, hit.id);
      if (!sp) return;
      drag = { mode: 'item', kind: hit.kind, id: hit.id, edge: hit.edge, sx: x, a: sp.a, b: sp.b };
      if (hit.kind !== 'sound' && hit.kind !== 'music' && (t < sp.a || t >= sp.b)) seek(sp.a);
    }
    renderInspector();
    if (tab === 'captions') renderLeft();
    drawTimeline();
    renderFrame();
  });

  tlCanvas.addEventListener('pointermove', (e) => {
    if (!P) return;
    const { x, y } = pos(e);
    if (!drag) {
      const hit = y > RULER ? hitTest(x, y) : null;
      tlCanvas.style.cursor = hit?.edge ? 'ew-resize' : hit ? 'grab' : 'default';
      return;
    }
    const dms = ((x - (('sx' in drag) ? drag.sx : x)) / pxPerSec) * 1000;
    if (drag.mode === 'scrub') { seek(xToMs(x)); return; }
    if (drag.mode === 'fade') {
      const ft = fadeTarget(drag.kind, drag.id);
      if (!ft) return;
      const cur = fadesOf(ft.obj, ft.len, ft.defIn, ft.defOut);
      const at = xToMs(x) - ft.start;
      if (drag.which === 'in') ft.obj.fadeInMs = Math.round(clamp(at, 0, ft.len - cur.fo - 50));
      else ft.obj.fadeOutMs = Math.round(clamp(ft.len - at, 0, ft.len - cur.fi - 50));
      const v = drag.which === 'in' ? ft.obj.fadeInMs! : ft.obj.fadeOutMs!;
      tlCanvas.title = `Fade ${drag.which === 'in' ? 'in' : 'out'} ${(v / 1000).toFixed(2)} dtk`;
      drawTimeline();
      return;
    }
    if (drag.mode === 'marquee') {
      if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 4) return;
      drag.moved = true;
      marquee = { x0: drag.x0, y0: drag.y0, x1: x, y1: y };
      const rx0 = Math.min(drag.x0, x), rx1 = Math.max(drag.x0, x), ry0 = Math.min(drag.y0, y), ry1 = Math.max(drag.y0, y);
      multi.clear();
      drag.add.forEach((k) => multi.add(k));
      for (const r of itemRects()) if (r.x < rx1 && r.x + r.w > rx0 && r.y < ry1 && r.y + r.h > ry0) multi.add(mkey(r.kind, r.id));
      sel = null;
      drawTimeline();
      return;
    }
    if (drag.mode === 'group') {
      if (Math.abs(x - drag.sx) > 3) drag.moved = true;
      if (!drag.moved) return;
      moveGroup(drag.items, dms);
      drawTimeline();
      renderFrame();
      return;
    }
    if (drag.mode === 'trim-clip') {
      const c = tl().clips.find((q) => q.id === (drag as { id: string }).id);
      const m = c && mediaOf(c.mediaId);
      if (!c || !m) return;
      if (drag.edge === 'in') c.inMs = Math.round(clamp(drag.start.inMs + dms * c.speed, 0, c.outMs - 200));
      else c.outMs = Math.round(clamp(drag.start.outMs + dms * c.speed, c.inMs + 200, m.durationMs));
      const i = tl().clips.indexOf(c);
      seek(clipStarts(tl().clips)[i] + (drag.edge === 'in' ? 0 : clipDuration(c) - 1));
      return;
    }
    if (drag.mode === 'move-clip') {
      if (Math.abs(x - drag.sx) > 4) drag.moved = true;
      if (!drag.moved) return;
      const starts = clipStarts(tl().clips);
      const ms = xToMs(x);
      let gap = starts.findIndex((s, i) => ms < s + clipDuration(tl().clips[i]) / 2);
      if (gap < 0) gap = tl().clips.length;
      dropX = msToX(gap < starts.length ? starts[gap] : timelineDuration(tl()));
      drawTimeline();
      return;
    }
    if (drag.mode === 'item') {
      const sp = span(drag.kind, drag.id);
      if (!sp) return;
      const total = isBlank() ? 1e8 : Math.max(timelineDuration(tl()), drag.b);   // a blank canvas grows with what is moved
      const len = drag.b - drag.a;
      if (drag.edge === 'in') sp.set(Math.round(clamp(snapMs(drag.a + dms, drag.id), 0, drag.b - 100)), drag.b);
      else if (drag.edge === 'out') sp.set(drag.a, Math.round(clamp(snapMs(drag.b + dms, drag.id), drag.a + 100, Math.min(drag.kind === 'sound' || drag.kind === 'music' ? drag.a + sp.max : Infinity, Math.max(total, drag.b)))));
      else {
        let a = snapMs(drag.a + dms, drag.id);
        if (a === drag.a + dms) a = snapMs(drag.b + dms, drag.id) - len;
        a = Math.round(clamp(a, 0, Math.max(0, total - (drag.kind === 'sound' || drag.kind === 'music' ? 50 : len))));
        sp.set(a, a + len);
      }
      drawTimeline();
      renderFrame();
    }
  });

  const end = (e: PointerEvent) => {
    if (!drag || !P) { drag = null; return; }
    if (drag.mode === 'fade') { drag = null; tlCanvas.title = ''; changed(); return; }
    if (drag.mode === 'marquee') {
      const d = drag;
      drag = null;
      marquee = null;
      if (!d.moved) {
        if (!d.add.size) { multi.clear(); sel = null; }
        seek(xToMs(d.x0));
        renderInspector(); drawTimeline();
        if (tab === 'captions') renderLeft();
        return;
      }
      if (multi.size === 1) { const [k] = [...multi]; const [kind, ...r] = k.split(':'); sel = { kind: kind as SelKind, id: r.join(':') }; multi.clear(); }
      renderInspector(); drawTimeline(); renderFrame();
      return;
    }
    if (drag.mode === 'group') {
      const moved = drag.moved;
      drag = null;
      if (moved) changed({ left: tab === 'captions' });
      return;
    }
    if (drag.mode === 'move-clip' && drag.moved) {
      const { x } = pos(e);
      const clips = tl().clips;
      const from = clips.findIndex((c) => c.id === (drag as { id: string }).id);
      const starts = clipStarts(clips);
      const ms = xToMs(x);
      let to = starts.findIndex((s, i) => ms < s + clipDuration(clips[i]) / 2);
      if (to < 0) to = clips.length;
      if (to > from) to--;
      if (to !== from) {
        const [c] = clips.splice(from, 1);
        clips.splice(to, 0, c);
      }
      dropX = null;
    }
    if ((drag.mode === 'move-clip' || drag.mode === 'trim-clip') && clipMapAtDown) followMainTrack(clipMapAtDown);
    clipMapAtDown = null;
    const wasEdit = drag.mode !== 'scrub';
    drag = null;
    if (wasEdit) changed({ left: tab === 'captions' });
  };
  tlCanvas.addEventListener('pointerup', end);
  tlCanvas.addEventListener('pointercancel', end);

  $('#tl-body')!.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x } = pos(e);
    if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, x);
    else {
      const maxScroll = Math.max(0, (playheadMax() / 1000) * pxPerSec - tlCanvas.clientWidth + 120);
      scrollX = clamp(scrollX + (e.deltaX || e.deltaY), 0, maxScroll);
      drawTimeline();
    }
  }, { passive: false });
}

// ================= soundboard & meme libraries =================

const imageEls = new Map<string, HTMLImageElement>();
// ---------- animated GIFs in the preview: a GIF drawn on a canvas only shows its first frame, so decode its frames ----------
type GifAnim = { frames: ImageBitmap[]; ends: number[]; total: number; w: number; h: number };
const gifAnims = new Map<string, GifAnim | null>();
function gifAnim(file: string): GifAnim | null {
  if (gifAnims.has(file)) return gifAnims.get(file)!;
  gifAnims.set(file, null);
  type Dec = { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }; decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void };
  const Ctor = (window as unknown as { ImageDecoder?: new (o: { data: ArrayBuffer; type: string }) => Dec }).ImageDecoder;
  if (!Ctor) return null;
  void (async () => {
    const buf = await (await fetch(fileSrc(file))).arrayBuffer();
    const dec = new Ctor({ data: buf, type: 'image/gif' });
    await dec.tracks.ready;
    const n = Math.min(600, dec.tracks.selectedTrack?.frameCount ?? 1);
    const frames: ImageBitmap[] = [], ends: number[] = [];
    let acc = 0, w = 0, h = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      // like browsers and ffmpeg: a delay under 20 ms plays as 100 ms
      let d = (image.duration ?? 100_000) / 1000;
      if (d < 20) d = 100;
      w = image.displayWidth; h = image.displayHeight;
      frames.push(await createImageBitmap(image));
      image.close();
      acc += d; ends.push(acc);
    }
    dec.close();
    if (frames.length > 1) { gifAnims.set(file, { frames, ends, total: acc, w, h }); renderFrame(); }
  })().catch(() => undefined);
  return null;
}
function gifFrameAt(a: GifAnim, ms: number): ImageBitmap {
  const t0 = ((ms % a.total) + a.total) % a.total;
  let lo = 0, hi = a.ends.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a.ends[mid] > t0) hi = mid; else lo = mid + 1; }
  return a.frames[lo];
}

function imageEl(file: string) {
  let el = imageEls.get(file);
  if (!el) {
    el = new Image();
    el.onload = () => { renderFrame(); drawTimeline(); };
    corsSrc(el, fileSrc(file));
    imageEls.set(file, el);
  }
  return el;
}

/** Volume given to sounds and video memes when they are placed (25% unless changed). */
const insertVol = () => settings.insertVolume ?? 0.25;

function insertVolumeControl(): HTMLElement {
  const v = insertVol();
  return h('div', { class: 'insert-vol' },
    h('span', { class: 'label' }, 'Volume saat ditempel'),
    h('input', {
      type: 'range', min: 5, max: 150, step: 5, value: Math.round(v * 100), 'aria-label': 'Volume saat ditempel',
      oninput: (e) => { settings.insertVolume = Number((e.target as HTMLInputElement).value) / 100; const o = $('#iv-val'); if (o) o.textContent = `${Math.round(insertVol() * 100)}%`; },
      onchange: () => void saveSettings(settings),
    }),
    h('span', { class: 'mono small', id: 'iv-val' }, `${Math.round(v * 100)}%`),
  );
}

let auditionEl: HTMLAudioElement | null = null;
let auditionFile = '';
/**
 * Plays a sound on its own (soundboard, music, review). A small bar at the bottom of the left panel
 * shows what is playing with a Stop button; Esc, starting the timeline or a second click stop it too.
 */
function audition(file: string, volume = 1, name?: string, fromMs = 0) {
  stopAudition();
  const a = new Audio(fileSrc(file));
  a.volume = clamp(volume, 0, 1);
  if (fromMs) a.currentTime = fromMs / 1000;
  auditionEl = a; auditionFile = file;
  a.addEventListener('ended', () => { if (auditionEl === a) stopAudition(); });
  a.addEventListener('timeupdate', () => { if (auditionEl === a) paintAudition(); });
  void a.play().catch(() => { if (auditionEl === a) stopAudition(); });
  showAudition(name ?? baseName(file).replace(/^[0-9a-f]{8}-/, '').replace(/\.[^.]+$/, ''));
}
/** Starts or stops a preview from the same button. */
function toggleAudition(file: string, volume = 1, name?: string, fromMs = 0) {
  if (auditionEl && auditionFile === file) stopAudition();
  else audition(file, volume, name, fromMs);
}
function stopAudition() {
  if (auditionEl) { auditionEl.pause(); auditionEl.src = ''; }
  auditionEl = null; auditionFile = '';
  document.querySelector('.audition-bar')?.remove();
  markAuditionButtons();
}
function showAudition(name: string) {
  document.querySelector('.audition-bar')?.remove();
  const host = $('.left') ?? document.body;
  host.append(h('div', { class: 'audition-bar', role: 'status' },
    h('span', { class: 'aud-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'aud-meta' },
      h('div', { class: 'aud-name' }, name),
      h('div', { class: 'aud-track' }, h('div', { class: 'aud-fill' })),
    ),
    h('span', { class: 'aud-time mono small' }, ''),
    h('button', { class: 'aud-stop', title: 'Stop (Esc)', 'aria-label': 'Stop preview suara', onclick: stopAudition }, icon('stop', 14), h('span', {}, 'Stop')),
  ));
  markAuditionButtons();
}
function paintAudition() {
  const a = auditionEl, bar = document.querySelector('.audition-bar');
  if (!a || !bar) return;
  const d = Number.isFinite(a.duration) ? a.duration : 0;
  (bar.querySelector('.aud-fill') as HTMLElement).style.width = d ? `${(a.currentTime / d) * 100}%` : '0%';
  bar.querySelector('.aud-time')!.textContent = d ? `${tc(a.currentTime * 1000)} / ${tc(d * 1000)}` : tc(a.currentTime * 1000);
}
/** Buttons that preview a file show Stop while that file plays. */
function markAuditionButtons() {
  document.querySelectorAll<HTMLElement>('[data-aud]').forEach((b) => {
    const on = !!auditionEl && b.dataset.aud === auditionFile;
    if (b.classList.contains('aud-on') === on && b.dataset.audInit) return;
    b.dataset.audInit = '1';
    b.classList.toggle('aud-on', on);
    const size = Number(b.dataset.audSize || 14);
    const label = b.dataset.audLabel;
    b.replaceChildren(icon(on ? 'stop' : 'play', size), ...(label ? [h('span', {}, on ? 'Stop' : label)] : []));
    b.title = on ? 'Stop' : (label || 'Dengarkan');
  });
}

const sfxEls = new Map<string, HTMLAudioElement>();
/** Plays the sound items under the playhead while the preview runs. */
function syncSfx() {
  for (const s of sounds()) {
    let a = sfxEls.get(s.id);
    const inside = t >= s.startMs && t < soundEnd(s);
    if (!inside) { if (a && !a.paused) a.pause(); continue; }
    if (!a) { a = new Audio(fileSrc(s.file)); a.preload = 'auto'; sfxEls.set(s.id, a); }
    const sfd = fadesOf(s, s.lengthMs);
    a.volume = clamp(s.volume * fadeGain(t - s.startMs, s.lengthMs, sfd.fi, sfd.fo), 0, 1);
    const want = (t - s.startMs) / 1000;
    if (a.paused) { a.currentTime = want; void a.play().catch(() => undefined); }
    else if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
  }
}

function switchTab(k: LeftTab) {
  if (tfSession && k !== 'transform' && k !== 'crop') { tfSession = null; setTimeout(showTfHint, 0); }
  if (k === 'crop' && sel?.kind === 'layer') cropMode = true;
  if (k === 'transform') cropMode = false;
  if (tab === 'crop' && k !== 'crop') cropMode = false;
  tab = k;
  if (settings.leftHidden) togglePanel('left');
  renderFrame();
  document.querySelectorAll('.rail button').forEach((b) => { const on = (b as HTMLElement).dataset.tab === railTab(k); b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  const head = $('#left-head');
  if (head) head.textContent = TAB_NAME[k];
  lastActiveLine = '';
  renderLeft();
  markActiveLine();
}

async function addToLibrary(paths: string[], cat?: string) {
  setBusy('Menambahkan ke library…');
  try {
    const r = await importLibFiles(paths, cat, (i, n) => { if (n > 1) setBusy(`Menambahkan ke library… ${i + 1}/${n}`); });
    library = await loadLibrary();
    const parts = [r.sounds ? `${r.sounds} suara` : '', r.memes ? `${r.memes} meme` : ''].filter(Boolean);
    if (parts.length) toast(`${parts.join(' dan ')} ditambahkan ke library.`);
    if (r.errors.length) toast(r.errors.join('\n'), 'error');
    if (r.memes && !r.sounds) switchTab('meme'); else if (r.sounds) switchTab('sound');
  } finally {
    setBusy('');
  }
}

/** Drops a sound at the playhead. Selection is left alone so Space resumes play. */
function insertSound(pad: Pad) {
  if (!P) return;
  if (!canPlace()) { toast('Tambahkan video ke timeline dulu.'); return; }
  const snd = soundOf(pad);
  if (!snd) { toast('File suara pad ini hilang dari library.'); return; }
  snapshot();
  sounds().push({ id: uid(), file: snd.file, name: pad.name, startMs: Math.floor(t), lengthMs: snd.durationMs, sourceMs: snd.durationMs, volume: insertVol() });
  if (!playing) audition(snd.file, insertVol(), snd.name);
  changed({ inspector: false });
  flash(pad.id);
}

/** Drops a meme picture at the playhead with its default animations. */
function insertMeme(m: Meme) {
  if (!P) return;
  if (!canPlace()) { toast('Tambahkan video ke timeline dulu.'); return; }
  snapshot();
  const at = Math.floor(t);
  const aspect = m.width / m.height;
  const scale = Math.min(0.62, (0.32 * tl().height * aspect) / tl().width);
  images().push({
    id: uid(), file: m.file, name: m.name, startMs: at, endMs: at + Math.max(600, m.durationMs),
    x: 0.5, y: 0.4, scale, aspect, animated: m.animated, transIn: m.transIn, transOut: m.transOut,
  });
  changed({ inspector: false });
  flash(m.id);
}

function flash(id: string) {
  const el = document.querySelector(`[data-pad="${id}"]`);
  el?.classList.add('hit');
  setTimeout(() => el?.classList.remove('hit'), 220);
}

type LibKind = 'sound' | 'meme' | 'vmeme';
interface LibItem { id: string; name: string; cat?: string; fav?: boolean }
const libFilter: Record<LibKind, { q: string; cat: string }> = { sound: { q: '', cat: '' }, meme: { q: '', cat: '' }, vmeme: { q: '', cat: '' } };
const FAV = '\u2605';

function libList(kind: LibKind): LibItem[] {
  if (!library) return [];
  return kind === 'sound' ? library.pads : kind === 'meme' ? library.memes : (library.clips ?? []);
}

function filtered<T extends LibItem>(kind: LibKind, list: T[]): T[] {
  const f = libFilter[kind];
  const q = f.q.trim().toLowerCase();
  return list.filter((x) =>
    (!q || x.name.toLowerCase().includes(q) || (x.cat ?? '').toLowerCase().includes(q)) &&
    (!f.cat || (f.cat === FAV ? !!x.fav : (x.cat ?? '') === f.cat)));
}

/** Search box and category chips shared by the three libraries. */
function libBar(kind: LibKind): HTMLElement {
  const list = libList(kind);
  const f = libFilter[kind];
  const cats = categoriesOf(list);
  const hasFav = list.some((x) => x.fav);
  const search = h('input', {
    type: 'search', class: 'lib-search', id: `lib-search-${kind}`, placeholder: `Cari di ${list.length} item…`, value: f.q, 'aria-label': 'Cari di library',
    oninput: (e) => {
      f.q = (e.target as HTMLInputElement).value;
      const pos = (e.target as HTMLInputElement).selectionStart ?? f.q.length;
      renderLeft();
      const el = document.getElementById(`lib-search-${kind}`) as HTMLInputElement | null;
      el?.focus(); el?.setSelectionRange(pos, pos);
    },
  });
  const chip = (value: string, label: string) => h('button', {
    class: `chip ${f.cat === value ? 'on' : ''}`, onclick: () => { f.cat = f.cat === value ? '' : value; renderLeft(); },
  }, label);
  return h('div', { class: 'lib-bar' },
    search,
    (cats.length || hasFav) ? h('div', { class: 'lib-cats' }, chip('', 'Semua'), hasFav ? chip(FAV, `${FAV} Favorit`) : null, ...cats.map((c) => chip(c, c))) : h('span'),
  );
}

function favButton(item: LibItem, cls: string) {
  return h('button', {
    class: `${cls} ${item.fav ? 'is-fav' : ''}`, title: item.fav ? 'Hapus dari favorit' : 'Jadikan favorit', 'aria-label': item.fav ? `Hapus ${item.name} dari favorit` : `Jadikan ${item.name} favorit`,
    onclick: async (e: Event) => { e.stopPropagation(); item.fav = !item.fav; await saveLibrary(); renderLeft(); },
  }, item.fav ? FAV : '\u2606');
}

function catEditor(item: LibItem, kind: LibKind) {
  const id = `cats-${kind}`;
  return h('div', { class: 'row-between' },
    h('input', {
      class: 'cat-input', value: item.cat ?? '', placeholder: 'Kategori (mis. Ketawa)', list: id, 'aria-label': 'Kategori',
      onchange: async (e) => { item.cat = (e.target as HTMLInputElement).value.trim() || undefined; await saveLibrary(); },
    }),
    h('datalist', { id }, ...categoriesOf(libList(kind)).map((c) => h('option', { value: c }))),
    favButton(item, 'icon-btn fav-btn'),
  );
}

async function importFolder(kind: LibKind) {
  const dir = await dialog().open({ directory: true, title: 'Pilih folder untuk diimpor' });
  if (typeof dir !== 'string') return;
  const exts = kind === 'sound' ? SOUND_EXT : kind === 'meme' ? IMAGE_EXT : VIDEO_MEME_EXT;
  const files = (await invoke<string[]>('list_dir', { path: dir })).filter((f) => exts.includes(extName(f))).sort((a, b) => a.localeCompare(b, 'id')).map((f) => join(dir, f));
  if (!files.length) { toast('Tidak ada file yang cocok di folder itu.'); return; }
  const cat = dir.split(/[\\/]/).filter(Boolean).pop();
  if (kind === 'vmeme') await addVideoMemes(files, cat);
  else await addToLibrary(files, cat);
  libFilter[kind] = { q: '', cat: cat ?? '' };
  renderLeft();
}

function libHead(kind: 'sound' | 'meme') {
  return h('div', { class: 'row-between' },
    h('button', {
      class: 'secondary', onclick: async () => {
        const files = await dialog().open({
          multiple: true, title: kind === 'sound' ? 'Tambah suara' : 'Tambah gambar meme',
          filters: [kind === 'sound' ? { name: 'Suara', extensions: SOUND_EXT } : { name: 'Gambar', extensions: IMAGE_EXT }],
        });
        const arr = typeof files === 'string' ? [files] : files ?? [];
        if (arr.length) await addToLibrary(arr);
      },
    }, kind === 'sound' ? '+ Suara' : '+ Meme'),
    h('button', { class: 'ghost', title: 'Impor semua file di satu folder; nama folder jadi kategori', onclick: () => void importFolder(kind) }, 'Impor folder'),
    h('button', { class: libEdit ? 'secondary on-accent-border' : 'ghost', onclick: () => { libEdit = !libEdit; renderLeft(); } }, libEdit ? 'Selesai' : 'Atur'),
  );
}

function orderButtons<T>(list: T[], i: number) {
  return [
    h('button', { class: 'icon-btn', 'aria-label': 'Naik', disabled: i === 0, onclick: () => { move(list, i, i - 1); renderLeft(); } }, icon('up', 15)),
    h('button', { class: 'icon-btn', 'aria-label': 'Turun', disabled: i === list.length - 1, onclick: () => { move(list, i, i + 1); renderLeft(); } }, icon('down', 15)),
  ];
}

function soundPanel(): Node[] {
  if (!library) return [h('p', { class: 'muted small hint-p' }, 'Memuat library…')];
  const L = library;
  if (!libEdit) {
    return [
      libHead('sound'),
      insertVolumeControl(),
      libBar('sound'),
      L.pads.length ? h('div', { class: 'pads' },
        ...filtered('sound', L.pads).map((pad) => ({ pad, i: L.pads.indexOf(pad) })).map(({ pad, i }) => h('div', { class: 'pad-wrap' },
          h('button', { class: 'pad', 'data-pad': pad.id, style: `--pad:${pad.color}`, title: `${pad.name}${i < 9 ? ` (tombol ${i + 1})` : ''}`, onclick: () => insertSound(pad) },
            h('span', { class: 'pad-name' }, pad.name),
            h('span', { class: 'pad-meta' }, tc(soundOf(pad)?.durationMs ?? 0, true)),
            i < 9 ? h('span', { class: 'pad-key' }, String(i + 1)) : null,
          ),
          h('button', { class: 'pad-play', title: 'Dengarkan', 'aria-label': `Dengarkan ${pad.name}`, 'data-aud': soundOf(pad)?.file ?? '', 'data-aud-size': 11, onclick: (e) => { e.stopPropagation(); const s = soundOf(pad); if (s) toggleAudition(s.file, insertVol(), pad.name); } }, icon('play', 11)),
          favButton(pad, 'pad-fav'),
        )),
      ) : h('p', { class: 'muted small' }, 'Belum ada suara. Tarik file MP3/WAV/OGG ke jendela, atau impor satu folder.'),
      L.pads.length && !filtered('sound', L.pads).length ? h('p', { class: 'muted small' }, 'Tidak ada yang cocok dengan pencarian ini.') : h('span'),
    ];
  }
  return [
    libHead('sound'),
    libBar('sound'),
    ...filtered('sound', L.pads).map((pad) => ({ pad, i: L.pads.indexOf(pad) })).map(({ pad, i }) => h('div', { class: 'pad-edit' },
      h('div', { class: 'row-between' },
        h('input', { value: pad.name, 'aria-label': 'Nama suara', onchange: async (e) => { pad.name = (e.target as HTMLInputElement).value.trim() || pad.name; await saveLibrary(); } }),
        h('input', { type: 'color', value: pad.color, class: 'pad-color', 'aria-label': 'Warna pad', onchange: async (e) => { pad.color = (e.target as HTMLInputElement).value; await saveLibrary(); } }),
      ),
      catEditor(pad, 'sound'),
      h('div', { class: 'row-between' },
        h('span', { class: 'muted small' }, i < 9 ? `Tombol ${i + 1}` : 'Tanpa tombol'),
        h('div', {}, ...orderButtons(L.pads, i),
          h('button', {
            class: 'icon-btn', 'aria-label': `Hapus ${pad.name}`, onclick: async () => {
              if (!(await dialog().ask(`Hapus "${pad.name}" dari library?\nYang sudah ada di timeline tetap aman.`, { title: 'Hapus suara', kind: 'warning' }))) return;
              await deletePad(pad.id); library = await loadLibrary(); renderLeft();
            },
          }, icon('x', 15)),
        ),
      ),
    )),
  ];
}

const TRANS_LABEL: Record<Trans, string> = { none: 'Tanpa', pop: 'Pop', fade: 'Fade', slide: 'Geser' };
function transSeg(value: Trans, set: (t: Trans) => void) {
  return h('div', { class: 'seg' }, ...(['pop', 'fade', 'slide', 'none'] as Trans[]).map((k) =>
    h('button', { class: value === k ? 'on' : '', onclick: () => set(k) }, TRANS_LABEL[k])));
}

function memePanel(): Node[] {
  if (!library) return [h('p', { class: 'muted small hint-p' }, 'Memuat library…')];
  const L = library;
  if (!libEdit) {
    return [
      libHead('meme'),
      libBar('meme'),
      L.memes.length ? h('div', { class: 'memes' },
        ...filtered('meme', L.memes).map((m) => ({ m, i: L.memes.indexOf(m) })).map(({ m, i }) => h('div', { class: 'meme-wrap' },
          h('button', { class: 'meme', 'data-pad': m.id, title: `${m.name}${i < 9 ? ` (Shift+${i + 1})` : ''}`, onclick: () => insertMeme(m) },
            h('img', { src: fileSrc(m.file), alt: m.name, loading: 'lazy', decoding: 'async' }),
            h('span', { class: 'meme-name' }, m.name),
            i < 9 ? h('span', { class: 'pad-key' }, `⇧${i + 1}`) : null,
          ),
          favButton(m, 'tile-fav'),
        )),
      ) : h('p', { class: 'muted small' }, 'Belum ada meme. Tarik gambar PNG/JPG/GIF ke jendela, atau impor satu folder.'),
      L.memes.length && !filtered('meme', L.memes).length ? h('p', { class: 'muted small' }, 'Tidak ada yang cocok dengan pencarian ini.') : h('span'),
    ];
  }
  return [
    libHead('meme'),
    libBar('meme'),
    ...filtered('meme', L.memes).map((m) => ({ m, i: L.memes.indexOf(m) })).map(({ m, i }) => h('div', { class: 'pad-edit' },
      h('div', { class: 'row-between' },
        h('img', { class: 'meme-mini', src: fileSrc(m.file), alt: '', loading: 'lazy' }),
        h('input', { value: m.name, 'aria-label': 'Nama meme', onchange: async (e) => { m.name = (e.target as HTMLInputElement).value.trim() || m.name; await saveLibrary(); } }),
      ),
      catEditor(m, 'meme'),
      field(`Tampil ${(m.durationMs / 1000).toFixed(1)} detik`, h('input', {
        type: 'range', min: 6, max: 60, value: Math.round(m.durationMs / 100),
        oninput: (e) => { m.durationMs = Number((e.target as HTMLInputElement).value) * 100; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Tampil ${(m.durationMs / 1000).toFixed(1)} detik`; },
        onchange: () => void saveLibrary(),
      })),
      h('div', { class: 'label' }, 'Masuk'),
      transSeg(m.transIn, async (v) => { m.transIn = v; await saveLibrary(); renderLeft(); }),
      h('div', { class: 'label' }, 'Keluar'),
      transSeg(m.transOut, async (v) => { m.transOut = v; await saveLibrary(); renderLeft(); }),
      h('div', { class: 'row-between' },
        h('span', { class: 'muted small' }, i < 9 ? `Shift + ${i + 1}` : 'Tanpa tombol'),
        h('div', {}, ...orderButtons(L.memes, i),
          h('button', {
            class: 'icon-btn', 'aria-label': `Hapus ${m.name}`, onclick: async () => {
              if (!(await dialog().ask(`Hapus "${m.name}" dari library?\nYang sudah ada di timeline tetap aman.`, { title: 'Hapus meme', kind: 'warning' }))) return;
              await deleteMeme(m.id); library = await loadLibrary(); renderLeft();
            },
          }, icon('x', 15)),
        ),
      ),
    )),
  ];
}

/** Plays the preview briefly so a changed animation can be seen. */
function previewTrans() {
  if (playing) return;
  play();
  setTimeout(() => pause(), TRANS_IN_MS + 600);
}

const REASON: Record<string, string> = {
  auto: 'Simpan berkala', dibuka: 'Saat proyek dibuka', 'sebelum-hapus-jeda': 'Sebelum hapus jeda',
  'sebelum-subtitle': 'Sebelum buat subtitle', 'sebelum-pulihkan': 'Sebelum memulihkan versi', manual: 'Disimpan manual',
};

function historyBlock(): HTMLElement {
  const box = h('div', { class: 'block history' },
    h('div', { class: 'row-between' },
      h('div', { class: 'label' }, 'Riwayat versi'),
      h('button', { class: 'ghost small', onclick: async () => { await autoSnapshot('manual', true); toast('Versi disimpan.'); renderInspector(); } }, 'Simpan versi'),
    ),
    h('div', { class: 'muted small' }, 'Proyek tersimpan otomatis. Salinan juga dibuat tiap 3 menit dan sebelum hapus jeda atau buat subtitle.'),
  );
  const list = h('ol', { class: 'versions' });
  box.append(list);
  void listVersions(P!.id).then((vs) => {
    if (!vs.length) { list.replaceChildren(h('li', { class: 'muted small' }, 'Belum ada versi tersimpan.')); return; }
    const today = new Date().toDateString();
    list.replaceChildren(...vs.slice(0, 15).map((v) => h('li', {},
      h('div', {},
        h('div', { class: 'small' }, `${v.at.toDateString() === today ? '' : `${v.at.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}, `}${v.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`),
        h('div', { class: 'muted small' }, REASON[v.reason] ?? v.reason),
      ),
      h('button', {
        class: 'ghost small', onclick: async () => {
          if (!P) return;
          if (!(await dialog().ask(`Kembalikan proyek ke versi ${v.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}?\nKondisi sekarang disimpan dulu sebagai versi, dan bisa dibatalkan dengan Ctrl+Z.`, { title: 'Pulihkan versi', kind: 'warning' }))) return;
          const old = await loadVersion(P.id, v.file);
          if (!old) { toast('Versi itu tidak bisa dibaca.', 'error'); return; }
          await autoSnapshot('sebelum-pulihkan', true);
          snapshot();
          P.timeline = old.timeline;
          for (const m of old.media) if (!P.media.some((x) => x.id === m.id)) P.media.push(m);
          sel = null;
          changed({ left: true });
          fitZoom();
          toast('Versi dipulihkan.');
        },
      }, 'Pulihkan'),
    )));
  });
  return box;
}

function watermarkBlock(): HTMLElement {
  const wm = tl().watermark;
  const setWm = (patch: Partial<Watermark>) => { if (!tl().watermark) return; snapshot(); Object.assign(tl().watermark!, patch); changed(); };
  const choose = async () => {
    const f = await dialog().open({ title: 'Pilih logo channel (PNG transparan paling bagus)', filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (typeof f !== 'string') return;
    try {
      const info = JSON.parse(await invoke<string>('probe', { path: f })) as { streams: { width?: number; height?: number }[] };
      const v = info.streams.find((x) => x.width && x.height);
      if (!v?.width || !v.height) throw new Error('Gambar tidak terbaca.');
      const dest = join(await dataDir(), 'library', 'watermark', `${uid().slice(0, 8)}-${f.split(/[\\/]/).pop()}`);
      await invoke('copy_file', { src: f, dest });
      snapshot();
      tl().watermark = { file: dest, aspect: v.width / v.height, corner: wm?.corner ?? 'tr', scale: wm?.scale ?? 0.22, opacity: wm?.opacity ?? 0.85 };
      changed();
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  if (!wm) {
    return h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Watermark / logo channel'),
      h('button', { class: 'secondary wide', onclick: () => void choose() }, '+ Pasang logo'),
      settings.watermark ? h('button', { class: 'ghost small', onclick: () => { snapshot(); tl().watermark = { ...settings.watermark! }; changed(); } }, 'Pakai logo default') : h('span'),
    );
  }
  return h('div', { class: 'block' },
    h('div', { class: 'row-between' }, h('div', { class: 'label' }, 'Watermark / logo channel'), h('button', { class: 'ghost small', onclick: () => void choose() }, 'Ganti')),
    h('div', { class: 'seg' }, ...(['tl', 'tr', 'bl', 'br'] as const).map((c) => h('button', { class: wm.corner === c ? 'on' : '', 'aria-label': `Pojok ${c}`, onclick: () => setWm({ corner: c }) }, { tl: '↖', tr: '↗', bl: '↙', br: '↘' }[c]))),
    field(`Ukuran ${Math.round(wm.scale * 100)}%`, h('input', { type: 'range', min: 8, max: 50, value: Math.round(wm.scale * 100), onchange: (e) => setWm({ scale: Number((e.target as HTMLInputElement).value) / 100 }) })),
    field(`Transparansi ${Math.round(wm.opacity * 100)}%`, h('input', { type: 'range', min: 15, max: 100, value: Math.round(wm.opacity * 100), onchange: (e) => setWm({ opacity: Number((e.target as HTMLInputElement).value) / 100 }) })),
    h('label', { class: 'check' }, h('input', {
      type: 'checkbox', checked: !!settings.watermark && settings.watermark.file === wm.file,
      onchange: async (e) => { settings.watermark = (e.target as HTMLInputElement).checked ? { ...wm } : null; await saveSettings(settings); },
    }), 'Pasang otomatis di proyek baru'),
    h('button', { class: 'danger-ghost small', onclick: () => { snapshot(); tl().watermark = null; changed(); } }, 'Lepas logo'),
  );
}

// ================= transitions, music, pause removal =================

let cutMarkers: { x: number; y: number; w: number; h: number; index: number }[] = [];
const TRANS_NAME: Record<ClipTrans, string> = { none: 'Potong', punch: 'Punch', shake: 'Guncang', flash: 'Kilat', blur: 'Blur cepat', fade: 'Gelap' };
const TRANS_SHORT: Record<ClipTrans, string> = { none: '|', punch: 'P', shake: 'G', flash: 'K', blur: 'B', fade: 'F' };
const TRANS_HINT: Record<ClipTrans, string> = {
  none: 'Potong langsung tanpa efek.',
  punch: 'Gambar menghentak masuk dari zoom besar. Paling pas untuk punch-in.',
  shake: 'Layar bergetar sebentar. Cocok untuk momen kaget atau teriak.',
  flash: 'Kilat putih singkat. Cocok untuk ganti momen yang heboh.',
  blur: 'Whip cepat dengan blur. Cocok saat kembali dari zoom.',
  fade: 'Meredup lewat hitam. Cocok untuk lompat waktu.',
};

function transBlock(clip: VideoClip): HTMLElement {
  const i = tl().clips.indexOf(clip);
  if (i <= 0) return h('div', { class: 'block muted small', id: 'trans-block' }, 'Transisi dipasang di sambungan antar potongan. Split dulu (Ctrl+B) untuk membuat sambungan.');
  const cur = clip.trans ?? 'none';
  return h('div', { class: 'block', id: 'trans-block' },
    h('div', { class: 'label' }, 'Transisi masuk ke potongan ini'),
    h('div', { class: 'trans-grid' }, ...(['none', 'punch', 'shake', 'flash', 'blur', 'fade'] as ClipTrans[]).map((k) =>
      h('button', {
        class: cur === k ? 'on' : '',
        onclick: () => { snapshot(); clip.trans = k; changed(); seek(clipStarts(tl().clips)[i] - 400); if (k !== 'none') { play(); setTimeout(() => pause(), 1200); } },
      }, TRANS_NAME[k]))),
    h('div', { class: 'muted small' }, TRANS_HINT[cur]),
    h('button', {
      class: 'ghost small', onclick: () => {
        snapshot();
        tl().clips.forEach((c, j) => { if (j > 0) c.trans = cur; });
        changed();
        toast(`${TRANS_NAME[cur]} dipasang di ${tl().clips.length - 1} sambungan.`);
      },
    }, 'Terapkan ke semua sambungan'),
  );
}

// ---- background music ----

const musicEls = new Map<string, HTMLAudioElement>();
const musicLevel = new Map<string, number>();

async function musicDir() { return join(await dataDir(), 'library', 'music'); }
const musicName = (file: string) => baseName(file).replace(/^[0-9a-f]{8}-/, '').replace(/\.[^.]+$/, '');

/** Adds background music: a new file from the PC, or one from the music library (`fromLibrary`). */
async function addMusic(fromLibrary?: string, atMs = 0) {
  if (!P) return;
  let f = fromLibrary;
  if (!f) {
    const picked = await dialog().open({ title: 'Pilih musik latar', filters: [{ name: 'Audio', extensions: SOUND_EXT }] });
    if (typeof picked !== 'string') return;
    f = picked;
  }
  setBusy('Menambahkan musik…');
  try {
    const info = await probeAudio(f);
    let dest = f;
    if (!fromLibrary) {
      dest = join(await musicDir(), `${uid().slice(0, 8)}-${f.split(/[\\/]/).pop()}`);
      await invoke('copy_file', { src: f, dest });
    }
    snapshot();
    const total = Math.max(1000, timelineDuration(tl()));
    const start = isBlank() ? Math.max(0, atMs) : clamp(atMs, 0, Math.max(0, total - 500));
    const item: MusicItem = { id: uid(), file: dest, name: musicName(dest), startMs: start, inMs: 0, lengthMs: isBlank() ? info.durationMs : Math.min(info.durationMs, total - start), sourceMs: info.durationMs, volume: 0.35, duck: 'medium' };
    music().push(item);
    sel = { kind: 'music', id: item.id };
    musicLib = null;
    if (tab !== 'music') switchTab('music');
    changed({ left: true });
    toast('Musik ditambahkan dengan auto-ducking sedang. Atur volumenya di panel Musik.');
    void ensureSpeech();
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setBusy('');
  }
}

// ---------- music panel ----------
let musicLib: string[] | null = null;
async function loadMusicLib() {
  try {
    const dir = await musicDir();
    const files = await invoke<string[]>('list_dir', { path: dir }).catch(() => [] as string[]);
    musicLib = files.filter((f) => SOUND_EXT.includes(extName(f))).map((f) => join(dir, f)).sort((a, b) => musicName(a).localeCompare(musicName(b)));
  } catch { musicLib = []; }
  if (tab === 'music') renderLeft();
}

const DUCK_NAME: Record<Duck, string> = { off: 'Mati', light: 'Ringan', medium: 'Sedang', strong: 'Kuat' };

function musicPanel(): Node[] {
  if (musicLib === null) void loadMusicLib();
  const items = music();
  const used = new Set(items.map((m) => m.file));
  const lib = (musicLib ?? []).filter((f) => !used.has(f));
  return [
    h('button', { class: 'primary wide with-ico', onclick: () => void addMusic() }, icon('plus', 16), 'Tambah musik latar'),
    h('div', { class: 'muted small' }, 'Musik dipasang dari awal video dengan volume 35% dan auto-ducking: mengecil sendiri saat kamu bicara.'),
    h('div', { class: 'block' },
      h('div', { class: 'row-between' }, h('div', { class: 'label' }, 'Di timeline'), h('span', { class: 'muted small' }, items.length ? `${items.length} lagu` : '')),
      items.length ? h('div', { class: 'music-list' }, ...items.map((m) => {
        const isSel = sel?.kind === 'music' && sel.id === m.id;
        const set = (patch: Partial<MusicItem>, left = false) => { snapshot(); Object.assign(m, patch); changed({ left }); };
        return h('div', { class: `music-card${isSel ? ' sel' : ''}` },
          h('div', { class: 'music-head' },
            h('button', {
              class: 'music-play', 'data-aud': m.file, 'data-aud-size': 14, title: 'Dengarkan',
              onclick: () => toggleAudition(m.file, Math.min(1, m.volume * 1.6), m.name, m.inMs),
            }, icon('play', 14)),
            h('button', {
              class: 'music-title', title: 'Pilih dan lompat ke lagu ini',
              onclick: () => { sel = { kind: 'music', id: m.id }; multi.clear(); seek(m.startMs); renderInspector(); renderLeft(); drawTimeline(); },
            },
              h('span', { class: 'music-name' }, m.name),
              h('span', { class: 'muted small mono' }, `${tc(m.startMs)} → ${tc(m.startMs + m.lengthMs)}`),
            ),
            h('button', { class: 'icon-btn', title: 'Hapus dari timeline', 'aria-label': `Hapus ${m.name}`, onclick: () => { snapshot(); tl().music = music().filter((x) => x.id !== m.id); if (sel?.id === m.id) sel = null; changed({ left: true }); } }, icon('trash', 15)),
          ),
          h('div', { class: 'music-row' },
            icon('music', 14, 'muted'),
            h('input', {
              type: 'range', min: 0, max: 150, step: 5, value: Math.round(m.volume * 100), 'aria-label': `Volume ${m.name}`,
              oninput: (e) => { (e.target as HTMLElement).nextElementSibling!.textContent = `${(e.target as HTMLInputElement).value}%`; },
              onchange: (e) => set({ volume: Number((e.target as HTMLInputElement).value) / 100 }),
            }),
            h('span', { class: 'mono small music-vol' }, `${Math.round(m.volume * 100)}%`),
          ),
          h('div', { class: 'seg' }, ...(['off', 'light', 'medium', 'strong'] as Duck[]).map((d) =>
            h('button', { class: m.duck === d ? 'on' : '', title: 'Auto-ducking: musik mengecil saat kamu bicara', onclick: () => { set({ duck: d }, true); void ensureSpeech(); } }, DUCK_NAME[d]))),
          h('div', { class: 'music-actions' },
            h('button', { class: 'chip', title: 'Pindahkan awal lagu ke posisi playhead', onclick: () => set({ startMs: Math.round(t), lengthMs: Math.min(m.sourceMs - m.inMs, Math.max(500, timelineDuration(tl()) - Math.round(t))) }, true) }, 'Mulai di playhead'),
            h('button', { class: 'chip', title: 'Panjangkan sampai akhir video', onclick: () => set({ lengthMs: Math.min(m.sourceMs - m.inMs, Math.max(500, timelineDuration(tl()) - m.startMs)) }, true) }, 'Sampai akhir'),
          ),
        );
      })) : h('div', { class: 'empty-drop' }, h('div', { class: 'empty-title' }, 'Belum ada musik'), h('div', { class: 'muted small' }, 'Klik Tambah musik latar, atau pasang dari daftar di bawah.')),
    ),
    h('div', { class: 'block' },
      h('div', { class: 'row-between' }, h('div', { class: 'label' }, 'Pernah dipakai'), h('span', { class: 'muted small' }, musicLib === null ? 'memuat…' : `${lib.length}`)),
      lib.length ? h('div', { class: 'music-lib' }, ...lib.map((f) => h('div', { class: 'music-lib-item' },
        h('button', { class: 'music-play small', 'data-aud': f, 'data-aud-size': 12, title: 'Dengarkan', onclick: () => toggleAudition(f, 0.6, musicName(f)) }, icon('play', 12)),
        h('span', { class: 'music-lib-name', title: musicName(f) }, musicName(f)),
        h('button', { class: 'chip', title: 'Pasang dari awal video', onclick: () => void addMusic(f, 0) }, '+ Pasang'),
      ))) : h('div', { class: 'muted small' }, musicLib === null ? '' : 'Musik yang pernah kamu tambahkan akan tersimpan di sini, siap dipakai lagi di proyek lain.'),
    ),
  ];
}

const SPEECH_DB = -38;
let speechBusy = false;
/** Finds where there is talking, so the preview can duck the music like the export does. */
async function ensureSpeech() {
  if (!P || speechBusy) return;
  const todo = P.media.filter((m) => !m.silences?.[String(SPEECH_DB)]);
  if (!todo.length) return;
  speechBusy = true;
  try {
    for (const m of todo) { setBusy('Mendeteksi suara bicara…'); await silencesOf(m, SPEECH_DB); }
    await saveProject(P);
  } catch { /* preview ducking is best effort */ } finally {
    speechBusy = false;
    setBusy('');
  }
}

function talkingAt(tt: number): boolean {
  const loc = locate(tl().clips, tt);
  if (!loc) return false;
  const c = tl().clips[loc.index];
  const m = mediaOf(c.mediaId);
  const sil = m?.silences?.[String(SPEECH_DB)];
  if (!m || !sil) return false;
  return !sil.some((r) => loc.sourceMs >= r.startMs && loc.sourceMs < r.endMs);
}

function syncMusic() {
  const talk = talkingAt(t);
  for (const mu of music()) {
    let a = musicEls.get(mu.id);
    const inside = t >= mu.startMs && t < mu.startMs + mu.lengthMs;
    if (!inside) { if (a && !a.paused) a.pause(); continue; }
    if (!a) { a = new Audio(fileSrc(mu.file)); a.preload = 'auto'; musicEls.set(mu.id, a); }
    const target = mu.volume * (talk ? DUCK_LEVEL[mu.duck] : 1);
    const cur = musicLevel.get(mu.id) ?? target;
    const next = cur + (target - cur) * (target < cur ? 0.35 : 0.06);  // fast down, slow up, like the export
    musicLevel.set(mu.id, next);
    const mlen = Math.min(mu.lengthMs, timelineDuration(tl()) - mu.startMs);
    const mfd = fadesOf(mu, mlen, MUSIC_FADE_IN, MUSIC_FADE_OUT);
    a.volume = clamp(next * fadeGain(t - mu.startMs, mlen, mfd.fi, mfd.fo), 0, 1);
    const want = (mu.inMs + t - mu.startMs) / 1000;
    if (a.paused) { a.currentTime = want; void a.play().catch(() => undefined); }
    else if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
  }
}

// ---- remove pauses ----

let pauseOpts = { level: 'normal' as 'light' | 'normal' | 'strong', minGap: 0.6 };
const PAUSE_DB = { light: -45, normal: -38, strong: -31 };

function togglePausePop() {
  const pop = $('#pause-pop');
  if (!pop) return;
  pop.hidden = !pop.hidden;
  if (!pop.hidden) renderPausePop();
}

function renderPausePop() {
  const pop = $('#pause-pop');
  if (!pop || pop.hidden || !P) return;
  pop.replaceChildren(
    h('div', { class: 'row-between' }, h('h3', {}, 'Hapus jeda'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: togglePausePop }, icon('x', 15))),
    h('div', { class: 'muted small' }, 'Memotong bagian diam dari semua potongan. Subtitle, teks, meme, dan suara ikut bergeser. Bisa dibatalkan dengan Ctrl+Z.'),
    h('div', { class: 'label' }, 'Yang dianggap diam'),
    h('div', { class: 'seg' }, ...(['light', 'normal', 'strong'] as const).map((k) =>
      h('button', { class: pauseOpts.level === k ? 'on' : '', onclick: () => { pauseOpts.level = k; renderPausePop(); } }, { light: 'Hening saja', normal: 'Normal', strong: 'Agresif' }[k]))),
    h('div', { class: 'muted small' }, { light: 'Hanya memotong yang benar-benar sunyi.', normal: 'Cocok untuk kebanyakan rekaman live.', strong: 'Ikut memotong gumaman pelan dan suara game yang kecil.' }[pauseOpts.level]),
    field(`Jeda minimal ${pauseOpts.minGap.toFixed(1)} detik`, h('input', {
      type: 'range', min: 3, max: 20, value: Math.round(pauseOpts.minGap * 10),
      oninput: (e) => { pauseOpts.minGap = Number((e.target as HTMLInputElement).value) / 10; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Jeda minimal ${pauseOpts.minGap.toFixed(1)} detik`; },
    })),
    h('button', { class: 'primary wide', disabled: !tl().clips.length || !!busy, onclick: () => void runRemovePauses() }, 'Hapus jeda sekarang'),
  );
}

async function runRemovePauses() {
  const p = P!;
  pause();
  await autoSnapshot('sebelum-hapus-jeda', true);
  const db = PAUSE_DB[pauseOpts.level];
  try {
    const used = [...new Set(tl().clips.map((c) => c.mediaId))].map((id) => mediaOf(id)!).filter(Boolean);
    const silences: Record<string, Range[]> = {};
    for (const [i, m] of used.entries()) {
      setBusy(`Mencari jeda… ${used.length > 1 ? `(${i + 1}/${used.length})` : ''}`);
      silences[m.id] = await silencesOf(m, db);
    }
    const before = timelineDuration(tl());
    const res = removePauses(tl().clips, silences, pauseOpts.minGap * 1000, 150, uid);
    if (!res.cuts || res.removedMs < 100) { toast('Tidak ada jeda yang perlu dihapus dengan pengaturan ini.'); return; }
    snapshot();
    tl().clips = res.clips;
    remapItems(tl(), res.map);
    const total = timelineDuration(tl());
    for (const m of music()) m.lengthMs = Math.max(300, Math.min(m.lengthMs, total - m.startMs));
    sel = null;
    t = res.map(t);
    changed({ left: true });
    fitZoom();
    togglePausePop();
    toast(`${res.cuts} jeda dihapus. Video jadi ${tc(timelineDuration(tl()))} (sebelumnya ${tc(before)}). Ctrl+Z untuk membatalkan.`);
    await saveProject(p);
  } catch (e) {
    toast(`Hapus jeda gagal: ${(e as Error).message}`, 'error');
  } finally {
    setBusy('');
  }
}

// ================= video meme library =================

let vmSelected: string | null = null;
let vmPreview: HTMLVideoElement | null = null;

async function addVideoMemes(paths: string[], cat?: string) {
  let n = 0;
  const errors: string[] = [];
  for (const [i, f] of paths.entries()) {
    setBusy(`Menambahkan video meme${paths.length > 1 ? ` ${i + 1}/${paths.length}` : ''}…`);
    try { const c = await addVideoMeme(f, (args) => runTool('ffmpeg', args), cat, false); vmSelected = c.id; n++; }
    catch (e) { errors.push((e as Error).message); }
  }
  await saveLibrary();
  if (errors.length) toast(errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n…dan ${errors.length - 5} lainnya` : ''), 'error');
  setBusy('');
  library = await loadLibrary();
  if (n) toast(`${n} video meme ditambahkan.`);
  switchTab('vmeme');
}

/** Puts a video meme on the timeline as a layer with sound, at the playhead. */
async function insertVideoMeme(c: VideoMeme) {
  if (!P) return;
  if (!canPlace()) { toast('Tambahkan video ke timeline dulu.'); return; }
  if (!(await invoke<boolean>('exists', { path: c.file }))) { toast(`File "${c.name}" tidak ditemukan di library.`, 'error'); return; }
  pause();
  snapshot();
  let m = P.media.find((x) => x.playable === c.file);
  if (!m) {
    m = {
      id: uid(), path: c.file, playable: c.file, name: c.name, durationMs: c.durationMs, width: c.width, height: c.height,
      fps: c.fps, hasAudio: c.hasAudio, audioTracks: c.hasAudio ? 1 : 0,
      thumbs: { everySec: 1, sheets: 0, tw: 54, th: 96, ready: false },
    };
    P.media.push(m);
  }
  const start = Math.floor(t);
  const portrait = c.width / c.height < 0.8;
  const box = boxFor(NO_CROP, { w: c.width, h: c.height }, portrait ? 0.62 : 0.86, 0.5, 0.42);
  if (box.h > 0.9) { const k = 0.9 / box.h; box.w *= k; box.h = 0.9; }
  const ly: VideoLayer = {
    id: uid(), name: c.name, source: 'media', mediaId: m.id, inMs: 0, startMs: start, endMs: start + c.durationMs,
    crop: { ...NO_CROP }, box, opacity: 1, volume: c.hasAudio ? insertVol() : 0,
  };
  layers().push(ly);
  changed({ inspector: false });
  flash(c.id);
}

function videoMemePanel(): Node[] {
  if (!library) return [h('p', { class: 'muted small hint-p' }, 'Memuat library…')];
  const clips = library.clips ?? [];
  const cur = clips.find((c) => c.id === vmSelected) ?? clips[0];
  const head = h('div', { class: 'row-between' },
    h('button', {
      class: 'secondary', onclick: async () => {
        const files = await dialog().open({ multiple: true, title: 'Tambah video meme', filters: [{ name: 'Video', extensions: VIDEO_MEME_EXT }] });
        const arr = typeof files === 'string' ? [files] : files ?? [];
        if (arr.length) await addVideoMemes(arr);
      },
    }, '+ Video'),
    h('button', { class: 'ghost', title: 'Impor semua video di satu folder; nama folder jadi kategori', onclick: () => void importFolder('vmeme') }, 'Impor folder'),
    h('button', { class: libEdit ? 'secondary on-accent-border' : 'ghost', onclick: () => { libEdit = !libEdit; renderLeft(); } }, libEdit ? 'Selesai' : 'Atur'),
  );
  if (!clips.length) {
    return [
      head,
      h('div', { class: 'empty-drop' },
        h('div', { class: 'empty-title' }, 'Tarik video meme ke sini'),
        h('div', { class: 'muted small' }, 'MP4, MOV, WebM atau MKV, maksimal 3 menit. Video disimpan di library dan bisa dipakai di semua proyek.'),
      ),
    ];
  }
  if (libEdit) {
    return [
      head,
      libBar('vmeme'),
      ...filtered('vmeme', clips).map((c) => ({ c, i: clips.indexOf(c) })).map(({ c, i }) => h('div', { class: 'pad-edit' },
        h('div', { class: 'row-between' },
          h('img', { class: 'meme-mini', src: fileSrc(c.thumb), alt: '', loading: 'lazy' }),
          h('input', { value: c.name, 'aria-label': 'Nama video meme', onchange: async (e) => { c.name = (e.target as HTMLInputElement).value.trim() || c.name; await saveLibrary(); } }),
        ),
        catEditor(c, 'vmeme'),
        c.hasAudio ? h('span') : h('div', { class: 'muted small' }, 'Tanpa suara'),
        h('div', { class: 'row-between' },
          h('span', { class: 'muted small' }, i < 9 ? `Alt + ${i + 1}` : 'Tanpa tombol'),
          h('div', {}, ...orderButtons(clips, i),
            h('button', {
              class: 'icon-btn', 'aria-label': `Hapus ${c.name}`, onclick: async () => {
                if (!(await dialog().ask(`Hapus "${c.name}" dari library?\nYang sudah ada di timeline tetap aman.`, { title: 'Hapus video meme', kind: 'warning' }))) return;
                await deleteVideoMeme(c.id); library = await loadLibrary(); renderLeft();
              },
            }, icon('x', 15)),
          ),
        ),
      )),
    ];
  }
  // review player for the selected clip
  vmPreview?.pause();
  vmPreview = h('video', { class: 'vm-player', src: fileSrc(cur.file), preload: 'auto', playsinline: true });
  const player = vmPreview;
  const playBtn = h('button', { class: 'vm-play', 'aria-label': 'Putar preview' }, icon('play', 14));
  const bar = h('div', { class: 'vm-bar' }, h('div', { class: 'vm-fill' }));
  const time = h('span', { class: 'muted small mono' }, `0:00 / ${tc(cur.durationMs)}`);
  player.volume = clamp(insertVol(), 0, 1);
  playBtn.addEventListener('click', () => { if (player.paused) { pause(); player.volume = clamp(insertVol(), 0, 1); void player.play(); } else player.pause(); });
  player.addEventListener('click', () => playBtn.click());
  player.addEventListener('play', () => { playBtn.replaceChildren(icon('pause', 14)); });
  player.addEventListener('pause', () => { playBtn.replaceChildren(icon('play', 14)); });
  player.addEventListener('ended', () => { playBtn.replaceChildren(icon('play', 14)); });
  player.addEventListener('timeupdate', () => {
    (bar.firstChild as HTMLElement).style.width = `${(player.currentTime * 1000 / cur.durationMs) * 100}%`;
    time.textContent = `${tc(player.currentTime * 1000)} / ${tc(cur.durationMs)}`;
  });
  bar.addEventListener('pointerdown', (e) => { const r = bar.getBoundingClientRect(); player.currentTime = ((e.clientX - r.left) / r.width) * cur.durationMs / 1000; });
  return [
    head,
    insertVolumeControl(),
    h('div', { class: 'vm-review' },
      h('div', { class: 'vm-stage' }, player),
      h('div', { class: 'vm-controls' }, playBtn, bar, time),
      h('div', { class: 'vm-meta' },
        h('div', { class: 'vm-name' }, cur.name),
        h('div', { class: 'muted small' }, `${tc(cur.durationMs, true)} · ${cur.width}×${cur.height}${cur.hasAudio ? '' : ' · tanpa suara'}`),
      ),
      h('button', { class: 'primary wide', onclick: () => void insertVideoMeme(cur) }, 'Pasang di playhead'),
    ),
    libBar('vmeme'),
    h('div', { class: 'vm-grid' }, ...filtered('vmeme', clips).map((c) => ({ c, i: clips.indexOf(c) })).map(({ c, i }) => {
      const tile = h('button', {
        class: `vm-tile ${c.id === cur.id ? 'on' : ''}`, 'data-pad': c.id, title: `${c.name}${i < 9 ? ` (Alt+${i + 1})` : ''} · klik dua kali untuk langsung pasang`,
        onclick: () => { vmSelected = c.id; renderLeft(); setTimeout(() => { pause(); void vmPreview?.play().catch(() => undefined); }, 30); },
        ondblclick: () => void insertVideoMeme(c),
      },
        h('img', { src: fileSrc(c.thumb), alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'vm-dur' }, tc(c.durationMs)),
        i < 9 ? h('span', { class: 'pad-key' }, `⌥${i + 1}`) : null,
        h('span', { class: 'vm-tile-name' }, c.name),
      );
      const wrap = h('div', { class: 'meme-wrap' }, tile, favButton(c, 'tile-fav'));
      // hover: a silent moving preview in the tile itself
      let hv: HTMLVideoElement | null = null;
      tile.addEventListener('pointerenter', () => {
        hv = h('video', { class: 'vm-hover', src: fileSrc(c.file), muted: true, autoplay: true, loop: true, playsinline: true });
        hv.muted = true;
        tile.append(hv);
      });
      tile.addEventListener('pointerleave', () => { hv?.pause(); hv?.remove(); hv = null; });
      return wrap;
    })),
    h('p', { class: 'muted small hint-p' }, 'Klik untuk review, klik dua kali atau Alt + 1–9 untuk langsung pasang. Video meme jadi layer yang bisa digeser, di-resize dan di-crop.'),
  ];
}

// ================= video layers =================

const UNTIL_END = 1e9;
let cropMode = false;
const layerVideos = new Map<string, HTMLVideoElement>();
let mainCopy: HTMLCanvasElement | null = null;

function srcSize(ly: VideoLayer): { w: number; h: number } {
  if (ly.source === 'main') return { w: tl().width, h: tl().height };
  const m = ly.mediaId ? mediaOf(ly.mediaId) : undefined;
  return { w: m?.width ?? 1080, h: m?.height ?? 1920 };
}

/** A layer box that shows its crop at the source's own proportions, `width` = share of the canvas width. */
function boxFor(crop: Crop, src: { w: number; h: number }, width: number, x = 0.5, y = 0.5) {
  const cs = cropSize(crop, src.w, src.h);
  const h = (width * tl().width * (cs.h / cs.w)) / tl().height;
  return { x, y, w: width, h };
}

/**
 * Puts a layer in an area of the canvas without squashing it: the crop is trimmed evenly
 * (around its current centre) until it has the same shape as the area, like zooming in.
 */
function fillArea(ly: VideoLayer, box: VideoLayer['box']) {
  const src = srcSize(ly);
  const c = { ...ly.crop };
  const cs = cropSize(c, src.w, src.h);
  const want = (box.w * tl().width) / (box.h * tl().height);
  const have = cs.w / cs.h;
  if (have > want) {
    const cut = (cs.w - cs.h * want) / src.w / 2;   // too wide: trim left and right
    c.l += cut; c.r += cut;
  } else if (have < want) {
    const cut = (cs.h - cs.w / want) / src.h / 2;   // too tall: trim top and bottom
    c.t += cut; c.b += cut;
  }
  ly.crop = c;
  ly.box = { ...box };
}

function addMainLayer(name = 'Video utama', crop: Crop = { ...NO_CROP }, box?: VideoLayer['box']) {
  if (!P || !tl().clips.length) { toast('Tambahkan video ke timeline dulu.'); return null; }
  const ly: VideoLayer = {
    id: uid(), name, source: 'main', inMs: 0, startMs: 0, endMs: UNTIL_END,  // follows the main track to its end
    crop, box: box ?? { x: 0.5, y: 0.5, w: 1, h: 1 }, opacity: 1, volume: 0,
  };
  layers().push(ly);
  return ly;
}

function addMediaLayer(m: MediaEntry) {
  if (!P) return;
  if (!canPlace()) { toast('Tambahkan video ke timeline dulu, lalu jadikan video lain sebagai layer di atasnya.'); return; }
  snapshot();
  const total = timelineDuration(tl());
  const start = isBlank() ? Math.floor(t) : Math.floor(clamp(t, 0, Math.max(0, total - 500)));
  const box = boxFor(NO_CROP, { w: m.width, h: m.height }, m.width >= m.height ? 1 : 0.6);
  if (box.h > 1) { const k = 1 / box.h; box.w *= k; box.h = 1; }
  const ly: VideoLayer = {
    id: uid(), name: m.name, source: 'media', mediaId: m.id, inMs: 0, startMs: start, endMs: isBlank() ? start + m.durationMs : Math.min(total, start + m.durationMs),
    crop: { ...NO_CROP }, box, opacity: 1, volume: 0,
  };
  layers().push(ly);
  sel = { kind: 'layer', id: ly.id };
  changed({ left: tab === 'layers' });
  toast(`"${m.name}" jadi layer. Geser, tarik pojoknya, atau tekan C untuk crop.`);
}

function layerVideo(ly: VideoLayer): HTMLVideoElement | null {
  if (ly.source !== 'media' || !ly.mediaId) return null;
  let v = layerVideos.get(ly.id);
  if (v) return v;
  const m = mediaOf(ly.mediaId);
  if (!m) return null;
  v = h('video', { preload: 'auto', playsinline: true });
  corsSrc(v, fileSrc(m.playable));
  v.addEventListener('seeked', () => { if (!playing) renderFrame(); });
  v.addEventListener('loadeddata', () => { if (!playing) renderFrame(); });
  layerVideos.set(ly.id, v);
  return v;
}

/** Keeps each media layer's own video at the right time (playing or paused). */
function syncLayers() {
  if (!P) return;
  for (const ly of layers()) {
    if (ly.source !== 'media') continue;
    const v = layerVideo(ly);
    if (!v) continue;
    const inside = !ly.hidden && t >= ly.startMs && t < ly.endMs;
    v.muted = ly.volume <= 0.001;
    const llen = Math.min(ly.endMs, timelineDuration(tl())) - ly.startMs;
    const lfd = fadesOf(ly, llen);
    v.volume = clamp(ly.volume * fadeGain(t - ly.startMs, llen, lfd.fi, lfd.fo), 0, 1);
    const want = (ly.inMs + (t - ly.startMs)) / 1000;
    if (!inside) { if (!v.paused) v.pause(); continue; }
    if (playing) {
      if (v.paused) { v.currentTime = Math.max(0, want); void v.play().catch(() => undefined); }
      else if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = Math.max(0, want);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = Math.max(0, want);
    }
  }
}

let adjCopy: HTMLCanvasElement | null = null;
/** Draws the layers over the main picture (which is copied first so `main` layers can crop from it). */
function drawLayers(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const active = layers().filter((l) => !l.hidden && t >= l.startMs && t < l.endMs);
  if (!active.length && !tl().hideMain) return;
  if (active.some((l) => l.source === 'main')) {
    mainCopy ??= document.createElement('canvas');
    if (mainCopy.width !== W || mainCopy.height !== H) { mainCopy.width = W; mainCopy.height = H; }
    mainCopy.getContext('2d')!.drawImage(preview, 0, 0);
  }
  if (tl().hideMain) { ctx.fillStyle = tl().background ?? '#000'; ctx.fillRect(0, 0, W, H); }
  for (const ly of active) {
    if (ly.source === 'adjust') {
      // adjustment layer: grade what has been drawn so far
      if (isNeutral(ly.grade)) continue;
      adjCopy ??= document.createElement('canvas');
      if (adjCopy.width !== W || adjCopy.height !== H) { adjCopy.width = W; adjCopy.height = H; }
      const ac = adjCopy.getContext('2d')!;
      ac.clearRect(0, 0, W, H); ac.drawImage(preview, 0, 0);
      ctx.globalAlpha = ly.opacity;
      ctx.globalCompositeOperation = blendCss(ly.blend);
      drawGraded(ctx, adjCopy, ly.grade, W, H, null, 0, 0, W, H);
      drawVignette(ctx, 0, 0, W, H, vignetteOf(ly.grade));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      continue;
    }
    let src: CanvasImageSource | null = null, sw = 0, sh = 0;
    if (ly.source === 'main') { src = mainCopy; sw = W; sh = H; }
    else { const v = layerVideo(ly); if (v && v.readyState >= 2 && v.videoWidth) { src = v; sw = v.videoWidth; sh = v.videoHeight; } }
    const bw = ly.box.w * W, bh = ly.box.h * H, bx = ly.box.x * W - bw / 2, by = ly.box.y * H - bh / 2;
    if (src) {
      ctx.globalAlpha = ly.opacity;
      ctx.globalCompositeOperation = blendCss(ly.blend);
      const crop: [number, number, number, number] = [ly.crop.l * sw, ly.crop.t * sh, sw * (1 - ly.crop.l - ly.crop.r), sh * (1 - ly.crop.t - ly.crop.b)];
      const s0 = src;
      drawTf(ctx, ly.tf, bx + bw / 2, by + bh / 2, bw, bh, (c, x, y, w, hh) => {
        if (!needsFx(ly)) { drawGraded(c, s0, ly.grade, sw, sh, crop, x, y, w, hh); return; }
        c.drawImage(withMaskKey(w, hh, ly, (fc) => drawGraded(fc, s0, ly.grade, sw, sh, crop, 0, 0, Math.round(w), Math.round(hh))), x, y, w, hh);
      });
      drawVignette(ctx, bx, by, bw, bh, vignetteOf(ly.grade));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#1b3150'; ctx.fillRect(bx, by, bw, bh);
    }
    boxes.push({ kind: 'layer', id: ly.id, x: bx, y: by, w: bw, h: bh });
  }
  const s = selected('layer');
  if (s && !s.hidden && s.source !== 'adjust' && t >= s.startMs && t < s.endMs) drawTransformFrame(ctx, s, W, H);
}

const HANDLE = 7;
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

function frameRect(ly: VideoLayer, W: number, H: number) {
  const bw = ly.box.w * W, bh = ly.box.h * H;
  return { x: ly.box.x * W - bw / 2, y: ly.box.y * H - bh / 2, w: bw, h: bh };
}

function handlePoints(r: { x: number; y: number; w: number; h: number }): [Handle, number, number][] {
  return [
    ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, r.y + r.h / 2],
    ['se', r.x + r.w, r.y + r.h], ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
  ];
}

function drawTransformFrame(ctx: CanvasRenderingContext2D, ly: VideoLayer, W: number, H: number) {
  const r = frameRect(ly, W, H);
  ctx.save();
  if (cropMode) {
    // show the whole uncropped source, dimmed, so you can see what is being cut away
    const src = srcSize(ly);
    const cs = cropSize(ly.crop, src.w, src.h);
    const k = r.w / cs.w;
    const fx = r.x - ly.crop.l * src.w * k, fy = r.y - ly.crop.t * src.h * k, fw = src.w * k, fh = src.h * k;
    const img = ly.source === 'main' ? mainCopy : layerVideo(ly);
    if (img) { ctx.globalAlpha = 0.35; ctx.drawImage(img as CanvasImageSource, fx, fy, fw, fh); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([4, 4]); ctx.strokeRect(fx, fy, fw, fh); ctx.setLineDash([]);
    if (img) ctx.drawImage(img as CanvasImageSource, ly.crop.l * (ly.source === 'main' ? W : (img as HTMLVideoElement).videoWidth), ly.crop.t * (ly.source === 'main' ? H : (img as HTMLVideoElement).videoHeight),
      (ly.source === 'main' ? W : (img as HTMLVideoElement).videoWidth) * (1 - ly.crop.l - ly.crop.r), (ly.source === 'main' ? H : (img as HTMLVideoElement).videoHeight) * (1 - ly.crop.t - ly.crop.b), r.x, r.y, r.w, r.h);
  }
  ctx.strokeStyle = cropMode ? '#ffd400' : '#4ea1ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  if (!cropMode) {
    ctx.strokeStyle = 'rgba(78,161,255,.35)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(r.x + (r.w * i) / 3, r.y); ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.x, r.y + (r.h * i) / 3); ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3); ctx.stroke();
    }
  }
  for (const [, hx, hy] of handlePoints(r)) {
    ctx.fillStyle = cropMode ? '#ffd400' : '#ffffff';
    ctx.strokeStyle = '#121212'; ctx.lineWidth = 1.5;
    ctx.fillRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
    ctx.strokeRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
  }
  ctx.font = '600 11px "Segoe UI", sans-serif';
  const label = cropMode ? 'CROP · Enter selesai' : `${Math.round(ly.box.w * 100)}% × ${Math.round(ly.box.h * 100)}%`;
  const tw = ctx.measureText(label).width + 10;
  ctx.fillStyle = cropMode ? '#ffd400' : '#4ea1ff';
  ctx.fillRect(r.x, Math.max(0, r.y - 18), tw, 16);
  ctx.fillStyle = '#121212';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + 5, Math.max(0, r.y - 18) + 8);
  ctx.restore();
}

let layerDrag: { ly: VideoLayer; handle: Handle; sx: number; sy: number; box: VideoLayer['box']; crop: Crop; free: boolean } | null = null;

function hitHandle(ly: VideoLayer, p: { x: number; y: number }): Handle | null {
  const W = preview.width, H = preview.height;
  const r = frameRect(ly, W, H);
  const tol = 10;
  for (const [hd, hx, hy] of handlePoints(r)) if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) return hd;
  if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return 'move';
  return null;
}

function layerPointerDown(p: { x: number; y: number }, e: PointerEvent): boolean {
  const ly = selected('layer');
  if (!ly || ly.hidden || ly.locked || ly.source === 'adjust' || t < ly.startMs || t >= ly.endMs) return false;
  const hd = hitHandle(ly, p);
  if (!hd) return false;
  snapshot();
  layerDrag = { ly, handle: hd, sx: p.x, sy: p.y, box: { ...ly.box }, crop: { ...ly.crop }, free: e.shiftKey };
  return true;
}

function layerPointerMove(p: { x: number; y: number }, e: PointerEvent): boolean {
  if (!layerDrag) {
    const ly = selected('layer');
    if (ly && t >= ly.startMs && t < ly.endMs) {
      const hd = hitHandle(ly, p);
      const cur: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };
      if (hd) { preview.style.cursor = cur[hd]; return false; }
    }
    return false;
  }
  const W = preview.width, H = preview.height;
  const { ly, handle, box, crop } = layerDrag;
  const dx = (p.x - layerDrag.sx) / W, dy = (p.y - layerDrag.sy) / H;
  const left = box.x - box.w / 2, top = box.y - box.h / 2, right = box.x + box.w / 2, bottom = box.y + box.h / 2;
  if (cropMode && handle !== 'move') {
    // crop: move an edge of the box and cut the same amount from the source, so the picture does not shift or scale
    const src = srcSize(ly);
    const cs = cropSize(crop, src.w, src.h);
    const pxPerSrcX = (box.w * tl().width) / cs.w;   // canvas px per source px (same both ways)
    const shareX = (d: number) => (d * tl().width) / pxPerSrcX / src.w;
    const shareY = (d: number) => (d * tl().height) / pxPerSrcX / src.h;
    const c = { ...crop };
    let l2 = left, t2 = top, r2 = right, b2 = bottom;
    if (handle.includes('w')) { c.l = clamp(crop.l + shareX(dx), 0, 1 - crop.r - 0.03); l2 = left + ((c.l - crop.l) * src.w * pxPerSrcX) / tl().width; }
    if (handle.includes('e')) { c.r = clamp(crop.r - shareX(dx), 0, 1 - crop.l - 0.03); r2 = right - ((c.r - crop.r) * src.w * pxPerSrcX) / tl().width; }
    if (handle.includes('n')) { c.t = clamp(crop.t + shareY(dy), 0, 1 - crop.b - 0.03); t2 = top + ((c.t - crop.t) * src.h * pxPerSrcX) / tl().height; }
    if (handle.includes('s')) { c.b = clamp(crop.b - shareY(dy), 0, 1 - crop.t - 0.03); b2 = bottom - ((c.b - crop.b) * src.h * pxPerSrcX) / tl().height; }
    ly.crop = c;
    ly.box = { x: (l2 + r2) / 2, y: (t2 + b2) / 2, w: r2 - l2, h: b2 - t2 };
  } else if (handle === 'move') {
    ly.box = { ...box, x: snapC(box.x + dx), y: snapC(box.y + dy) };
  } else {
    let l2 = left, t2 = top, r2 = right, b2 = bottom;
    if (handle.includes('w')) l2 = Math.min(right - 0.02, left + dx);
    if (handle.includes('e')) r2 = Math.max(left + 0.02, right + dx);
    if (handle.includes('n')) t2 = Math.min(bottom - 0.02, top + dy);
    if (handle.includes('s')) b2 = Math.max(top + 0.02, bottom + dy);
    const corner = handle.length === 2;
    if (corner && !(e.shiftKey || layerDrag.free)) {
      // keep proportions: follow the larger change, anchored at the opposite corner
      const ratio = (box.w * W) / (box.h * H);
      let nw = (r2 - l2) * W, nh = (b2 - t2) * H;
      if (nw / ratio > nh) nh = nw / ratio; else nw = nh * ratio;
      if (handle.includes('w')) l2 = r2 - nw / W; else r2 = l2 + nw / W;
      if (handle.includes('n')) t2 = b2 - nh / H; else b2 = t2 + nh / H;
    }
    ly.box = { x: (l2 + r2) / 2, y: (t2 + b2) / 2, w: r2 - l2, h: b2 - t2 };
  }
  renderFrame();
  return true;
}

const snapC = (v: number) => (Math.abs(v - 0.5) < 0.012 ? 0.5 : Math.abs(v - 0.25) < 0.008 ? 0.25 : Math.abs(v - 0.75) < 0.008 ? 0.75 : v);

function layerPointerUp(): boolean {
  if (!layerDrag) return false;
  layerDrag = null;
  void saveProject(P!);
  renderInspector();
  return true;
}

// ================= Transform & Crop tabs =================

/** A slider row: label with value, live preview while dragging, saved when let go. */
function tfSlider(label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, apply: (v: number) => void): HTMLElement {
  return h('div', { class: 'tf-row' },
    h('span', { class: 'tf-label' }, label),
    h('input', {
      type: 'range', min, max, step, value, 'aria-label': label,
      onpointerdown: () => snapshot(),
      oninput: (e) => { const v = Number((e.target as HTMLInputElement).value); apply(v); ((e.target as HTMLElement).nextElementSibling as HTMLElement).textContent = fmt(v); renderFrame(); },
      onchange: () => changed(),
    }),
    h('span', { class: 'tf-val mono' }, fmt(value)),
  );
}
const pct = (v: number) => `${Math.round(v)}%`;

function tfHeader(kind: string, name: string): HTMLElement {
  return h('div', { class: 'tf-head' }, h('span', { class: 'tf-kind' }, kind), h('span', { class: 'tf-name' }, name));
}
function tfEmpty(what: string): Node[] {
  const vids = layers();
  return [
    h('div', { class: 'empty-drop' },
      h('div', { class: 'empty-title' }, 'Pilih dulu yang mau diatur'),
      h('div', { class: 'muted small' }, `Klik ${what} di timeline atau di preview, lalu atur di sini.`),
    ),
    vids.length ? h('div', { class: 'block' }, h('div', { class: 'label' }, 'Layer video'),
      ...[...vids].reverse().map((ly) => h('button', { class: 'secondary wide', onclick: () => { multi.clear(); sel = { kind: 'layer', id: ly.id }; if (t < ly.startMs || t >= ly.endMs) seek(ly.startMs); if (tab === 'crop') cropMode = true; renderInspector(); drawTimeline(); renderFrame(); } }, ly.name))) : h('span'),
  ];
}

/** Transform and Crop are one tool with two modes, like Free Transform and Crop in Photoshop. */
function tfModes(): HTMLElement {
  return h('div', { class: 'seg tf-modes' },
    h('button', { class: tab === 'transform' ? 'on' : '', title: 'Transform (Ctrl+T)', onclick: () => switchTab('transform') }, icon('move', 14), ' Transform'),
    h('button', { class: tab === 'crop' ? 'on' : '', title: 'Crop (C)', onclick: () => switchTab('crop') }, icon('crop', 14), ' Crop'),
  );
}

function transformPanel(): Node[] {
  return [tfModes(), ...transformBody()];
}
function transformBody(): Node[] {
  const set = (fn: () => void) => { snapshot(); fn(); changed(); };
  const ly = selected('layer');
  if (ly) {
    const src = srcSize(ly);
    const ratio = () => { const cs = cropSize(ly.crop, src.w, src.h); return (cs.h / cs.w) * (tl().width / tl().height); };
    return [
      tfHeader('Layer video', ly.name),
      ...(ly.source === 'adjust' ? [] : [tfAdvancedBlock(ly), maskBlock(ly)]),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Posisi cepat'),
        h('div', { class: 'quick-grid' },
          h('button', { class: 'chip', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.5, w: 1, h: 1 })) }, 'Penuh'),
          h('button', { class: 'chip', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.25, w: 1, h: 0.5 })) }, 'Atas'),
          h('button', { class: 'chip', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.75, w: 1, h: 0.5 })) }, 'Bawah'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.box = boxFor(ly.crop, src, 1, 0.5, 0.5); }) }, 'Pas lebar'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.box = boxFor(ly.crop, src, 0.34, 0.78, 0.2); }) }, 'Pojok kanan'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.box = boxFor(ly.crop, src, 0.34, 0.22, 0.2); }) }, 'Pojok kiri'),
        ),
      ),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Posisi & ukuran'),
        tfSlider('X', ly.box.x * 100, -20, 120, 0.5, pct, (v) => { ly.box.x = v / 100; }),
        tfSlider('Y', ly.box.y * 100, -20, 120, 0.5, pct, (v) => { ly.box.y = v / 100; }),
        tfSlider('Ukuran', ly.box.w * 100, 5, 250, 1, pct, (v) => { ly.box.w = v / 100; ly.box.h = ly.box.w * ratio(); }),
        h('label', { class: 'check' }, h('input', {
          type: 'checkbox', checked: Math.abs(ly.box.h - ly.box.w * ratio()) < 0.01,
          onchange: (e) => { if ((e.target as HTMLInputElement).checked) set(() => { ly.box.h = ly.box.w * ratio(); }); },
        }), 'Tidak gepeng (ikut proporsi crop)'),
        tfSlider('Lebar', ly.box.w * 100, 5, 250, 1, pct, (v) => { ly.box.w = v / 100; }),
        tfSlider('Tinggi', ly.box.h * 100, 5, 250, 1, pct, (v) => { ly.box.h = v / 100; }),
        tfSlider('Opacity', ly.opacity * 100, 5, 100, 1, pct, (v) => { ly.opacity = v / 100; }),
      ),
      h('div', { class: 'tf-actions' },
        h('button', { class: 'secondary with-ico', onclick: () => switchTab('crop') }, icon('crop', 15), 'Crop'),
        h('button', { class: 'ghost', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.5, w: 1, h: 1 })) }, 'Reset'),
      ),
      h('div', { class: 'muted small' }, 'Bisa juga langsung di preview: geser untuk memindah, tarik pojok untuk resize (Shift = bebas).'),
    ];
  }
  const clip = selected('clip');
  if (clip) {
    return [
      tfHeader('Video utama', mediaOf(clip.mediaId)?.name ?? ''),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Isi layar'),
        h('div', { class: 'seg' },
          h('button', { class: clip.fit === 'fill' ? 'on' : '', onclick: () => set(() => { clip.fit = 'fill'; }) }, 'Penuh'),
          h('button', { class: clip.fit === 'fit' ? 'on' : '', onclick: () => set(() => { clip.fit = 'fit'; }) }, 'Utuh'),
        ),
        tfSlider('Zoom', (clip.zoom ?? 1) * 100, 100, 300, 5, pct, (v) => { clip.zoom = v / 100; }),
        tfSlider('Arah X', (clip.zx ?? 0.5) * 100, 0, 100, 1, pct, (v) => { clip.zx = v / 100; }),
        tfSlider('Arah Y', (clip.zy ?? 0.5) * 100, 0, 100, 1, pct, (v) => { clip.zy = v / 100; }),
      ),
      h('div', { class: 'tf-actions' },
        h('button', { class: 'ghost', onclick: () => set(() => { clip.zoom = 1; clip.zx = 0.5; clip.zy = 0.5; }) }, 'Reset zoom'),
      ),
      h('div', { class: 'muted small' }, 'Video utama mengisi seluruh layar. Mau digeser, dikecilkan, atau di-crop bebas? Jadikan layer dulu: Ctrl+C lalu Ctrl+V, atau klik kanan → Salin ke layer baru.'),
    ];
  }
  const im = selected('image');
  if (im) {
    return [
      tfHeader('Meme', im.name),
      tfAdvancedBlock(im),
      maskBlock(im),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Posisi cepat'),
        h('div', { class: 'quick-grid' },
          h('button', { class: 'chip', onclick: () => set(() => { im.x = 0.5; im.y = 0.5; }) }, 'Tengah'),
          h('button', { class: 'chip', onclick: () => set(() => { im.x = 0.5; im.y = 0.28; }) }, 'Atas'),
          h('button', { class: 'chip', onclick: () => set(() => { im.x = 0.5; im.y = 0.62; }) }, 'Bawah'),
        ),
        tfSlider('X', im.x * 100, 0, 100, 0.5, pct, (v) => { im.x = v / 100; }),
        tfSlider('Y', im.y * 100, 0, 100, 0.5, pct, (v) => { im.y = v / 100; }),
        tfSlider('Ukuran', im.scale * 100, 5, 150, 1, pct, (v) => { im.scale = v / 100; }),
      ),
    ];
  }
  const tx = selected('text');
  if (tx) {
    return [
      tfHeader('Teks', tx.text.split('\n')[0]),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Rotasi'),
        tfSlider('Putar', tx.rot ?? 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => { tx.rot = Math.round(v) || undefined; }),
      ),
      h('div', { class: 'block' },
        h('div', { class: 'quick-grid' },
          h('button', { class: 'chip', onclick: () => set(() => { tx.x = 0.5; tx.y = 0.18; }) }, 'Atas'),
          h('button', { class: 'chip', onclick: () => set(() => { tx.x = 0.5; tx.y = 0.5; }) }, 'Tengah'),
          h('button', { class: 'chip', onclick: () => set(() => { tx.x = 0.5; tx.y = 0.8; }) }, 'Bawah'),
        ),
        tfSlider('X', tx.x * 100, 0, 100, 0.5, pct, (v) => { tx.x = v / 100; }),
        tfSlider('Y', tx.y * 100, 0, 100, 0.5, pct, (v) => { tx.y = v / 100; }),
        tfSlider('Ukuran', tx.style.size, 24, 200, 1, (v) => `${Math.round(v)}`, (v) => { tx.style.size = Math.round(v); }),
      ),
    ];
  }
  return tfEmpty('video, layer, meme, atau teks');
}

// ================= Warna (colour grading) =================
type Gradable = { grade?: Grade };
let gradeClipboard: Grade | null = null;
let lutLib: string[] | null = null;

/** What the colour panel changes: the selected clip or layer, else every clip of the main track. */
function gradeTargets(): { items: Gradable[]; label: string; kind: string; all: boolean } {
  const ly = selected('layer');
  if (ly) return { items: [ly], label: ly.name, kind: 'Layer video', all: false };
  const c = selected('clip');
  if (c) return { items: [c], label: mediaOf(c.mediaId)?.name ?? 'Video', kind: 'Potongan video', all: false };
  const im = selected('image');
  if (im) return { items: [im], label: im.name, kind: 'Meme / gambar', all: false };
  return { items: tl().clips, label: `${tl().clips.length} potongan`, kind: 'Semua video utama', all: true };
}
function editGrade(items: Gradable[], fn: (g: Grade) => void) {
  for (const it of items) { const g = gradeOf(it.grade); fn(g); it.grade = isNeutral(g) && !g.lut ? undefined : g; }
}
async function loadLutLib() {
  const dir = join(await dataDir(), 'library', 'luts');
  const files = await invoke<string[]>('list_dir', { path: dir }).catch(() => [] as string[]);
  lutLib = files.filter((f) => LUT_EXT.includes(extName(f))).map((f) => join(dir, f));
  if (tab === 'color') renderLeft();
}
async function pickLut(items: Gradable[]) {
  const f = await dialog().open({ title: 'Pilih LUT', filters: [{ name: 'LUT (.cube, .3dl)', extensions: [...LUT_EXT, ...LUT_EXT.map((e) => e.toUpperCase())] }] });
  if (typeof f !== 'string') return;
  try {
    parseLut(await invoke<string>('read_text', { path: f }));   // check it before keeping it
    const dir = join(await dataDir(), 'library', 'luts');
    await invoke('ensure_dir', { path: dir });
    const dest = join(dir, baseName(f));
    await invoke('copy_file', { src: f, dest });
    snapshot();
    editGrade(items, (g) => { g.lut = dest; g.lutAmount = 1; });
    lutLib = null;
    changed();
    toast(`LUT "${baseName(f).replace(/\.(cube|3dl)$/i, '')}" dipasang.`);
  } catch (e) { toast((e as Error).message, 'error'); }
}

/** Little previews of the current frame in each look. */
function lookThumb(look: Partial<Grade>, w: number, h: number): HTMLCanvasElement {
  const cv = h_canvas(w, h);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
  const loc = P ? locate(tl().clips, t) : null;
  const v = loc ? videos.get(tl().clips[loc.index].mediaId) : undefined;
  if (v && v.readyState >= 2 && v.videoWidth) {
    const s = Math.max(w / v.videoWidth, h / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
    const g = gradeOf(look);
    const out = isNeutral(g) ? null : gradeImage(v, Math.min(v.videoWidth, w * 2), Math.min(v.videoHeight, (w * 2 * v.videoHeight) / v.videoWidth), g);
    ctx.drawImage(out ?? v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    drawVignette(ctx, 0, 0, w, h, g.vignette);
  }
  return cv;
}
function h_canvas(w: number, hgt: number) { const c = document.createElement('canvas'); c.width = w; c.height = hgt; return c; }

function colorPanel(): Node[] {
  if (!P || (!tl().clips.length && !selected('layer') && !selected('image'))) return [h('div', { class: 'empty-drop' }, h('div', { class: 'empty-title' }, 'Belum ada video'), h('div', { class: 'muted small' }, 'Tambahkan video dulu, lalu atur warnanya di sini.'))];
  if (lutLib === null) void loadLutLib();
  const T = gradeTargets();
  const first = gradeOf(T.items[0]?.grade);
  const live = (fn: (g: Grade, v: number) => void) => (v: number) => { editGrade(T.items, (g) => fn(g, v)); };
  const sl = (label: string, key: keyof Grade, min: number, max: number, fmt: (v: number) => string, scale = 100) =>
    tfSlider(label, (first[key] as number) * scale, min, max, scale === 100 ? 1 : 0.05, fmt, live((g, v) => { (g[key] as number) = v / scale; g.look = undefined; }));
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  const looks = h('div', { class: 'look-grid' }, ...LOOKS.map((lk) => {
    const on = first.look === lk.id || (lk.id === 'natural' && isNeutral(first) && !first.look);
    return h('button', {
      class: `look${on ? ' on' : ''}`, title: lk.name,
      onclick: () => { snapshot(); editGrade(T.items, (g) => { const keep = { lut: g.lut, lutAmount: g.lutAmount }; Object.assign(g, NEUTRAL, lk.g, keep, { look: lk.id }); }); changed(); },
    }, lookThumb(lk.g, 84, 120), h('span', { class: 'look-name' }, lk.name));
  }));
  const lutName = first.lut ? baseName(first.lut).replace(/\.(cube|3dl)$/i, '') : '';
  return [
    h('div', { class: 'tf-head' }, h('span', { class: 'tf-kind' }, T.kind), h('span', { class: 'tf-name' }, T.label)),
    T.all ? h('div', { class: 'muted small' }, 'Tidak ada yang dipilih: perubahan berlaku untuk semua potongan video utama. Klik satu potongan atau layer untuk mengatur sendiri.') : h('span'),
    h('div', { class: 'block' }, h('div', { class: 'label' }, 'Look'), looks),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Cahaya'),
      sl('Exposure', 'exposure', -2, 2, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`, 1),
      sl('Kontras', 'contrast', -100, 100, signed),
      sl('Highlight', 'highlights', -100, 100, signed),
      sl('Shadow', 'shadows', -100, 100, signed),
      sl('Fade', 'fade', 0, 100, (v) => `${Math.round(v)}`),
    ),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Warna'),
      sl('Suhu', 'temperature', -100, 100, signed),
      sl('Tint', 'tint', -100, 100, signed),
      sl('Saturasi', 'saturation', -100, 100, signed),
      sl('Vibrance', 'vibrance', -100, 100, signed),
    ),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Detail'),
      sl('Sharpness', 'sharpen', 0, 100, (v) => `${Math.round(v)}`),
      sl('Vignette', 'vignette', 0, 100, (v) => `${Math.round(v)}`),
    ),
    ...advancedColorBlocks(T.items, first),
    h('div', { class: 'block' },
      h('div', { class: 'row-between' }, h('div', { class: 'label' }, 'LUT'), lutName ? h('span', { class: 'muted small' }, lutName) : h('span')),
      first.lut ? tfSlider('Kekuatan', (first.lutAmount ?? 1) * 100, 0, 100, 1, (v) => `${Math.round(v)}%`, live((g, v) => { g.lutAmount = v / 100; })) : h('span'),
      h('div', { class: 'lut-row' },
        h('button', { class: 'secondary with-ico', onclick: () => void pickLut(T.items) }, icon('plus', 15), 'Pilih LUT'),
        first.lut ? h('button', { class: 'ghost', onclick: () => { snapshot(); editGrade(T.items, (g) => { g.lut = undefined; g.lutAmount = undefined; }); changed(); } }, 'Lepas LUT') : h('span'),
      ),
      (lutLib ?? []).length ? h('div', { class: 'lut-lib' }, ...(lutLib ?? []).map((f) => h('button', {
        class: `chip${first.lut === f ? ' on' : ''}`, title: f,
        onclick: () => { snapshot(); editGrade(T.items, (g) => { g.lut = f; g.lutAmount = g.lutAmount ?? 1; }); changed(); },
      }, baseName(f).replace(/\.(cube|3dl)$/i, '')))) : h('div', { class: 'muted small' }, 'LUT .cube dan .3dl dari Premiere, Resolve, CapCut, atau paket LUT apa pun bisa dipakai, untuk video utama, layer, video meme, dan meme. Yang pernah dipilih tersimpan di sini.'),
    ),
    h('div', { class: 'tf-actions' },
      h('button', {
        class: 'secondary with-ico', title: 'Tahan untuk melihat tanpa warna (atau tahan tombol \\)',
        onpointerdown: () => { gradeBypass = true; renderFrame(); }, onpointerup: () => { gradeBypass = false; renderFrame(); }, onpointerleave: () => { if (gradeBypass) { gradeBypass = false; renderFrame(); } },
      }, icon('compare', 15), 'Bandingkan'),
      h('button', { class: 'ghost with-ico', onclick: () => { snapshot(); editGrade(T.items, (g) => Object.assign(g, NEUTRAL, { lut: undefined, lutAmount: undefined, look: undefined })); changed(); } }, icon('reset', 15), 'Reset'),
    ),
    !T.all ? h('button', {
      class: 'ghost wide', onclick: () => {
        const g = T.items[0]?.grade; snapshot();
        for (const c of tl().clips) c.grade = g ? structuredClone(g) : undefined;
        changed(); toast('Warna ini dipasang ke semua potongan video utama.');
      },
    }, 'Terapkan ke semua potongan video') : h('span'),
  ];
}


// ---------- Photoshop adjustments: Levels, Curves, Hue/Saturation, Color Balance ----------
const advOpen = new Set<string>();
let curveCh: 'm' | 'r' | 'g' | 'b' = 'm';
let balanceTone: 'sh' | 'mid' | 'hi' = 'mid';
function advSection(id: string, title: string, on: boolean, reset: () => void, ...body: Node[]): HTMLElement {
  const d = h('details', { class: 'block adv', ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) advOpen.add(id); else advOpen.delete(id); } },
    h('summary', {}, h('span', { class: 'label' }, title), on ? h('span', { class: 'adv-dot', title: 'Aktif' }) : '', h('span', { class: 'spacer' }),
      on ? h('button', { class: 'ghost small', onclick: (e: Event) => { e.preventDefault(); snapshot(); reset(); changed(); } }, 'Reset') : ''),
    ...body) as HTMLDetailsElement;
  d.open = advOpen.has(id);
  return d;
}
function advancedColorBlocks(items: Gradable[], first: Grade): Node[] {
  const lv = first.levels ?? LEVELS0, hs = first.hsl ?? HSL0, bal = first.balance ?? BALANCE0;
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  const levelsOn = !!first.levels && hasAdvanced({ levels: first.levels });
  const hslOn = !!first.hsl && hasAdvanced({ hsl: first.hsl });
  const balOn = !!first.balance && hasAdvanced({ balance: first.balance });
  const curvesOn = !!first.curves && hasAdvanced({ curves: first.curves });
  const lvl = (k: keyof Levels, v: number) => (g: Grade) => { g.levels = { ...(g.levels ?? LEVELS0), [k]: v }; };
  const tone = bal[balanceTone];
  const balSlider = (label: string, i: 0 | 1 | 2) => tfSlider(label, tone[i] * 100, -100, 100, 1, signed, (v) => editGrade(items, (g) => {
    const b = structuredClone(g.balance ?? BALANCE0); b[balanceTone][i] = v / 100; g.balance = b; g.look = undefined;
  }));
  return [
    advSection('levels', 'Levels', levelsOn, () => editGrade(items, (g) => { g.levels = null; }),
      tfSlider('Input hitam', lv.inB * 255, 0, 250, 1, (v) => `${Math.round(v)}`, (v) => editGrade(items, lvl('inB', v / 255))),
      tfSlider('Input putih', lv.inW * 255, 5, 255, 1, (v) => `${Math.round(v)}`, (v) => editGrade(items, lvl('inW', v / 255))),
      tfSlider('Gamma', lv.gamma, 0.2, 3, 0.01, (v) => v.toFixed(2), (v) => editGrade(items, lvl('gamma', v))),
      tfSlider('Output hitam', lv.outB * 255, 0, 250, 1, (v) => `${Math.round(v)}`, (v) => editGrade(items, lvl('outB', v / 255))),
      tfSlider('Output putih', lv.outW * 255, 5, 255, 1, (v) => `${Math.round(v)}`, (v) => editGrade(items, lvl('outW', v / 255))),
    ),
    advSection('curves', 'Curves', curvesOn, () => editGrade(items, (g) => { g.curves = null; }),
      h('div', { class: 'seg' }, ...(['m', 'r', 'g', 'b'] as const).map((c) => h('button', { class: curveCh === c ? 'on' : '', onclick: () => { curveCh = c; renderLeft(); } }, c === 'm' ? 'RGB' : c.toUpperCase()))),
      curveEditor(items, first),
      h('div', { class: 'muted small' }, 'Klik untuk menambah titik, geser untuk mengubah, klik dua kali titik untuk menghapus.'),
    ),
    advSection('hsl', 'Hue / Saturation', hslOn, () => editGrade(items, (g) => { g.hsl = null; }),
      tfSlider('Hue', hs.hue, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => editGrade(items, (g) => { g.hsl = { ...(g.hsl ?? HSL0), hue: v }; g.look = undefined; })),
      tfSlider('Saturation', hs.sat * 100, -100, 100, 1, signed, (v) => editGrade(items, (g) => { g.hsl = { ...(g.hsl ?? HSL0), sat: v / 100 }; g.look = undefined; })),
      tfSlider('Lightness', hs.light * 100, -100, 100, 1, signed, (v) => editGrade(items, (g) => { g.hsl = { ...(g.hsl ?? HSL0), light: v / 100 }; g.look = undefined; })),
    ),
    advSection('balance', 'Color Balance', balOn, () => editGrade(items, (g) => { g.balance = null; }),
      h('div', { class: 'seg' }, ...([['sh', 'Shadow'], ['mid', 'Midtone'], ['hi', 'Highlight']] as const).map(([k, n]) => h('button', { class: balanceTone === k ? 'on' : '', onclick: () => { balanceTone = k; renderLeft(); } }, n))),
      balSlider('Cyan ↔ Red', 0), balSlider('Magenta ↔ Green', 1), balSlider('Yellow ↔ Blue', 2),
    ),
  ];
}

function curveEditor(items: Gradable[], first: Grade): HTMLElement {
  const S = 236, D = window.devicePixelRatio || 1;
  const cv = h('canvas', { class: 'curve-cv', width: S * D, height: S * D, style: `width:${S}px;height:${S}px`, 'aria-label': 'Editor curves' }) as HTMLCanvasElement;
  let pts: [number, number][] = (first.curves?.[curveCh] ?? [[0, 0], [1, 1]]).map(([a, b]) => [a, b]);
  const col = { m: '#e7edf1', r: '#ff6b6b', g: '#5fd08f', b: '#5aa9ff' }[curveCh];
  const draw = () => {
    const c = cv.getContext('2d')!;
    c.setTransform(D, 0, 0, D, 0, 0);
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#0c1217'; c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo((S * i) / 4, 0); c.lineTo((S * i) / 4, S); c.moveTo(0, (S * i) / 4); c.lineTo(S, (S * i) / 4); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.15)'; c.beginPath(); c.moveTo(0, S); c.lineTo(S, 0); c.stroke();
    const tab = curveTable(pts);
    c.strokeStyle = col; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 256; i++) { const x = (i / 255) * S, y = S - tab[i] * S; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    for (const [x, y] of pts) { c.fillStyle = '#0c1217'; c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x * S, S - y * S, 4.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
  };
  const apply = () => { const p = pts.map(([a, b]) => [a, b] as [number, number]); editGrade(items, (g) => { g.curves = { ...(g.curves ?? {}), [curveCh]: p }; g.look = undefined; }); renderFrame(); draw(); };
  const at = (e: PointerEvent | MouseEvent) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)] as [number, number]; };
  const near = (p: [number, number]) => pts.findIndex(([x, y]) => Math.hypot((x - p[0]) * S, (y - p[1]) * S) < 9);
  let drag = -1;
  cv.addEventListener('pointerdown', (e) => {
    const p = at(e);
    snapshot();
    drag = near(p);
    if (drag < 0) { pts.push([p[0], curveTable(pts)[Math.round(p[0] * 255)]]); pts.sort((a, b) => a[0] - b[0]); drag = near([p[0], curveTable(pts)[Math.round(p[0] * 255)]]); if (drag < 0) drag = pts.findIndex(([x]) => x === p[0]); }
    cv.setPointerCapture(e.pointerId);
    apply();
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const [x, y] = at(e);
    const lo = drag > 0 ? pts[drag - 1][0] + 0.01 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 0.01 : 1;
    pts[drag] = [drag === 0 && pts[0][0] === 0 ? 0 : drag === pts.length - 1 && pts[drag][0] === 1 ? 1 : clamp(x, lo, hi), y];
    apply();
  });
  const up = () => { if (drag >= 0) { drag = -1; changed(); } };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', (e) => {
    const i = near(at(e));
    if (i > 0 && i < pts.length - 1) { snapshot(); pts.splice(i, 1); apply(); changed(); }
  });
  draw();
  return cv;
}

/** Trims a crop around its centre to an aspect ratio (w/h of the result in pixels). */
function cropToAspect(ly: VideoLayer, aspect: number) {
  const src = srcSize(ly);
  const c = { ...ly.crop };
  const cs = cropSize(c, src.w, src.h);
  const have = cs.w / cs.h;
  if (have > aspect) { const cut = (cs.w - cs.h * aspect) / src.w / 2; c.l += cut; c.r += cut; }
  else { const cut = (cs.h - cs.w / aspect) / src.h / 2; c.t += cut; c.b += cut; }
  ly.crop = c;
}

function cropPanel(): Node[] {
  return [tfModes(), ...cropBody()];
}
function cropBody(): Node[] {
  const ly = selected('layer');
  if (ly) {
    const src = srcSize(ly);
    const set = (fn: () => void, keepBox = true) => { snapshot(); fn(); if (keepBox) ly.box = boxFor(ly.crop, src, ly.box.w, ly.box.x, ly.box.y); changed(); };
    const side = (label: string, k: keyof Crop, other: keyof Crop) => tfSlider(label, ly.crop[k] * 100, 0, 95, 0.5, pct, (v) => { ly.crop[k] = Math.min(v / 100, 0.97 - ly.crop[other]); });
    return [
      tfHeader('Layer video', ly.name),
      h('div', { class: 'block' },
        h('div', { class: 'seg' },
          h('button', { class: cropMode ? 'on' : '', onclick: () => { cropMode = true; renderLeft(); renderFrame(); } }, 'Crop di preview'),
          h('button', { class: !cropMode ? 'on' : '', onclick: () => { cropMode = false; renderLeft(); renderFrame(); } }, 'Selesai'),
        ),
        h('div', { class: 'muted small' }, cropMode ? 'Tarik sisi atau pojok kotak kuning di preview. Bagian yang terpotong tampil redup.' : 'Klik "Crop di preview" untuk menarik kotak crop langsung di video.'),
      ),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Bentuk'),
        h('div', { class: 'quick-grid' },
          ...([['Bebas', 0], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9], ['4:3', 4 / 3]] as [string, number][]).map(([n, a]) =>
            h('button', { class: 'chip', title: n === 'Bebas' ? 'Hapus crop' : `Potong jadi ${n} dari tengah`, onclick: () => set(() => { if (!a) ly.crop = { ...NO_CROP }; else { ly.crop = { ...NO_CROP }; cropToAspect(ly, a); } }) }, n)),
        ),
        h('div', { class: 'label' }, 'Ambil bagian'),
        h('div', { class: 'quick-grid' },
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { l: 0, t: 0, r: 0, b: 0.5 }; }) }, 'Atas'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { l: 0, t: 0.5, r: 0, b: 0 }; }) }, 'Bawah'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { l: 0, t: 0.25, r: 0, b: 0.25 }; }) }, 'Tengah'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { l: 0, t: 0, r: 0.5, b: 0 }; }) }, 'Kiri'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { l: 0.5, t: 0, r: 0, b: 0 }; }) }, 'Kanan'),
          h('button', { class: 'chip', onclick: () => set(() => { ly.crop = { ...NO_CROP }; }) }, 'Reset'),
        ),
      ),
      h('div', { class: 'block' },
        h('div', { class: 'label' }, 'Potong dari tiap sisi'),
        side('Kiri', 'l', 'r'), side('Atas', 't', 'b'), side('Kanan', 'r', 'l'), side('Bawah', 'b', 't'),
        h('button', { class: 'ghost small', onclick: () => set(() => undefined) }, 'Kotak ikut proporsi crop (tidak gepeng)'),
      ),
      h('div', { class: 'tf-actions' },
        h('button', { class: 'secondary with-ico', onclick: () => switchTab('transform') }, icon('move', 15), 'Transform'),
      ),
    ];
  }
  const clip = selected('clip');
  if (clip) {
    return [
      tfHeader('Video utama', mediaOf(clip.mediaId)?.name ?? ''),
      h('div', { class: 'empty-drop' },
        h('div', { class: 'empty-title' }, 'Crop dilakukan di layer'),
        h('div', { class: 'muted small' }, 'Video utama selalu mengisi layar. Salin potongan ini jadi layer, lalu crop sesukamu. Video utamanya bisa disembunyikan.'),
      ),
      h('button', {
        class: 'primary wide with-ico', onclick: () => {
          const i = tl().clips.indexOf(clip);
          const ly = clipAsLayer(clip, clipStarts(tl().clips)[i]);
          if (!ly) return;
          snapshot(); layers().push(ly); multi.clear(); sel = { kind: 'layer', id: ly.id }; cropMode = true;
          changed({ left: true });
          toast('Potongan ini sekarang juga jadi layer. Tarik kotak kuning di preview untuk crop.');
        },
      }, icon('layers', 16), 'Salin ke layer & crop'),
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: !tl().hideMain,
        onchange: (e) => { snapshot(); tl().hideMain = !(e.target as HTMLInputElement).checked; changed({ left: true }); },
      }), 'Tampilkan video utama di belakang layer'),
    ];
  }
  return tfEmpty('video atau layer');
}

type LRow = { kind: 'text' | 'image' | 'layer' | 'captions' | 'main'; id: string };
type LObj = { hidden?: boolean; locked?: boolean; group?: string; name?: string };
function rowObj(r: LRow): LObj | null {
  if (r.kind === 'text') return tl().texts.find((x) => x.id === r.id) ?? null;
  if (r.kind === 'image') return images().find((x) => x.id === r.id) ?? null;
  if (r.kind === 'layer') return layers().find((x) => x.id === r.id) ?? null;
  if (r.kind === 'captions') return tl().captions as LObj;
  return null;
}
const rowSel = (r: LRow): SelKind | null => (r.kind === 'captions' || r.kind === 'main' ? null : r.kind);
function isLocked(kind: SelKind, id: string): boolean {
  if (kind === 'line') return !!tl().captions.locked;
  if (kind === 'text' || kind === 'image' || kind === 'layer') return !!rowObj({ kind, id })?.locked || groupOf(rowObj({ kind, id })?.group)?.locked === true;
  return false;
}
let lockedToastAt = 0;
function lockedToast() { if (Date.now() - lockedToastAt > 2500) { lockedToastAt = Date.now(); toast('Terkunci 🔒. Buka kunci di panel Layer.'); } }
type GroupX = LayerGroup & { locked?: boolean; hidden?: boolean };
const groupsOf = () => (tl().groups ??= []) as GroupX[];
const groupOf = (id?: string) => (id ? groupsOf().find((g) => g.id === id) : undefined);
function rowName(r: LRow): string {
  if (r.kind === 'text') { const x = tl().texts.find((q) => q.id === r.id)!; return (x as LObj).name || x.text.split('\n')[0] || 'Teks'; }
  if (r.kind === 'image') return images().find((q) => q.id === r.id)?.name ?? 'Gambar';
  if (r.kind === 'layer') return layers().find((q) => q.id === r.id)?.name ?? 'Layer';
  if (r.kind === 'captions') return `Subtitle (${tl().captions.lines.length} baris)`;
  return 'Video utama';
}
function rowIcon(r: LRow): IconName {
  if (r.kind === 'layer') return layers().find((q) => q.id === r.id)?.source === 'adjust' ? 'color' : 'layers';
  return ({ text: 'text', image: 'image', captions: 'captions', main: 'video' } as const)[r.kind];
}
function selectRow(r: LRow, e?: MouseEvent) {
  const k = rowSel(r);
  if (!k) { if (r.kind === 'captions' && tl().captions.lines.length) { const l = tl().captions.lines.find((x) => x.endMs > t) ?? tl().captions.lines[0]; sel = { kind: 'line', id: l.id }; multi.clear(); renderInspector(); renderLeft(); drawTimeline(); renderFrame(); } return; }
  if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    if (sel && !multi.size) multi.add(mkey(sel.kind, sel.id));
    const key = mkey(k, r.id);
    if (multi.has(key)) multi.delete(key); else multi.add(key);
    sel = null;
  } else {
    multi.clear();
    sel = { kind: k, id: r.id };
    const sp = span(k, r.id);
    if (sp && (t < sp.a || t >= sp.b)) seek(sp.a);
  }
  renderInspector(); renderLeft(); drawTimeline(); renderFrame();
}
function pickedRows(): LRow[] {
  const keys = multi.size ? [...multi] : sel ? [mkey(sel.kind, sel.id)] : [];
  return keys.map((k) => { const [kind, id] = k.split(':'); return { kind, id } as LRow; }).filter((r) => r.kind === 'text' || r.kind === 'image' || r.kind === 'layer');
}
function groupSelection() {
  const rows = pickedRows();
  if (rows.length < 2) { toast('Pilih 2 item atau lebih dulu (Ctrl+klik di panel Layer atau timeline), lalu Ctrl+G.'); return; }
  snapshot();
  const g: GroupX = { id: uid(), name: `Grup ${groupsOf().length + 1}` };
  groupsOf().push(g);
  for (const r of rows) { const o = rowObj(r); if (o) o.group = g.id; }
  changed({ left: true });
  toast(`${rows.length} item jadi ${g.name}. Klik nama grup untuk memilih semuanya.`);
}
function ungroup(id?: string) {
  const gid = id ?? pickedRows().map((r) => rowObj(r)?.group).find(Boolean);
  if (!gid) return;
  snapshot();
  for (const o of [...tl().texts, ...images(), ...layers()] as LObj[]) if (o.group === gid) delete o.group;
  tl().groups = groupsOf().filter((g) => g.id !== gid);
  changed({ left: true });
}
function renameInline(el: HTMLElement, value: string, done: (v: string) => void) {
  const inp = h('input', { class: 'lp-rename', value }) as HTMLInputElement;
  el.replaceWith(inp);
  inp.focus(); inp.select();
  let ok = false;
  const fin = (save: boolean) => { if (ok) return; ok = true; if (save && inp.value.trim() && inp.value.trim() !== value) done(inp.value.trim()); else renderLeft(); };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
}
let dragRow: LRow | null = null;
function layerRow(r: LRow, depth = 0): HTMLElement {
  const o = rowObj(r);
  const isMain = r.kind === 'main';
  const hidden = isMain ? !!tl().hideMain : !!o?.hidden;
  const locked = !!o?.locked;
  const k = rowSel(r);
  const on = !!k && ((sel?.kind === k && sel.id === r.id) || multi.has(mkey(k, r.id)));
  const reorderable = r.kind === 'text' || r.kind === 'image' || r.kind === 'layer';
  const nameEl = h('span', { class: 'lp-name', title: 'Klik dua kali untuk ganti nama' }, rowName(r));
  if (o && r.kind !== 'captions') nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); renameInline(nameEl, rowName(r), (v) => { snapshot(); o.name = v; changed({ left: true }); }); });
  const row = h('div', {
    class: `lp-row${on ? ' on' : ''}${hidden ? ' off' : ''}`, style: `padding-left:${8 + depth * 16}px`, draggable: reorderable ? 'true' : undefined,
    onclick: (e: Event) => selectRow(r, e as MouseEvent),
  },
    h('button', {
      class: 'lp-btn', 'aria-label': hidden ? 'Tampilkan' : 'Sembunyikan', title: hidden ? 'Tampilkan' : 'Sembunyikan',
      onclick: (e: Event) => { e.stopPropagation(); snapshot(); if (isMain) tl().hideMain = !tl().hideMain; else if (o) o.hidden = !o.hidden; changed({ left: true }); },
    }, icon(hidden ? 'eyeOff' : 'eye', 15)),
    isMain ? h('span', { class: 'lp-btn ghosted' }) : h('button', {
      class: `lp-btn${locked ? ' lit' : ''}`, 'aria-label': locked ? 'Buka kunci' : 'Kunci', title: locked ? 'Buka kunci' : 'Kunci (tidak bisa digeser)',
      onclick: (e: Event) => { e.stopPropagation(); if (!o) return; snapshot(); o.locked = !o.locked; changed({ left: true }); },
    }, icon(locked ? 'lock' : 'unlock', 14)),
    h('span', { class: 'lp-ico' }, icon(rowIcon(r), 15)),
    nameEl,
    reorderable ? h('span', { class: 'lp-tools' },
      h('button', { class: 'lp-btn', 'aria-label': 'Duplikat', title: 'Duplikat (Ctrl+J)', onclick: (e: Event) => { e.stopPropagation(); selectRow(r); duplicateSelection(); } }, icon('dup', 14)),
      h('button', { class: 'lp-btn', 'aria-label': 'Hapus', title: 'Hapus', onclick: (e: Event) => { e.stopPropagation(); selectRow(r); deleteSelected(); } }, icon('trash', 14)),
    ) : '',
  );
  if (reorderable) {
    row.addEventListener('dragstart', (e) => { dragRow = r; e.dataTransfer?.setData('text/plain', r.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { dragRow = null; row.classList.remove('dragging'); });
    row.addEventListener('dragover', (e) => { if (dragRow && dragRow.kind === r.kind && dragRow.id !== r.id) { e.preventDefault(); row.classList.add('drop'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop');
      if (!dragRow || dragRow.kind !== r.kind) return;
      const arr = (r.kind === 'text' ? tl().texts : r.kind === 'image' ? images() : layers()) as { id: string }[];
      const from = arr.findIndex((x) => x.id === dragRow!.id), to = arr.findIndex((x) => x.id === r.id);
      if (from < 0 || to < 0) return;
      snapshot();
      const [it] = arr.splice(from, 1);
      arr.splice(to, 0, it);   // the panel lists top first, so dropping on a row puts it just in front of or behind it
      changed({ left: true });
    });
  }
  return row;
}
function layerPanel(): Node[] {
  const grouped = new Map<string, LRow[]>();
  const loose = (rows: LRow[]) => rows.filter((r) => { const g = rowObj(r)?.group; if (g && groupOf(g)) { grouped.set(g, [...(grouped.get(g) ?? []), r]); return false; } return true; });
  const texts = loose([...tl().texts].reverse().map((x) => ({ kind: 'text', id: x.id }) as LRow));
  const imgs = loose([...images()].reverse().map((x) => ({ kind: 'image', id: x.id }) as LRow));
  const lys = loose([...layers()].reverse().map((x) => ({ kind: 'layer', id: x.id }) as LRow));
  const section = (title: string, rows: Node[]) => rows.length ? [h('div', { class: 'lp-sec' }, title), ...rows] : [];
  const groupRows = groupsOf().filter((g) => grouped.has(g.id)).flatMap((g) => {
    const members = grouped.get(g.id)!;
    const allOn = members.every((r) => { const k = rowSel(r)!; return multi.has(mkey(k, r.id)) || (sel?.kind === k && sel.id === r.id); });
    const nameEl = h('span', { class: 'lp-name', title: 'Klik: pilih semua isi grup. Klik dua kali: ganti nama' }, g.name);
    nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); renameInline(nameEl, g.name, (v) => { snapshot(); g.name = v; changed({ left: true }); }); });
    const hiddenAll = members.every((r) => rowObj(r)?.hidden);
    const head = h('div', {
      class: `lp-row lp-group${allOn ? ' on' : ''}`,
      onclick: () => { multi.clear(); sel = null; for (const r of members) multi.add(mkey(rowSel(r)!, r.id)); renderInspector(); renderLeft(); drawTimeline(); renderFrame(); },
    },
      h('button', { class: 'lp-btn', 'aria-label': hiddenAll ? 'Tampilkan grup' : 'Sembunyikan grup', onclick: (e: Event) => { e.stopPropagation(); snapshot(); for (const r of members) { const o = rowObj(r); if (o) o.hidden = !hiddenAll; } changed({ left: true }); } }, icon(hiddenAll ? 'eyeOff' : 'eye', 15)),
      h('button', { class: `lp-btn${g.locked ? ' lit' : ''}`, 'aria-label': g.locked ? 'Buka kunci grup' : 'Kunci grup', onclick: (e: Event) => { e.stopPropagation(); snapshot(); g.locked = !g.locked; changed({ left: true }); } }, icon(g.locked ? 'lock' : 'unlock', 14)),
      h('button', { class: 'lp-btn', 'aria-label': g.collapsed ? 'Buka grup' : 'Tutup grup', onclick: (e: Event) => { e.stopPropagation(); g.collapsed = !g.collapsed; renderLeft(); } }, icon(g.collapsed ? 'chevRight' : 'chevDown', 14)),
      h('span', { class: 'lp-ico' }, icon('folder', 15)),
      nameEl,
      h('span', { class: 'lp-tools' }, h('button', { class: 'lp-btn', 'aria-label': 'Lepas grup', title: 'Lepas grup (Ctrl+Shift+G)', onclick: (e: Event) => { e.stopPropagation(); ungroup(g.id); } }, icon('x', 14))),
    );
    return [head, ...(g.collapsed ? [] : members.map((r) => layerRow(r, 1)))];
  });
  const many = pickedRows().length >= 2;
  return [
    h('div', { class: 'lp-bar' },
      h('button', { class: 'lp-act', title: 'Adjustment layer: atur warna semua yang di bawahnya', onclick: () => void addAdjustmentLayer() }, icon('color', 15), 'Adjustment'),
      h('button', { class: 'lp-act', disabled: !many, title: 'Gabungkan item yang dipilih jadi satu grup (Ctrl+G)', onclick: groupSelection }, icon('folder', 15), 'Grup'),
      h('button', { class: 'lp-act', title: 'Layer baru dari video utama', onclick: () => { snapshot(); const ly = addMainLayer(); if (ly) { sel = { kind: 'layer', id: ly.id }; cropMode = true; changed({ left: true }); } } }, icon('plus', 15), 'Layer'),
    ),
    h('div', { class: 'lp-list', role: 'list' },
      ...groupRows,
      ...section('Teks', texts.map((r) => layerRow(r))),
      ...(tl().captions.lines.length ? section('Subtitle', [layerRow({ kind: 'captions', id: 'captions' })]) : []),
      ...section('Meme & gambar', imgs.map((r) => layerRow(r))),
      ...section('Layer video', lys.map((r) => layerRow(r))),
      ...section('Dasar', [layerRow({ kind: 'main', id: 'main' })]),
    ),
    h('p', { class: 'muted small hint-p' }, 'Atas = paling depan. Seret baris untuk mengubah urutan. Ctrl+klik untuk memilih beberapa, Ctrl+G untuk grup. Klik dua kali nama untuk ganti nama.'),
  ];
}

function pctInput(label: string, value: number, onSet: (v: number) => void, min = 0, max = 100) {
  return h('label', { class: 'field mini' }, h('span', { class: 'label' }, label), h('input', {
    type: 'number', min, max, step: 1, value: Math.round(value * 1000) / 10,
    onchange: (e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onSet(clamp(v, min, max) / 100); },
  }));
}



/** A new adjustment layer over the whole timeline, on top of the other layers. */
function addAdjustmentLayer(): VideoLayer | null {
  if (!P) return null;
  snapshot();
  const n = layers().filter((l) => l.source === 'adjust').length + 1;
  const ly: VideoLayer = {
    id: uid(), name: `Adjustment ${n}`, source: 'adjust', inMs: 0, startMs: 0, endMs: Math.max(1000, timelineDuration(tl())),
    crop: { ...NO_CROP }, box: { x: 0.5, y: 0.5, w: 1, h: 1 }, opacity: 1, volume: 0, grade: { ...NEUTRAL },
  };
  (tl().layers ??= []).push(ly);
  sel = { kind: 'layer', id: ly.id };
  multi.clear();
  changed({ left: true });
  switchTab('color');
  toast('Adjustment layer dibuat: warna yang diatur di sini kena ke video dan layer di bawahnya. Geser ujungnya di timeline untuk membatasi waktunya.');
  return ly;
}
function adjustInspector(ly: VideoLayer): Node[] {
  return [
    h('div', { class: 'row-between' },
      h('input', { class: 'layer-title', value: ly.name, 'aria-label': 'Nama layer', onchange: (e: Event) => { snapshot(); ly.name = (e.target as HTMLInputElement).value.trim() || ly.name; changed(); } })),
    h('div', { class: 'muted small' }, `Adjustment layer · ${tc(ly.startMs)} → ${tc(Math.min(ly.endMs, timelineDuration(tl())))}. Mengubah warna semua yang ada di bawahnya.`),
    h('div', { class: 'block' },
      tfSlider('Kekuatan', ly.opacity * 100, 0, 100, 1, pct, (v) => { ly.opacity = v / 100; }),
      h('button', { class: 'secondary wide with-ico', onclick: () => switchTab('color') }, icon('color', 15), 'Atur warna (Ctrl+U)'),
    ),
    blendBlock(ly),
  ];
}
const blendCss = (b?: Blend): GlobalCompositeOperation => BLENDS.find((x) => x.id === b)?.css ?? 'source-over';
/** Photoshop-style blending for a layer or picture. */
function blendBlock(obj: { blend?: Blend }): HTMLElement {
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Blending'),
    h('select', {
      'aria-label': 'Mode blending',
      onchange: (e: Event) => { snapshot(); const v = (e.target as HTMLSelectElement).value as Blend; obj.blend = v === 'normal' ? undefined : v; changed(); },
    }, ...BLENDS.map((b) => h('option', { value: b.id, selected: (obj.blend ?? 'normal') === b.id }, b.name))),
    h('div', { class: 'muted small' }, 'Multiply menggelapkan (bagus untuk latar putih), Screen/Add menerangkan (bagus untuk efek api, cahaya, latar hitam).'),
  );
}
function layerInspector(ly: VideoLayer): Node[] {
  const set = (fn: () => void) => { snapshot(); fn(); changed(); };
  if (ly.source === 'adjust') return adjustInspector(ly);
  const src = srcSize(ly);
  const keepRatioBox = (w: number) => boxFor(ly.crop, src, w, ly.box.x, ly.box.y);
  return [
    h('div', { class: 'row-between' },
      h('input', { class: 'layer-title', value: ly.name, 'aria-label': 'Nama layer', onchange: (e) => set(() => { ly.name = (e.target as HTMLInputElement).value.trim() || ly.name; }) }),
    ),
    h('div', { class: 'muted small' }, `${ly.source === 'main' ? 'Dari video utama (ikut potongan & hapus jeda)' : 'Video lain'} · ${tc(ly.startMs)} → ${tc(Math.min(ly.endMs, timelineDuration(tl())))}`),
    blendBlock(ly),
    h('div', { class: 'block' },
      h('div', { class: 'seg' },
        h('button', { class: !cropMode ? 'on' : '', onclick: () => { cropMode = false; renderInspector(); renderFrame(); } }, 'Transform'),
        h('button', { class: cropMode ? 'on' : '', onclick: () => { cropMode = true; renderInspector(); renderFrame(); } }, 'Crop (C)'),
      ),
      h('div', { class: 'muted small' }, cropMode
        ? 'Tarik sisi atau pojok kotak kuning untuk memotong. Bagian yang terpotong tampil redup. Enter untuk selesai.'
        : 'Geser untuk memindah. Tarik pojok untuk resize (rasio terkunci, tahan Shift untuk bebas). Tarik sisi untuk meregang.'),
    ),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Posisi cepat'),
      h('div', { class: 'quick-grid' },
        h('button', { class: 'chip', title: 'Isi seluruh layar (di-zoom, tidak gepeng)', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.5, w: 1, h: 1 })) }, 'Penuh'),
        h('button', { class: 'chip', title: 'Isi setengah atas (di-zoom, tidak gepeng)', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.25, w: 1, h: 0.5 })) }, 'Setengah atas'),
        h('button', { class: 'chip', title: 'Isi setengah bawah (di-zoom, tidak gepeng)', onclick: () => set(() => fillArea(ly, { x: 0.5, y: 0.75, w: 1, h: 0.5 })) }, 'Setengah bawah'),
        h('button', { class: 'chip', title: 'Lebar penuh dengan proporsi crop', onclick: () => set(() => { ly.box = keepRatioBox(1); }) }, 'Pas lebar'),
        h('button', { class: 'chip', title: 'Tinggi kotak mengikuti proporsi crop (tidak gepeng)', onclick: () => set(() => { ly.box = keepRatioBox(ly.box.w); }) }, 'Tidak gepeng'),
        h('button', { class: 'chip', onclick: () => set(() => { ly.box = boxFor(ly.crop, src, 0.32, 0.78, 0.18); }) }, 'Kecil pojok'),
      ),
    ),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Posisi & ukuran (% kanvas)'),
      h('div', { class: 'grid4' },
        pctInput('X', ly.box.x, (v) => set(() => { ly.box.x = v; }), -50, 150),
        pctInput('Y', ly.box.y, (v) => set(() => { ly.box.y = v; }), -50, 150),
        pctInput('Lebar', ly.box.w, (v) => set(() => { ly.box.w = Math.max(0.02, v); }), 2, 300),
        pctInput('Tinggi', ly.box.h, (v) => set(() => { ly.box.h = Math.max(0.02, v); }), 2, 300),
      ),
      h('div', { class: 'label' }, 'Crop (% dipotong dari tiap sisi)'),
      h('div', { class: 'grid4' },
        pctInput('Kiri', ly.crop.l, (v) => set(() => { ly.crop.l = Math.min(v, 0.97 - ly.crop.r); }), 0, 97),
        pctInput('Atas', ly.crop.t, (v) => set(() => { ly.crop.t = Math.min(v, 0.97 - ly.crop.b); }), 0, 97),
        pctInput('Kanan', ly.crop.r, (v) => set(() => { ly.crop.r = Math.min(v, 0.97 - ly.crop.l); }), 0, 97),
        pctInput('Bawah', ly.crop.b, (v) => set(() => { ly.crop.b = Math.min(v, 0.97 - ly.crop.t); }), 0, 97),
      ),
      h('button', { class: 'ghost small', onclick: () => set(() => { ly.crop = { ...NO_CROP }; }) }, 'Reset crop'),
    ),
    h('div', { class: 'block' },
      field(`Opacity ${Math.round(ly.opacity * 100)}%`, h('input', {
        type: 'range', min: 5, max: 100, value: Math.round(ly.opacity * 100),
        onpointerdown: () => snapshot(),
        oninput: (e) => { ly.opacity = Number((e.target as HTMLInputElement).value) / 100; ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Opacity ${Math.round(ly.opacity * 100)}%`; renderFrame(); },
        onchange: () => void saveProject(P!),
      })),
      ly.source === 'media' ? field(`Volume ${Math.round(ly.volume * 100)}%`, h('input', {
        type: 'range', min: 0, max: 200, step: 5, value: Math.round(ly.volume * 100),
        oninput: (e) => { ((e.target as HTMLElement).previousElementSibling as HTMLElement).textContent = `Volume ${(e.target as HTMLInputElement).value}%`; },
        onchange: (e) => set(() => { ly.volume = Number((e.target as HTMLInputElement).value) / 100; }),
      })) : h('div', { class: 'muted small' }, 'Suara layer dari video utama sudah ikut di video utama.'),
      h('div', { class: 'muted small' }, 'Atur kapan layer muncul dengan menarik ujung kotaknya di lajur LAYER pada timeline.'),
    ),
    ly.source === 'media' && ly.volume > 0.001 ? fadeBlock('layer', ly.id) : h('span'),
    h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus layer'),
  ];
}

// ================= export =================

function toggleExport() {
  const pop = $('#export-pop');
  if (!pop) return;
  pop.hidden = !pop.hidden;
  if (!pop.hidden) renderExport();
}

function renderExport() {
  const pop = $('#export-pop');
  if (!pop || pop.hidden || !P) return;
  const d = timelineDuration(tl());
  pop.replaceChildren(
    h('div', { class: 'row-between' }, h('h3', {}, 'Ekspor'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: toggleExport }, icon('x', 15))),
    h('div', { class: 'muted small' }, `${tl().width}×${tl().height} · ${tl().fps} fps · ${exportFormat() === 'webm' ? 'WEBM VP9' : `${exportFormat().toUpperCase()} H.264`} · ${tc(d, true)}`),
    d > 180000 ? h('div', { class: 'warn small' }, 'Lebih dari 3 menit: YouTube Shorts membatasi 3 menit. TikTok masih bisa.') : h('span'),
    fileBlock(),
    qualityBlock(d),
    rangeNow() ? h('label', { class: 'switch-row' },
      h('input', { type: 'checkbox', checked: exportRangeOnly, onchange: (e: Event) => { exportRangeOnly = (e.target as HTMLInputElement).checked; } }),
      h('span', {}, `Hanya bagian In–Out (${tc(rangeNow()!.outMs - rangeNow()!.inMs, true)})`)) : h('span'),
    markers().length ? h('button', { class: 'ghost small', onclick: () => void copyChapters() }, icon('copy', 14), ` Salin chapter YouTube (${markers().length} marker)`) : h('span'),
    h('div', { class: 'muted small' }, `Encoder: ${settings.encoder ? ENCODER_LABEL[settings.encoder] : 'mengecek…'}`),
    h('button', {
      class: 'ghost small path', title: settings.outDir,
      onclick: async () => {
        const dir = await dialog().open({ directory: true, title: 'Folder hasil ekspor' });
        if (typeof dir === 'string') { settings.outDir = dir; await saveSettings(settings); renderExport(); }
      },
    }, `📁 ${settings.outDir}`),
    h('button', {
      class: 'primary wide', disabled: !timelineDuration(tl()),
      onclick: async (e: Event) => {
        // take the button now: after an await the event no longer knows which element it came from
        const btn = e.currentTarget as HTMLButtonElement;
        pause();
        try {
          btn.disabled = true;
          await flush();
          const fontScale = await fontScales();
          await enqueueExport(P!, {
            outDir: settings.outDir, encoder: settings.encoder || (await detectEncoder()), fontScale, quality: settings.quality ?? 0.75, captionBreaks,
            range: exportRangeOnly ? rangeNow() : null,
            fileName: exportFileName(),
            container: exportFormat(),
            renderOverlay: (dir) => renderOverlayTrack(dir, (f) => { btn.textContent = `Menyiapkan teks… ${Math.round(f * 100)}%`; }),
            renderMasks: (dir) => renderMaskFiles(dir),
          }).then(() => { exportName = ''; const inp = document.querySelector('#export-pop .name-row input') as HTMLInputElement | null; if (inp) inp.value = ''; });
        } catch (e) { toast((e as Error).message, 'error'); } finally { btn.disabled = false; btn.textContent = 'Ekspor video'; }
      },
    }, 'Ekspor video'),
    h('div', { id: 'queue' }),
  );
  renderQueue();
}

let exportRangeOnly = true;

// ================= export: file name and format =================
type ExportFormat = 'mp4' | 'mkv' | 'mov' | 'webm';
const FORMATS: { id: ExportFormat; name: string; hint: string }[] = [
  { id: 'mp4', name: 'MP4', hint: 'H.264 + AAC. Paling aman untuk YouTube, TikTok, Instagram, HP' },
  { id: 'mkv', name: 'MKV', hint: 'H.264 + AAC dalam MKV. Bagus untuk arsip dan diedit ulang' },
  { id: 'mov', name: 'MOV', hint: 'H.264 + AAC dalam MOV. Untuk Premiere, Final Cut, iPhone' },
  { id: 'webm', name: 'WEBM', hint: 'VP9 + Opus. Untuk web dan Discord; ekspornya lebih lama (pakai CPU)' },
];
let exportName = '';   // typed in the export panel; empty = the project name
const exportFormat = (): ExportFormat => (settings.exportFormat as ExportFormat) || 'mp4';
/** The name typed for the file, else the project name (plus "(bagian)" for an In/Out export). */
function exportFileName(): string {
  const typed = exportName.replace(/\.(mp4|mkv|mov|webm)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (typed) return typed;
  const base = (P?.name ?? 'video').trim();
  return exportRangeOnly && rangeNow() ? `${base} (bagian)` : base;
}
function fileBlock(): HTMLElement {
  return h('div', { class: 'quality' },
    h('span', { class: 'label' }, 'Nama file'),
    h('div', { class: 'name-row' },
      h('input', {
        value: exportName, placeholder: P?.name ?? 'video', 'aria-label': 'Nama file',
        oninput: (e: Event) => { exportName = (e.target as HTMLInputElement).value; },
      }),
      h('span', { class: 'mono muted' }, `.${exportFormat()}`),
    ),
    h('span', { class: 'label' }, 'Format'),
    h('div', { class: 'seg' }, ...FORMATS.map((f) => h('button', {
      class: exportFormat() === f.id ? 'on' : '', title: f.hint,
      onclick: () => { settings.exportFormat = f.id; void saveSettings(settings); renderExport(); },
    }, f.name))),
    h('div', { class: 'muted small' }, FORMATS.find((f) => f.id === exportFormat())!.hint),
  );
}

const QUALITY_STOPS: [number, string][] = [[0.5, 'Hemat'], [0.75, 'Shorts'], [1, 'Maksimal']];
function qualityBlock(durMs: number): HTMLElement {
  const q = settings.quality ?? 0.75;
  const est = (qq: number) => {
    const kbps = qualityBitrate(tl().fps, qq, tl().width * tl().height) * 0.7 + 192;   // encoders land below the cap on most game footage
    return Math.max(1, Math.round((kbps * durMs) / 8 / 1000 / 1000));
  };
  const label = $('#q-label');
  void label;
  const wrap = h('div', { class: 'quality' },
    h('div', { class: 'row-between' },
      h('span', { class: 'label' }, 'Kualitas'),
      h('span', { class: 'q-value', id: 'q-value' }, `${Math.round(q * 100)}%`),
    ),
    h('input', {
      type: 'range', min: 40, max: 100, step: 5, value: Math.round(q * 100), 'aria-label': 'Kualitas ekspor',
      oninput: (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        settings.quality = v;
        $('#q-value')!.textContent = `${Math.round(v * 100)}%`;
        $('#q-est')!.textContent = `Perkiraan ukuran ±${est(v)} MB`;
        document.querySelectorAll('.q-stops button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.q) === v));
      },
      onchange: () => void saveSettings(settings),
    }),
    h('div', { class: 'q-stops' }, ...QUALITY_STOPS.map(([v, name]) => h('button', {
      class: `chip ${Math.abs(q - v) < 0.001 ? 'on' : ''}`, 'data-q': v,
      onclick: () => { settings.quality = v; void saveSettings(settings); renderExport(); },
    }, `${name} ${Math.round(v * 100)}%`))),
    h('div', { class: 'muted small', id: 'q-est' }, `Perkiraan ukuran ±${est(q)} MB`),
    h('div', { class: 'muted small' }, '70–80% sudah tajam di layar HP. 100% hanya kalau mau diedit ulang.'),
  );
  return wrap;
}

/** Size factors so exported text matches the preview; measured once per font on this PC and remembered. */
async function fontScales(): Promise<Record<string, number>> {
  const used = new Map<string, TextStyle>();
  if (tl().captions.lines.length) used.set(`${tl().captions.style.font}|${tl().captions.style.bold ? 1 : 0}`, tl().captions.style);
  for (const x of tl().texts) used.set(`${x.style.font}|${x.style.bold ? 1 : 0}`, x.style);
  const known = (settings.fontScale ??= {});
  const ctx = document.createElement('canvas').getContext('2d')!;
  for (const [key, st] of used) {
    if (known[key]) continue;
    setBusy('Menyesuaikan ukuran font…');
    ctx.font = fontOf({ ...st, size: 100 }, 1);
    const w = ctx.measureText('HHHHHHHHHH').width;
    try { known[key] = await calibrateFont(st.font, st.bold, w); } catch { known[key] = 1; }
  }
  setBusy('');
  await saveSettings(settings);
  return known;
}

function renderQueue() {
  const el = $('#queue');
  const btn = $('#export-btn');
  const run = queue.find((j) => j.status === 'running');
  if (btn) {
    const label = run ? `Ekspor ${Math.round(run.progress * 100)}%` : 'Ekspor';
    const span = btn.querySelector('span');
    if (span) span.textContent = label; else btn.replaceChildren(icon('export', 16), h('span', {}, label));
    btn.style.setProperty('--prog', run ? `${Math.round(run.progress * 100)}%` : '0%');
    btn.classList.toggle('running', !!run);
  }
  if (!el) return;
  const jobs = queue.filter((j) => j.status !== 'cancelled').slice(-6).reverse();
  el.replaceChildren(...jobs.map((j) => h('div', { class: `job ${j.status}` },
    h('div', { class: 'row-between' },
      h('span', { class: 'small' }, j.label),
      h('span', { class: 'muted small' }, j.status === 'queued' ? 'menunggu' : j.status === 'running' ? `${Math.round(j.progress * 100)}%` : j.status === 'done' ? 'selesai' : 'gagal'),
    ),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.round(j.progress * 100)}%` })),
    j.status === 'failed' ? h('div', { class: 'warn small' }, j.error) : null,
    h('div', { class: 'row-between' },
      j.status === 'done' ? h('button', { class: 'ghost small', onclick: () => void invoke('reveal', { path: j.outPath }) }, 'Buka folder') : h('span'),
      j.status === 'queued' || j.status === 'running' ? h('button', { class: 'ghost small', onclick: () => void cancelExport(j) }, 'Batal') : null,
    ),
  )));
  const done = queue.filter((j) => j.status === 'done' && !(j as { notified?: boolean }).notified);
  for (const j of done) { (j as { notified?: boolean }).notified = true; toast(`Selesai: ${j.outPath.split('\\').pop()}`); }
}




// ================= advanced transform: rotate, flip, anchor point, distort =================
let distortMode = false;
type TfTarget = { tf?: Tf; locked?: boolean };
function tfAdvancedBlock(obj: TfTarget): HTMLElement {
  const tf = obj.tf ?? {};
  const set = (fn: (t: Tf) => void) => { snapshot(); const n: Tf = { ...(obj.tf ?? {}) }; fn(n); obj.tf = tfActive(n) || n.anchor ? n : undefined; changed(); };
  const live = (fn: (t: Tf) => void) => (v: number) => { const n: Tf = { ...(obj.tf ?? {}) }; fn(n); void v; obj.tf = n; };
  const anc = tf.anchor ?? [0.5, 0.5];
  const pinsOn = !!tf.pins?.some(([a, b]) => a || b);
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Transform lanjutan'),
    tfSlider('Rotasi', tf.rot ?? 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => live((n) => { n.rot = Math.round(v) || undefined; })(v)),
    h('div', { class: 'quick-grid' },
      h('button', { class: 'chip with-ico', title: 'Putar 90° ke kiri', onclick: () => set((n) => { n.rot = (((n.rot ?? 0) - 90 + 540) % 360) - 180 || undefined; }) }, icon('rotate', 14), '−90°'),
      h('button', { class: 'chip with-ico', title: 'Putar 90° ke kanan', onclick: () => set((n) => { n.rot = (((n.rot ?? 0) + 90 + 540) % 360) - 180 || undefined; }) }, icon('rotate', 14), '+90°'),
      h('button', { class: `chip with-ico${tf.flipH ? ' on' : ''}`, title: 'Cermin kiri-kanan', onclick: () => set((n) => { n.flipH = !n.flipH || undefined; }) }, icon('flipH', 14), 'Flip H'),
      h('button', { class: `chip with-ico${tf.flipV ? ' on' : ''}`, title: 'Cermin atas-bawah', onclick: () => set((n) => { n.flipV = !n.flipV || undefined; }) }, icon('flipV', 14), 'Flip V'),
    ),
    h('div', { class: 'tf-row anchor-row' },
      h('span', { class: 'tf-label' }, 'Anchor'),
      h('div', { class: 'anchor-grid', role: 'group', 'aria-label': 'Titik putar' }, ...[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => h('button', {
        class: anc[0] === x && anc[1] === y ? 'on' : '', 'aria-label': `Anchor ${x},${y}`, title: 'Titik tumpu saat diputar',
        onclick: () => set((n) => { n.anchor = x === 0.5 && y === 0.5 ? undefined : [x, y]; }),
      })))),
      h('span', { class: 'muted small' }, 'Titik tumpu saat diputar'),
    ),
    h('div', { class: 'quick-grid' },
      h('button', {
        class: `chip${distortMode ? ' on' : ''}`, title: 'Tarik 4 sudut di preview untuk efek perspektif / distort',
        onclick: () => { distortMode = !distortMode; if (distortMode && !obj.tf?.pins) { const n: Tf = { ...(obj.tf ?? {}) }; n.pins = [[0, 0], [0, 0], [0, 0], [0, 0]]; obj.tf = n; } renderLeft(); renderFrame(); },
      }, distortMode ? 'Selesai distort' : 'Distort / perspektif'),
      pinsOn ? h('button', { class: 'chip', onclick: () => set((n) => { n.pins = null; }) }, 'Reset distort') : '',
      tfActive(tf) ? h('button', { class: 'chip', onclick: () => { snapshot(); obj.tf = undefined; distortMode = false; changed(); } }, 'Reset semua') : '',
    ),
  );
}

/** Homography from the unit square to a quad (tl, tr, br, bl). */
function quadMap(q: [number, number][]): (u: number, v: number) => [number, number] {
  const [p0, p1, p2, p3] = q;
  const sx = p0[0] - p1[0] + p2[0] - p3[0], sy = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0, hh = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
  }
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + hh * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + hh * p3[1], f = p0[1];
  return (u, v) => { const w = g * u + hh * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
}
/** Draws `img` (w x h) into a quad, in small triangles so it looks like true perspective. */
function drawQuad(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, q: [number, number][]) {
  const map = quadMap(q), N = 12;
  const tri = (s: [number, number][], d: [number, number][]) => {
    const [[x0, y0], [x1, y1], [x2, y2]] = s, [[u0, v0], [u1, v1], [u2, v2]] = d;
    const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(den) < 1e-9) return;
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den, c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
    const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den, dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
    const e = u0 - a * x0 - c * y0, f = v0 - b * x0 - dd * y0;
    // grow the clip a little so neighbouring triangles overlap and no seams show
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, gr = (p: [number, number]) => [p[0] + Math.sign(p[0] - cx) * 0.6, p[1] + Math.sign(p[1] - cy) * 0.6];
    ctx.save();
    ctx.beginPath(); const g0 = gr(d[0]), g1 = gr(d[1]), g2 = gr(d[2]); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, dd, e, f);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
    const s00: [number, number] = [u0 * w, v0 * h], s10: [number, number] = [u1 * w, v0 * h], s01: [number, number] = [u0 * w, v1 * h], s11: [number, number] = [u1 * w, v1 * h];
    const d00 = map(u0, v0), d10 = map(u1, v0), d01 = map(u0, v1), d11 = map(u1, v1);
    tri([s00, s10, s11], [d00, d10, d11]);
    tri([s00, s11, s01], [d00, d11, d01]);
  }
}
/** Corners of a box after its pins, relative to its centre, before rotation (tl, tr, br, bl). */
function pinnedCorners(tf: Tf | undefined, w: number, h: number): [number, number][] {
  const p = tf?.pins ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
  const base: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return base.map(([x, y], i) => [x + p[i][0] * w, y + p[i][1] * h]);
}
let tfOff: HTMLCanvasElement | null = null;
/** Paints something w x h centred at (cx, cy) with its transform (flip, distort, rotation around the anchor). */
function drawTf(ctx: CanvasRenderingContext2D, tf: Tf | undefined, cx: number, cy: number, w: number, h: number, paint: (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void) {
  if (!tfActive(tf)) { paint(ctx, cx - w / 2, cy - h / 2, w, h); return; }
  const [ax, ay] = anchoredCentre(cx, cy, w, h, tf);
  const pins = tf!.pins?.some(([a, b]) => a || b);
  ctx.save();
  ctx.translate(ax, ay);
  if (tf!.rot) ctx.rotate((tf!.rot * Math.PI) / 180);
  if (pins) {
    tfOff ??= document.createElement('canvas');
    const ow = Math.max(2, Math.round(w)), oh = Math.max(2, Math.round(h));
    if (tfOff.width !== ow || tfOff.height !== oh) { tfOff.width = ow; tfOff.height = oh; }
    const oc = tfOff.getContext('2d')!;
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, ow, oh);
    oc.globalAlpha = 1;
    if (tf!.flipH || tf!.flipV) { oc.translate(tf!.flipH ? ow : 0, tf!.flipV ? oh : 0); oc.scale(tf!.flipH ? -1 : 1, tf!.flipV ? -1 : 1); }
    paint(oc, 0, 0, ow, oh);
    drawQuad(ctx, tfOff, ow, oh, pinnedCorners(tf, w, h));
  } else {
    ctx.scale(tf!.flipH ? -1 : 1, tf!.flipV ? -1 : 1);
    paint(ctx, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}
/** Distort handles of the selected layer or picture in preview pixels (tl, tr, br, bl). */
function distortHandles(): { obj: TfTarget; pts: [number, number][]; w: number; h: number; cx: number; cy: number } | null {
  if (!distortMode || !P) return null;
  const W = preview.width, H = preview.height;
  const ly = selected('layer'), im = selected('image');
  let obj: TfTarget | null = null, cx = 0, cy = 0, w = 0, h = 0;
  if (ly && ly.source !== 'adjust') { obj = ly; w = ly.box.w * W; h = ly.box.h * H; cx = ly.box.x * W; cy = ly.box.y * H; }
  else if (im) { obj = im; w = im.scale * W; h = w / im.aspect; cx = im.x * W; cy = im.y * H; }
  if (!obj) return null;
  const tf = obj.tf;
  const [ax, ay] = anchoredCentre(cx, cy, w, h, tf);
  const r = ((tf?.rot ?? 0) * Math.PI) / 180;
  const pts = pinnedCorners(tf, w, h).map(([x, y]) => [ax + x * Math.cos(r) - y * Math.sin(r), ay + x * Math.sin(r) + y * Math.cos(r)] as [number, number]);
  return { obj, pts, w, h, cx: ax, cy: ay };
}
function drawDistortHandles(ctx: CanvasRenderingContext2D) {
  const d = distortHandles();
  if (!d) return;
  ctx.save();
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); d.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of d.pts) { ctx.fillStyle = '#ffd400'; ctx.strokeStyle = '#121212'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}
/** Starts dragging a distort corner; returns the drag or null. */
function distortPointerDown(p: { x: number; y: number }): ((q: { x: number; y: number }) => void) | null {
  const d = distortHandles();
  if (!d || d.obj.locked) return null;
  const i = d.pts.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < 14);
  if (i < 0) return null;
  snapshot();
  const r = -((d.obj.tf?.rot ?? 0) * Math.PI) / 180;
  const base: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  return (q) => {
    const dx = q.x - d.cx, dy = q.y - d.cy;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    const tf: Tf = { ...(d.obj.tf ?? {}) };
    const pins = (tf.pins ?? [[0, 0], [0, 0], [0, 0], [0, 0]]).map((x) => [...x] as [number, number]);
    pins[i] = [Number((lx / d.w - base[i][0]).toFixed(4)), Number((ly / d.h - base[i][1]).toFixed(4))];
    tf.pins = pins;
    d.obj.tf = tf;
    renderFrame();
  };
}


// ================= masks & green screen =================
/** Paints a mask. Export: grey picture (white = visible). Preview: opaque where visible, for destination-in. */
function paintMask(c: CanvasRenderingContext2D, w: number, h: number, m: Mask, forExport: boolean) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  if (forExport) { c.fillStyle = m.invert ? '#fff' : '#000'; c.fillRect(0, 0, w, h); }
  else if (m.invert) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-out'; }
  const fe = m.feather * Math.min(w, h);
  c.filter = fe > 0.5 ? `blur(${(fe / 2).toFixed(1)}px)` : 'none';
  c.fillStyle = forExport && m.invert ? '#000' : '#fff';
  const cx = m.x * w, cy = m.y * h, mw = m.w * w, mh = m.h * h;
  c.beginPath();
  if (m.shape === 'ellipse') c.ellipse(cx, cy, Math.max(0.5, mw / 2), Math.max(0.5, mh / 2), 0, 0, Math.PI * 2);
  else c.rect(cx - mw / 2, cy - mh / 2, mw, mh);
  c.fill();
  c.restore();
}
/** Same wipe as the export's geq: `p` is 0..1 progress. Applied with destination-in. */
function paintReveal(c: CanvasRenderingContext2D, w: number, h: number, dir: NonNullable<Mask['reveal']>['dir'], p: number) {
  if (p >= 1) return;
  c.save();
  c.globalCompositeOperation = 'destination-in';
  let g: CanvasGradient;
  if (dir === 'center') {
    const R = Math.hypot(w / 2, h / 2);
    g = c.createRadialGradient(w / 2, h / 2, Math.max(0, p * 1.15 * R - 0.15 * R), w / 2, h / 2, Math.max(0.01, p * 1.15 * R));
  } else {
    const S = dir === 'left' || dir === 'right' ? w : h;
    const a = p * 1.15 * S - 0.15 * S, b = p * 1.15 * S;
    const at = (v: number) => (dir === 'right' ? w - v : dir === 'up' ? h - v : v);
    g = dir === 'left' || dir === 'right' ? c.createLinearGradient(at(a), 0, at(b), 0) : c.createLinearGradient(0, at(a), 0, at(b));
  }
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();
}
/** ffmpeg colorkey on canvas pixels. */
function applyKey(c: CanvasRenderingContext2D, w: number, h: number, k: ChromaKey) {
  let img: ImageData;
  try { img = c.getImageData(0, 0, w, h); } catch { return; }
  const d = img.data, kr = parseInt(k.color.slice(1, 3), 16), kg = parseInt(k.color.slice(3, 5), 16), kb = parseInt(k.color.slice(5, 7), 16);
  const sim = Math.max(0.01, k.similarity), bl = k.blend, norm = 1 / (3 * 255 * 255);
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb;
    const diff = Math.sqrt((dr * dr + dg * dg + db * db) * norm);
    if (diff < sim) d[i + 3] = 0;
    else if (bl > 0) d[i + 3] = Math.round(d[i + 3] * Math.min(1, (diff - sim) / bl));
  }
  c.putImageData(img, 0, 0);
}
let keyBypass = false;
const fxCanvases: HTMLCanvasElement[] = [];
/** Paints a picture w x h with its green screen, mask and wipe applied, into a reusable canvas. */
function withMaskKey(w: number, h: number, item: { mask?: Mask | null; key?: ChromaKey | null; startMs: number }, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const W2 = Math.max(2, Math.round(w)), H2 = Math.max(2, Math.round(h));
  const [cv, mk] = [0, 1].map((i) => { fxCanvases[i] ??= document.createElement('canvas'); const x = fxCanvases[i]; if (x.width !== W2 || x.height !== H2) { x.width = W2; x.height = H2; } return x; });
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.clearRect(0, 0, W2, H2);
  paint(c);
  if (item.key && !keyBypass) applyKey(c, W2, H2, item.key);
  if (item.mask && maskActive(item.mask)) {
    const mc = mk.getContext('2d')!;
    paintMask(mc, W2, H2, item.mask, false);
    c.save(); c.globalCompositeOperation = 'destination-in'; c.drawImage(mk, 0, 0); c.restore();
    if (item.mask.reveal) paintReveal(c, W2, H2, item.mask.reveal.dir, clamp((t - item.startMs) / Math.max(50, item.mask.reveal.ms), 0, 1));
  }
  return cv;
}
const needsFx = (it: { mask?: Mask | null; key?: ChromaKey | null }) => !!it.key || maskActive(it.mask);

/** Mask pictures for the export, one per masked layer or picture, at its size in the video. */
async function renderMaskFiles(dir: string): Promise<Record<string, string>> {
  const T = tl(), W = T.width, H = T.height, out: Record<string, string> = {};
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const jobs: { id: string; w: number; h: number; m: Mask }[] = [];
  for (const l of layers()) if (l.source !== 'adjust' && !l.hidden && l.mask && maskActive(l.mask)) jobs.push({ id: l.id, w: even(l.box.w * W), h: even(l.box.h * H), m: l.mask });
  for (const im of images()) if (!im.hidden && im.mask && maskActive(im.mask)) { const w = even(W * im.scale); jobs.push({ id: im.id, w, h: even(w / im.aspect), m: im.mask }); }
  if (!jobs.length) return out;
  await invoke('ensure_dir', { path: dir });
  const cv = document.createElement('canvas');
  for (const j of jobs) {
    cv.width = j.w; cv.height = j.h;
    paintMask(cv.getContext('2d')!, j.w, j.h, j.m, true);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    if (!blob) continue;
    const file = join(dir, `mask-${j.id.slice(0, 8)}.png`);
    await invoke('write_bytes', { path: file, content: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    out[j.id] = file;
  }
  return out;
}

let pickingKey: ChromaKey | null = null;
const MASK0: Mask = { shape: 'ellipse', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0.2 };
function maskBlock(obj: { mask?: Mask | null; key?: ChromaKey | null }): HTMLElement {
  const m = obj.mask;
  const set = (fn: () => void) => { snapshot(); fn(); changed(); };
  const mset = (p: Partial<Mask>) => set(() => { obj.mask = { ...(obj.mask ?? MASK0), ...p }; });
  const live = (p: (v: number) => Partial<Mask>) => (v: number) => { obj.mask = { ...(obj.mask ?? MASK0), ...p(v) }; };
  const k = obj.key;
  const kset = (p: Partial<ChromaKey>) => set(() => { obj.key = { ...(obj.key ?? { color: '#00ff00', similarity: 0.3, blend: 0.1 }), ...p }; });
  return h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Mask'),
    h('div', { class: 'seg' },
      h('button', { class: !m ? 'on' : '', onclick: () => set(() => { obj.mask = null; }) }, 'Tanpa'),
      h('button', { class: m?.shape === 'rect' ? 'on' : '', onclick: () => mset({ shape: 'rect', ...(m ? {} : { w: 0.8, h: 0.8, feather: 0.05 }) }) }, 'Kotak'),
      h('button', { class: m?.shape === 'ellipse' ? 'on' : '', onclick: () => mset({ shape: 'ellipse' }) }, 'Elips'),
    ),
    m ? h('div', { class: 'stack' },
      h('div', { class: 'quick-grid' },
        h('button', { class: 'chip', title: 'Tepi memudar lembut', onclick: () => mset({ shape: 'ellipse', x: 0.5, y: 0.5, w: 1.05, h: 1.05, feather: 0.35, invert: false }) }, 'Vignette'),
        h('button', { class: 'chip', onclick: () => mset({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.8, h: 0.8, feather: 0.02, invert: false }) }, 'Lingkaran'),
        h('button', { class: 'chip', title: 'Tepi kotak memudar', onclick: () => mset({ shape: 'rect', x: 0.5, y: 0.5, w: 0.9, h: 0.9, feather: 0.12, invert: false }) }, 'Fade tepi'),
      ),
      tfSlider('X', m.x * 100, 0, 100, 0.5, pct, live((v) => ({ x: v / 100 }))),
      tfSlider('Y', m.y * 100, 0, 100, 0.5, pct, live((v) => ({ y: v / 100 }))),
      tfSlider('Lebar', m.w * 100, 5, 150, 1, pct, live((v) => ({ w: v / 100 }))),
      tfSlider('Tinggi', m.h * 100, 5, 150, 1, pct, live((v) => ({ h: v / 100 }))),
      tfSlider('Feather', m.feather * 100, 0, 50, 1, (v) => `${Math.round(v)}`, live((v) => ({ feather: v / 100 }))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!m.invert, onchange: (e) => mset({ invert: (e.target as HTMLInputElement).checked || undefined }) }), 'Balik (sembunyikan bagian dalam)'),
      h('div', { class: 'label' }, 'Muncul bertahap'),
      h('div', { class: 'seg' }, ...([['', 'Tanpa'], ['left', '→'], ['right', '←'], ['down', '↓'], ['up', '↑'], ['center', '◎']] as const).map(([d, n]) => h('button', {
        class: (m.reveal?.dir ?? '') === d ? 'on' : '', title: d ? `Muncul dari ${({ left: 'kiri', right: 'kanan', down: 'atas', up: 'bawah', center: 'tengah' } as const)[d]}` : 'Langsung tampil',
        onclick: () => mset({ reveal: d ? { dir: d, ms: m.reveal?.ms ?? 700 } : null }),
      }, n))),
      m.reveal ? tfSlider('Durasi', m.reveal.ms / 1000, 0.1, 3, 0.1, (v) => `${v.toFixed(1)} dtk`, live((v) => ({ reveal: { ...m.reveal!, ms: Math.round(v * 1000) } }))) : '',
    ) : h('div', { class: 'muted small' }, 'Bentuk kotak/elips dengan tepi lembut: buat vignette, potong bentuk, atau munculkan bertahap.'),
    h('div', { class: 'label', style: 'margin-top:6px' }, 'Green screen'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!k, onchange: (e) => set(() => { obj.key = (e.target as HTMLInputElement).checked ? { color: '#00ff00', similarity: 0.3, blend: 0.1 } : null; }) }), 'Hapus warna latar (chroma key)'),
    k ? h('div', { class: 'stack' },
      h('div', { class: 'quick-grid' },
        h('button', { class: `chip${k.color.toLowerCase() === '#00ff00' ? ' on' : ''}`, onclick: () => kset({ color: '#00ff00' }) }, 'Hijau'),
        h('button', { class: `chip${k.color.toLowerCase() === '#0047bb' ? ' on' : ''}`, onclick: () => kset({ color: '#0047bb' }) }, 'Biru'),
        h('input', { type: 'color', value: k.color, 'aria-label': 'Warna latar', onchange: (e) => kset({ color: (e.target as HTMLInputElement).value }) }),
        h('button', { class: 'chip', title: 'Lalu klik warna latar di preview', onclick: () => { pickingKey = k; preview.style.cursor = 'crosshair'; toast('Klik warna latar di preview.'); } }, 'Ambil dari preview'),
      ),
      tfSlider('Kemiripan', k.similarity * 100, 1, 100, 1, (v) => `${Math.round(v)}`, (v) => { k.similarity = v / 100; }),
      tfSlider('Halus', k.blend * 100, 0, 100, 1, (v) => `${Math.round(v)}`, (v) => { k.blend = v / 100; }),
    ) : '',
  );
}


// ================= AI assistant (local model) =================
let aiModel: AiModelId = 'super';
let aiState: { engine: boolean; ready: Record<AiModelId, boolean> } | null = null;
let aiBusy = '';
let aiDl: { id: AiModelId; frac: number } | null = null;
let moments: Moment[] | null = null;
let momentLen = 30000, momentCount = 6;
let titleOut: { judul: string[]; deskripsi: string; hashtag: string[] } | null = null;
let fixes: { id: string; before: string; after: string; on: boolean }[] | null = null;

async function refreshAi() {
  const [engine, c, a, b] = await Promise.all([aiEngineReady(), aiModelReady('super'), aiModelReady('pintar'), aiModelReady('cepat')]);
  aiState = { engine, ready: { super: c, pintar: a, cepat: b } };
  if (!aiState.ready[aiModel]) aiModel = (['super', 'pintar', 'cepat'] as AiModelId[]).find((k) => aiState!.ready[k]) ?? 'super';
  if (tab === 'ai') renderLeft();
}
const aiReady = () => !!aiState?.engine && !!aiState.ready[aiModel];
async function runAi<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (aiBusy) { toast('AI masih bekerja. Tunggu atau batalkan dulu.'); return null; }
  aiBusy = label; setBusy(label); renderLeft();
  try { return await fn(); } catch (e) {
    const m = (e as Error).message ?? String(e);
    if (m !== 'Dibatalkan.') toast(`AI gagal: ${m.split('\n')[0]}`, 'error');
    return null;
  } finally { aiBusy = ''; setBusy(''); renderLeft(); }
}

/** Peaks of a media file's audio (one byte per 100 ms), waiting for them if needed. */
async function waveAsync(path: string): Promise<Uint8Array | null> {
  const have = waves.get(path);
  if (have) return have;
  try {
    const pk = await invoke<number[]>('waveform', { path, track: 0, job: `wave-${uid()}` });
    const arr = Uint8Array.from(pk);
    waves.set(path, arr);
    return arr;
  } catch { return null; }
}
async function findHighlights() {
  if (!P) return;
  const T = tl();
  const total = timelineDuration(T);
  if (!T.clips.length) { toast('Tambahkan video dulu.'); return; }
  setBusy('Mendengarkan suara video…');
  const wv = new Map<string, Uint8Array | null>();
  for (const c of T.clips) { const m = mediaOf(c.mediaId); if (m?.hasAudio && !wv.has(m.id)) wv.set(m.id, await waveAsync(m.playable)); }
  setBusy('');
  const loudAt = (ms: number) => {
    const loc = locate(T.clips, ms);
    if (!loc) return 0;
    const pk = wv.get(T.clips[loc.index].mediaId);
    return pk ? (pk[Math.floor(loc.sourceMs / 100)] ?? 0) / 255 : 0;
  };
  const words = T.captions.lines.flatMap((l) => l.words.map((w) => ({ text: w.text, startMs: w.startMs })));
  const lines = T.captions.lines.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.words.map((w) => w.text).join(' ') }));
  const found = findMoments(total, loudAt, words, lines, momentLen, momentCount + 3);
  if (!found.length) { toast('Tidak ada momen yang menonjol.'); return; }
  moments = found.slice(0, momentCount);
  renderLeft();
  if (!aiReady()) { toast(`${moments.length} momen ditemukan dari suara${words.length ? ' dan subtitle' : ''}. Pasang model AI untuk judul & penilaian.`); return; }
  if (!words.length) { toast('Momen ditemukan dari suara. Buat subtitle dulu supaya AI bisa menilai isinya.'); return; }
  const cand = found;
  const res = await runAi('AI menilai momen…', () => aiJson<{ items: { id: number; nilai: number; judul: string; alasan: string }[] }>(aiModel,
    'Kamu editor video gaming YouTube Indonesia yang jago memilih momen paling seru, lucu, atau menegangkan dari siaran live untuk dijadikan Shorts/TikTok. Jawab dalam bahasa Indonesia santai.',
    `Ini potongan kandidat dari satu siaran. Untuk tiap potongan beri nilai 1-10 (seberapa layak jadi Shorts), judul pendek yang bikin penasaran (maks 60 karakter, tanpa tanda kutip), dan alasan singkat (maks 12 kata).\n\n${cand.map((m, i) => `#${i} [${tc(m.startMs)}–${tc(m.endMs)}] suara keras: ${m.loud > 0.8 ? 'tinggi' : m.loud > 0.2 ? 'sedang' : 'rendah'}${m.hits.length ? `, kata seru: ${m.hits.slice(0, 5).join(', ')}` : ''}\n"${m.text.slice(0, 450) || '(tanpa subtitle)'}"`).join('\n\n')}`,
    { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, nilai: { type: 'integer', minimum: 1, maximum: 10 }, judul: { type: 'string' }, alasan: { type: 'string' } }, required: ['id', 'nilai', 'judul', 'alasan'] } } }, required: ['items'] },
    120 + cand.length * 70));
  if (!res) return;
  for (const it of res.items ?? []) {
    const m = cand[it.id];
    if (!m) continue;
    m.ai = clamp(it.nilai, 1, 10); m.title = it.judul?.trim().slice(0, 80); m.reason = it.alasan?.trim().slice(0, 120);
    m.score = Math.round((m.score * 0.45 + m.ai * 0.55) * 10) / 10;
  }
  moments = [...cand].sort((a, b) => b.score - a.score).slice(0, momentCount).sort((a, b) => a.startMs - b.startMs);
  toast('AI selesai menilai. Momen terbaik ditandai bintang.');
  renderLeft();
}

function transcriptText(maxChars = 7000): string {
  const r = rangeNow();
  const lines = tl().captions.lines.filter((l) => !r || (l.endMs > r.inMs && l.startMs < r.outMs)).map((l) => l.words.map((w) => w.text).join(' '));
  const all = lines.join('\n');
  if (all.length <= maxChars) return all;
  // spread the sample over the whole video
  const keep = Math.max(1, Math.floor(lines.length * (maxChars / all.length)));
  const stepN = lines.length / keep;
  return Array.from({ length: keep }, (_, i) => lines[Math.floor(i * stepN)]).join('\n');
}
async function makeTitles() {
  const text = transcriptText();
  if (!text.trim()) { toast('Buat subtitle dulu: AI membaca isi video dari subtitle.'); return; }
  const res = await runAi('AI membuat judul…', () => aiJson<{ judul: string[]; deskripsi: string; hashtag: string[] }>(aiModel,
    'Kamu ahli judul YouTube dan TikTok gaming Indonesia. Judul harus bikin penasaran, jujur sesuai isi, pakai bahasa Indonesia santai, boleh 1 emoji. Jangan pakai tanda kutip.',
    `Isi video (dari subtitle):\n${text}\n\nBuat 5 judul berbeda (maks 70 karakter), 1 deskripsi 2-3 kalimat, dan 8 hashtag relevan (dengan #).`,
    { type: 'object', properties: { judul: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 }, deskripsi: { type: 'string' }, hashtag: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 10 } }, required: ['judul', 'deskripsi', 'hashtag'] },
    600));
  if (!res) return;
  titleOut = { judul: (res.judul ?? []).map((x) => x.trim()).filter(Boolean), deskripsi: (res.deskripsi ?? '').trim(), hashtag: (res.hashtag ?? []).map((x) => (x.startsWith('#') ? x : `#${x}`).replace(/\s+/g, '')) };
  renderLeft();
}
async function fixSubtitles() {
  const lines = tl().captions.lines;
  if (!lines.length) { toast('Belum ada subtitle.'); return; }
  const out: { id: string; before: string; after: string; on: boolean }[] = [];
  const B = 24;
  const res = await runAi('AI mengoreksi subtitle…', async () => {
    for (let i = 0; i < lines.length; i += B) {
      const part = lines.slice(i, i + B);
      setBusy(`AI mengoreksi subtitle… ${Math.round((i / lines.length) * 100)}%`);
      const r = await aiJson<{ baris: { id: number; teks: string }[] }>(aiModel,
        'Kamu korektor subtitle bahasa Indonesia untuk video gaming. Subtitle dibuat otomatis dari suara, jadi ada kata salah dengar dan salah ketik. Perbaiki hanya kesalahan itu. Jangan ubah gaya bahasa gaul atau slang, jangan terjemahkan, jangan tambah atau buang kalimat.',
        `Perbaiki tiap baris. Kalau sudah benar, kembalikan sama persis.\n\n${part.map((l, j) => `${j}: ${l.words.map((w) => w.text).join(' ')}`).join('\n')}`,
        { type: 'object', properties: { baris: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, teks: { type: 'string' } }, required: ['id', 'teks'] } } }, required: ['baris'] },
        60 + part.length * 40);
      for (const b of r.baris ?? []) {
        const l = part[b.id];
        if (!l) continue;
        const before = l.words.map((w) => w.text).join(' ');
        const after = (b.teks ?? '').replace(/\s+/g, ' ').trim();
        const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
        if (after && norm(after) !== norm(before) && after.length < before.length * 2 + 10) out.push({ id: l.id, before, after, on: true });
      }
    }
    return true;
  });
  if (!res) return;
  fixes = out;
  if (!out.length) toast('Subtitle sudah rapi, tidak ada yang perlu dikoreksi.');
  renderLeft();
}
function applyFixes() {
  if (!fixes) return;
  snapshot();
  let n = 0;
  for (const f of fixes) {
    if (!f.on) continue;
    const l = tl().captions.lines.find((x) => x.id === f.id);
    if (!l) continue;
    const words = f.after.split(' ').filter(Boolean);
    if (words.length === l.words.length) words.forEach((w, i) => { l.words[i].text = w; });
    else {
      // new word count: share the line's time by word length, keep the styling of the words by position
      const total = words.reduce((a, w) => a + w.length, 0) || 1;
      let t0 = l.startMs;
      l.words = words.map((w, i) => {
        const d = ((l.endMs - l.startMs) * w.length) / total;
        const old = l.words[Math.min(i, l.words.length - 1)];
        const nw: Word = { text: w, startMs: Math.round(t0), endMs: Math.round(t0 + d), ...(old?.fx ? { fx: old.fx } : {}), ...(old?.color ? { color: old.color } : {}) };
        t0 += d;
        return nw;
      });
    }
    n++;
  }
  fixes = null;
  changed({ left: true });
  toast(`${n} baris subtitle dikoreksi. Ctrl+Z untuk membatalkan.`);
}

function copyText(text: string, what = 'Teks') {
  void navigator.clipboard.writeText(text).then(() => toast(`${what} disalin.`), () => void askText(window.innerWidth / 2 - 160, 140, 'Salin (Ctrl+C)', text));
}

function aiPanel(): Node[] {
  if (!aiState) { void refreshAi(); return [h('div', { class: 'muted small' }, h('span', { class: 'spinner' }), ' Mengecek AI…')]; }
  const st = aiState;
  const model = h('div', { class: 'block' },
    h('div', { class: 'row-between' }, h('div', { class: 'label' }, 'Model AI (di PC kamu, offline)'), st.engine ? '' : h('span', { class: 'warn small' }, 'Mesin AI belum ada')),
    h('div', { class: 'ai-models' }, ...(Object.keys(AI_MODELS) as AiModelId[]).map((id) => {
      const m = AI_MODELS[id], ready = st.ready[id], dl = aiDl?.id === id;
      return h('div', { class: `ai-model${aiModel === id ? ' on' : ''}`, onclick: () => { if (ready) { aiModel = id; renderLeft(); } } },
        h('div', { class: 'ai-model-name' }, m.name, ready ? h('span', { class: 'adv-dot', title: 'Sudah terpasang' }) : ''),
        h('div', { class: 'muted small' }, m.hint),
        ready ? h('span', { class: 'muted small' }, aiModel === id ? 'Dipakai' : 'Klik untuk pakai')
          : dl ? h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.round((aiDl!.frac) * 100)}%` }))
            : h('button', {
              class: 'secondary small', disabled: !!aiDl, onclick: async (e: Event) => {
                e.stopPropagation();
                aiDl = { id, frac: 0 }; renderLeft();
                try {
                  await downloadAiModel(id, (f) => { if (aiDl) { aiDl.frac = f; const bar = document.querySelector('.ai-model .bar-fill') as HTMLElement | null; if (bar) bar.style.width = `${Math.round(f * 100)}%`; } });
                  aiModel = id; toast(`Model ${m.name} siap.`);
                } catch (err) { toast(`Unduhan gagal: ${(err as Error).message.split('\n')[0]}`, 'error'); }
                aiDl = null; await refreshAi();
              },
            }, 'Unduh'),
      );
    })),
    h('div', { class: 'muted small' }, 'Diunduh sekali, lalu jalan tanpa internet di kartu grafis (kalau ada). Semua diproses di PC, rekaman tidak dikirim ke mana pun.'),
  );
  const busy = aiBusy ? h('div', { class: 'ai-busy' }, h('span', { class: 'spinner' }), h('span', {}, aiBusy), h('button', { class: 'ghost small', onclick: () => void cancelAi() }, 'Batal')) : '';
  const hasSubs = tl().captions.lines.length > 0;

  const momentsBlock = h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Cari momen seru (AI Clip Assistant)'),
    h('div', { class: 'muted small' }, `Mendengarkan teriakan/tawa, membaca kata seru di subtitle${aiReady() ? ', lalu AI menilai dan memberi judul' : ''}. Cocok untuk VOD panjang.`),
    h('div', { class: 'row2' },
      field('Panjang klip', h('select', { onchange: (e) => { momentLen = Number((e.target as HTMLSelectElement).value); } }, ...[15000, 30000, 45000, 60000].map((v) => h('option', { value: v, selected: v === momentLen }, `${v / 1000} detik`)))),
      field('Jumlah', h('select', { onchange: (e) => { momentCount = Number((e.target as HTMLSelectElement).value); } }, ...[3, 5, 6, 8, 10].map((v) => h('option', { value: v, selected: v === momentCount }, `${v} momen`)))),
    ),
    h('button', { class: 'primary wide with-ico', disabled: !!aiBusy, onclick: () => void findHighlights() }, icon('sparkle', 15), 'Cari momen'),
    moments?.length ? h('div', { class: 'moments' }, ...moments.map((m) => {
      const best = moments!.length > 2 && m.score >= Math.max(...moments!.map((x) => x.score)) - 0.01;
      return h('div', { class: 'moment' },
        h('div', { class: 'row-between' },
          h('button', { class: 'moment-time mono', title: 'Lihat', onclick: () => { seek(m.startMs); play(); } }, `${tc(m.startMs)} – ${tc(m.endMs)}`),
          h('span', { class: `moment-score${best ? ' best' : ''}`, title: m.ai ? `Nilai AI ${m.ai}/10` : 'Dari suara & subtitle' }, `${best ? '★ ' : ''}${m.score.toFixed(1)}`),
        ),
        m.title ? h('div', { class: 'moment-title' }, m.title) : '',
        m.reason ? h('div', { class: 'muted small' }, m.reason) : m.hits.length ? h('div', { class: 'muted small' }, `Kata seru: ${m.hits.slice(0, 4).join(', ')}`) : '',
        h('div', { class: 'quick-grid' },
          h('button', { class: 'chip', title: 'Set In/Out ke momen ini (lalu Ekspor bagian ini)', onclick: () => { snapshot(); tl().range = { inMs: m.startMs, outMs: m.endMs }; exportRangeOnly = true; changed(); seek(m.startMs); toast('In/Out dipasang. Buka Ekspor untuk mengekspor bagian ini saja.'); } }, 'Jadikan In/Out'),
          h('button', { class: 'chip', onclick: () => { snapshot(); markers().push({ id: uid(), ms: m.startMs, label: m.title?.slice(0, 40) || `Momen ${tc(m.startMs)}`, color: '#ffb020' }); markers().sort((a, b) => a.ms - b.ms); changed(); } }, '+ Marker'),
          m.title ? h('button', { class: 'chip', onclick: () => copyText(m.title!, 'Judul') }, 'Salin judul') : '',
        ),
      );
    })) : '',
  );

  const titleBlock = h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Judul, deskripsi & hashtag'),
    h('div', { class: 'muted small' }, hasSubs ? `AI membaca subtitle${rangeNow() ? ' di bagian In/Out' : ''} lalu membuat 5 pilihan judul.` : 'Butuh subtitle dulu (tab Subtitle → Buat subtitle).'),
    h('button', { class: 'secondary wide with-ico', disabled: !aiReady() || !hasSubs || !!aiBusy, onclick: () => void makeTitles() }, icon('sparkle', 15), 'Buat judul'),
    titleOut ? h('div', { class: 'stack' },
      ...titleOut.judul.map((j) => h('div', { class: 'ai-out' }, h('span', {}, j),
        h('button', { class: 'lp-btn', title: 'Salin', 'aria-label': 'Salin judul', onclick: () => copyText(j, 'Judul') }, icon('copy', 14)),
        h('button', { class: 'lp-btn', title: 'Jadikan nama proyek', 'aria-label': 'Jadikan nama proyek', onclick: () => { if (P) { P.name = j.slice(0, 80); void saveProject(P); const ti = document.querySelector('.title-input') as HTMLInputElement | null; if (ti) ti.value = P.name; toast('Nama proyek diganti.'); } } }, icon('text', 14)),
      )),
      titleOut.deskripsi ? h('div', { class: 'ai-out' }, h('span', {}, titleOut.deskripsi), h('button', { class: 'lp-btn', 'aria-label': 'Salin deskripsi', onclick: () => copyText(`${titleOut!.deskripsi}\n\n${titleOut!.hashtag.join(' ')}`, 'Deskripsi') }, icon('copy', 14))) : '',
      titleOut.hashtag.length ? h('div', { class: 'ai-out' }, h('span', { class: 'mono small' }, titleOut.hashtag.join(' ')), h('button', { class: 'lp-btn', 'aria-label': 'Salin hashtag', onclick: () => copyText(titleOut!.hashtag.join(' '), 'Hashtag') }, icon('copy', 14))) : '',
      markers().length ? h('button', { class: 'ghost small', onclick: () => void copyChapters() }, 'Salin juga chapter dari marker') : '',
    ) : '',
  );

  const fixBlock = h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Koreksi subtitle'),
    h('div', { class: 'muted small' }, 'AI membetulkan kata yang salah dengar atau salah ketik. Kamu pilih mana yang dipakai.'),
    h('button', { class: 'secondary wide with-ico', disabled: !aiReady() || !hasSubs || !!aiBusy, onclick: () => void fixSubtitles() }, icon('sparkle', 15), 'Koreksi subtitle'),
    fixes?.length ? h('div', { class: 'stack' },
      h('div', { class: 'fix-list' }, ...fixes.map((f) => h('label', { class: 'fix' },
        h('input', { type: 'checkbox', checked: f.on, onchange: (e) => { f.on = (e.target as HTMLInputElement).checked; } }),
        h('span', {}, h('s', { class: 'muted' }, f.before), h('br'), f.after)))),
      h('button', { class: 'primary wide', onclick: applyFixes }, `Terapkan ${fixes.filter((f) => f.on).length} koreksi`),
    ) : '',
  );

  const thumbBlock = h('div', { class: 'block' },
    h('div', { class: 'label' }, 'Thumbnail'),
    h('div', { class: 'muted small' }, 'Memilih frame paling tajam & berwarna, lalu kamu tambah judul besar. Simpan sebagai PNG.'),
    h('button', { class: 'secondary wide with-ico', disabled: !tl().clips.length, onclick: () => void openThumbStudio() }, icon('image', 15), 'Buat thumbnail'),
  );

  return [
    st.engine ? h('span') : h('div', { class: 'warn small' }, 'Mesin AI tidak ditemukan. Install ulang versi terbaru Gals Clip Studio.'),
    model, busy || h('span'), momentsBlock, titleBlock, fixBlock, thumbBlock,
  ];
}

// ---------- thumbnail studio ----------
type ThumbStyle = { id: string; name: string; fill: string | [string, string]; stroke: string; box?: string };
const THUMB_STYLES: ThumbStyle[] = [
  { id: 'kuning', name: 'Kuning gaming', fill: '#ffd400', stroke: '#000' },
  { id: 'putih', name: 'Putih tebal', fill: '#ffffff', stroke: '#000' },
  { id: 'api', name: 'Gradasi api', fill: ['#fff15a', '#ff4d00'], stroke: '#2a0700' },
  { id: 'kotak', name: 'Kotak merah', fill: '#ffffff', stroke: 'transparent', box: '#e3242b' },
];
async function grabFrames(times: number[], maxW = 1280): Promise<{ t: number; cv: HTMLCanvasElement; score: number }[]> {
  const out: { t: number; cv: HTMLCanvasElement; score: number }[] = [];
  const vids = new Map<string, HTMLVideoElement>();
  const small = document.createElement('canvas'); small.width = 160; small.height = 90;
  const sc = small.getContext('2d', { willReadFrequently: true })!;
  for (const t0 of times) {
    const loc = locate(tl().clips, t0);
    if (!loc) continue;
    const c = tl().clips[loc.index], m = mediaOf(c.mediaId);
    if (!m) continue;
    let v = vids.get(m.id);
    if (!v) {
      v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = fileSrc(m.playable);
      await new Promise<void>((res) => { v!.onloadeddata = () => res(); v!.onerror = () => res(); setTimeout(res, 8000); });
      vids.set(m.id, v);
    }
    await new Promise<void>((res) => { const done = () => { v!.removeEventListener('seeked', done); res(); }; v!.addEventListener('seeked', done); v!.currentTime = loc.sourceMs / 1000; setTimeout(done, 4000); });
    if (!v.videoWidth) continue;
    const k = Math.min(1, maxW / v.videoWidth);
    const cv = document.createElement('canvas'); cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height);
    small.height = Math.max(2, Math.round((160 * cv.height) / cv.width));
    sc.drawImage(cv, 0, 0, small.width, small.height);
    out.push({ t: t0, cv, score: frameScore(sc, small.width, small.height) });
  }
  vids.forEach((v) => { v.removeAttribute('src'); v.load(); });
  return out;
}
async function openThumbStudio() {
  if (!P) return;
  const total = timelineDuration(tl());
  // candidate times: the found moments (a bit into each), plus evenly over the video
  const times = new Set<number>();
  for (const m of moments ?? []) { times.add(Math.round(m.startMs + (m.endMs - m.startMs) * 0.3)); times.add(Math.round(m.startMs + (m.endMs - m.startMs) * 0.65)); }
  for (let i = 1; i <= 12; i++) times.add(Math.round((total * i) / 13));
  setBusy('Mencari frame terbaik…');
  let frames: { t: number; cv: HTMLCanvasElement; score: number }[] = [];
  try { frames = (await grabFrames([...times].sort((a, b) => a - b))).sort((a, b) => b.score - a.score).slice(0, 8); } finally { setBusy(''); }
  if (!frames.length) { toast('Frame video tidak bisa dibaca.', 'error'); return; }
  const st = {
    frame: 0, text: (titleOut?.judul[0] ?? moments?.find((m) => m.title)?.title ?? P.name).toUpperCase(), style: 'kuning', size: 1, y: 0.78, zoom: 1, panX: 0.5, panY: 0.5,
    shade: true, pop: true, fmt: (tl().height > tl().width ? 'short' : 'yt') as 'yt' | 'short', logo: !!tl().watermark,
  };
  const cv = h('canvas', { class: 'ts-canvas' }) as HTMLCanvasElement;
  const draw = () => {
    const [W, H] = st.fmt === 'yt' ? [1280, 720] : [1080, 1920];
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;
    const f = frames[st.frame].cv;
    const s = Math.max(W / f.width, H / f.height) * st.zoom;
    const dw = f.width * s, dh = f.height * s;
    c.filter = st.pop ? 'contrast(1.12) saturate(1.3) brightness(1.04)' : 'none';
    c.drawImage(f, (W - dw) * st.panX, (H - dh) * st.panY, dw, dh);
    c.filter = 'none';
    if (st.shade) {
      const g = c.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
      c.fillStyle = v; c.fillRect(0, 0, W, H);
    }
    const sty = THUMB_STYLES.find((x) => x.id === st.style)!;
    let fs = Math.round((st.fmt === 'yt' ? 118 : 132) * st.size);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    // wrap; shrink the text until it fits in 3 lines
    const maxW = W * 0.9, words = st.text.trim().split(/\s+/).filter(Boolean);
    let rows: string[] = [];
    for (let tries = 0; tries < 30; tries++) {
      c.font = `900 ${fs}px Impact, "Bahnschrift", "Arial Black", sans-serif`;
      rows = [];
      let cur = '';
      for (const w of words) { const tr = cur ? `${cur} ${w}` : w; if (c.measureText(tr).width > maxW && cur) { rows.push(cur); cur = w; } else cur = tr; }
      if (cur) rows.push(cur);
      if (rows.length <= 3 && rows.every((r) => c.measureText(r).width <= maxW)) break;
      fs = Math.round(fs * 0.92);
    }
    const lh = fs * 1.02, top = st.y * H - ((rows.length - 1) * lh) / 2;
    rows.forEach((r, i) => {
      const y = top + i * lh, tw = c.measureText(r).width;
      if (sty.box) { c.fillStyle = sty.box; c.fillRect(W / 2 - tw / 2 - fs * 0.22, y - lh / 2, tw + fs * 0.44, lh * 0.98); }
      if (sty.stroke !== 'transparent') { c.lineWidth = fs * 0.16; c.strokeStyle = sty.stroke; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = fs * 0.2; c.shadowOffsetY = fs * 0.06; c.strokeText(r, W / 2, y); c.shadowColor = 'transparent'; }
      if (Array.isArray(sty.fill)) { const g = c.createLinearGradient(0, y - lh / 2, 0, y + lh / 2); g.addColorStop(0, sty.fill[0]); g.addColorStop(1, sty.fill[1]); c.fillStyle = g; } else c.fillStyle = sty.fill;
      c.fillText(r, W / 2, y);
    });
    const wm = tl().watermark;
    if (st.logo && wm) {
      const el = imageEl(wm.file);
      if (el.complete && el.naturalWidth) { const lw = Math.min(W, H) * 0.16, lh2 = lw / wm.aspect, m = Math.min(W, H) * 0.04; c.globalAlpha = 0.95; c.drawImage(el, W - lw - m, m, lw, lh2); c.globalAlpha = 1; }
    }
  };
  const close = () => { pop.remove(); window.removeEventListener('keydown', esc, true); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea')) { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', esc, true);
  const rangeIn = (label: string, v: number, min: number, max: number, step: number, on: (x: number) => void) =>
    tfSlider(label, v, min, max, step, (x) => `${Math.round(x * 100)}%`, (x) => { on(x); draw(); });
  const thumbs = h('div', { class: 'ts-frames' }, ...frames.map((fr, i) => {
    const b = h('button', { class: `ts-frame${i === st.frame ? ' on' : ''}`, title: `${tc(fr.t)}`, onclick: () => { st.frame = i; thumbs.querySelectorAll('.ts-frame').forEach((x, j) => x.classList.toggle('on', j === i)); draw(); } });
    const im = document.createElement('canvas'); im.width = 192; im.height = Math.round((192 * fr.cv.height) / fr.cv.width); im.getContext('2d')!.drawImage(fr.cv, 0, 0, im.width, im.height);
    b.append(im, h('span', { class: 'mono' }, tc(fr.t)));
    return b;
  }));
  const pop = h('div', { class: 'ts-wrap', role: 'dialog', 'aria-label': 'Thumbnail' },
    h('div', { class: 'ts-card' },
      h('div', { class: 'row-between' }, h('h3', {}, 'Thumbnail'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: close }, icon('x', 16))),
      h('div', { class: 'ts-body' },
        h('div', { class: 'ts-left' }, h('div', { class: 'label' }, 'Frame terbaik'), thumbs),
        h('div', { class: `ts-stage ${st.fmt}` }, cv),
        h('div', { class: 'ts-right' },
          h('div', { class: 'seg' },
            h('button', { class: st.fmt === 'yt' ? 'on' : '', onclick: (e: Event) => { st.fmt = 'yt'; (e.target as HTMLElement).parentElement!.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0)); cv.parentElement!.className = 'ts-stage yt'; draw(); } }, 'YouTube 16:9'),
            h('button', { class: st.fmt === 'short' ? 'on' : '', onclick: (e: Event) => { st.fmt = 'short'; (e.target as HTMLElement).parentElement!.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 1)); cv.parentElement!.className = 'ts-stage short'; draw(); } }, 'Shorts 9:16'),
          ),
          field('Judul', h('textarea', { rows: 3, value: st.text, oninput: (e) => { st.text = (e.target as HTMLTextAreaElement).value; draw(); } }, st.text)),
          titleOut?.judul.length ? h('div', { class: 'quick-grid' }, ...titleOut.judul.slice(0, 3).map((j) => h('button', { class: 'chip', title: j, onclick: () => { st.text = j.toUpperCase(); (pop.querySelector('textarea') as HTMLTextAreaElement).value = st.text; draw(); } }, j.slice(0, 18) + (j.length > 18 ? '…' : '')))) : '',
          h('div', { class: 'quick-grid' }, ...THUMB_STYLES.map((x) => h('button', { class: `chip${st.style === x.id ? ' on' : ''}`, onclick: (e: Event) => { st.style = x.id; (e.target as HTMLElement).parentElement!.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b === e.target)); draw(); } }, x.name))),
          rangeIn('Ukuran', st.size, 0.5, 1.6, 0.01, (x) => { st.size = x; }),
          rangeIn('Posisi', st.y, 0.12, 0.9, 0.01, (x) => { st.y = x; }),
          rangeIn('Zoom', st.zoom, 1, 2.5, 0.01, (x) => { st.zoom = x; }),
          rangeIn('Geser X', st.panX, 0, 1, 0.01, (x) => { st.panX = x; }),
          rangeIn('Geser Y', st.panY, 0, 1, 0.01, (x) => { st.panY = x; }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.pop, onchange: (e) => { st.pop = (e.target as HTMLInputElement).checked; draw(); } }), 'Warna lebih nendang'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.shade, onchange: (e) => { st.shade = (e.target as HTMLInputElement).checked; draw(); } }), 'Gelapkan bawah & tepi'),
          tl().watermark ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.logo, onchange: (e) => { st.logo = (e.target as HTMLInputElement).checked; draw(); } }), 'Logo channel') : '',
          h('button', {
            class: 'primary wide', onclick: async () => {
              draw();
              const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
              if (!blob) return;
              await invoke('ensure_dir', { path: settings.outDir });
              const base = `${(P?.name ?? 'video').trim()} thumbnail ${st.fmt === 'yt' ? '16x9' : '9x16'}`.replace(/[\\/:*?"<>|]+/g, '-');
              let file = join(settings.outDir, `${base}.png`), n = 1;
              while (await invoke<boolean>('exists', { path: file })) file = join(settings.outDir, `${base} (${++n}).png`);
              await invoke('write_bytes', { path: file, content: Array.from(new Uint8Array(await blob.arrayBuffer())) });
              toast(`Thumbnail disimpan: ${baseName(file)}`);
              void invoke('reveal', { path: file }).catch(() => undefined);
            },
          }, 'Simpan PNG'),
        ),
      ),
    ),
  );
  pop.addEventListener('pointerdown', (e) => { if (e.target === pop) close(); });
  document.body.append(pop);
  draw();
}

// ================= reverse: a reversed copy of the piece, made in 2-second chunks so memory stays small =================
let reversing = false;
async function reverseClip(c: VideoClip) {
  if (!P || reversing) return;
  if (c.reversedFrom) {
    // back to the original footage, keeping any trim done while reversed (reversed time x = original out - x)
    const r = c.reversedFrom;
    snapshot();
    const inMs = Math.max(r.inMs, r.outMs - c.outMs), outMs = Math.min(r.outMs, r.outMs - c.inMs);
    c.mediaId = r.mediaId; c.inMs = inMs; c.outMs = outMs;
    delete c.reversedFrom;
    changed();
    toast('Potongan diputar normal lagi.');
    return;
  }
  const m = mediaOf(c.mediaId);
  if (!m) return;
  reversing = true;
  pause();
  const p = P;
  const dir = join(await projectDir(p.id), `rev-${uid()}`);
  await invoke('ensure_dir', { path: dir });
  try {
    const CH = 2000;
    const parts: string[] = [];
    const total = c.outMs - c.inMs;
    for (let a = c.inMs, i = 0; a < c.outMs - 10; a += CH, i++) {
      const d = Math.min(CH, c.outMs - a);
      const out = join(dir, `p${String(i).padStart(4, '0')}.mp4`);
      setBusy(`Membuat video mundur… ${Math.round(((a - c.inMs) / total) * 100)}%`);
      await runTool('ffmpeg', [
        '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-ss', (a / 1000).toFixed(3), '-t', (d / 1000).toFixed(3), '-i', m.playable,
        '-map', '0:v:0', ...(m.hasAudio ? ['-map', '0:a:0', '-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
        '-vf', 'reverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(Math.round(m.fps) || 30), out,
      ]);
      parts.push(out);
    }
    const list = join(dir, 'list.txt');
    await invoke('write_text', { path: list, content: parts.reverse().map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n' });
    const outFile = join(await projectDir(p.id), `${m.name.replace(/[^\w\- ]+/g, '').slice(0, 40) || 'video'} mundur ${uid().slice(0, 4)}.mp4`);
    setBusy('Menyatukan video mundur…');
    await runTool('ffmpeg', ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
    const m2 = await importMedia(outFile, setBusy);
    m2.name = `${m.name} (mundur)`;
    p.media.push(m2);
    snapshot();
    c.reversedFrom = { mediaId: c.mediaId, inMs: c.inMs, outMs: c.outMs };
    c.mediaId = m2.id; c.inMs = 0; c.outMs = Math.min(m2.durationMs, total);
    changed({ left: true });
    toast('Potongan sekarang diputar mundur. Klik kanan → Putar normal lagi untuk membatalkan.');
    setBusy('Membuat thumbnail…');
    await buildThumbs(p, m2);
    await saveProject(p);
    await loadSheets(m2);
    drawTimeline();
  } catch (e) {
    toast(`Gagal membuat video mundur: ${(e as Error).message}`, 'error');
  } finally {
    await invoke('remove_path', { path: dir }).catch(() => undefined);
    setBusy('');
    reversing = false;
  }
}


// ================= paste pictures from the web (Ctrl+V) =================
let pendingPaste = 0;
function onPaste(e: ClipboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable || !P) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const html = cd.getData('text/html');
  const m = html ? /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html) : null;
  const decode = (u: string) => { const ta = document.createElement('textarea'); ta.innerHTML = u; return ta.value; };
  let url = m ? decode(m[1]) : '';
  const text = cd.getData('text/plain').trim();
  if (!url && /^(https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?|data:image\/[a-z]+;base64,\S+)$/i.test(text)) url = text;
  const blob = [...cd.files].find((f) => f.type.startsWith('image/')) ?? null;
  if (!url && !blob) return;   // not a picture: the timer from the key press pastes the app's own clipboard
  e.preventDefault();
  if (pendingPaste) { clearTimeout(pendingPaste); pendingPaste = 0; }
  void pasteWebImage(url, blob);
}

/** Same as Ctrl+V on a picture, from the menu (reads the clipboard directly). */
async function pasteFromClipboardApi() {
  try {
    const items = await navigator.clipboard.read();
    let url = '', blob: File | null = null;
    for (const it of items) {
      if (!url && it.types.includes('text/html')) {
        const html = await (await it.getType('text/html')).text();
        const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
        if (m) { const ta = document.createElement('textarea'); ta.innerHTML = m[1]; url = ta.value; }
      }
      const imgType = it.types.find((x) => x.startsWith('image/'));
      if (!blob && imgType) blob = new File([await it.getType(imgType)], 'tempel', { type: imgType });
      if (!url && it.types.includes('text/plain')) {
        const tx = (await (await it.getType('text/plain')).text()).trim();
        if (/^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(tx)) url = tx;
      }
    }
    if (!url && !blob) { toast('Belum ada gambar yang disalin. Di browser: klik kanan gambar → Copy image.'); return; }
    await pasteWebImage(url, blob);
  } catch {
    toast('Clipboard tidak bisa dibaca dari menu. Salin gambarnya, klik timeline, lalu tekan Ctrl+V.');
  }
}
const sniffExt = (b: Uint8Array) =>
  b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 ? 'gif' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg'
    : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'webp' : '';
async function pasteWebImage(url: string, blob: File | null) {
  if (!P) return;
  if (!canPlace()) { toast('Tambahkan video ke timeline dulu.'); return; }
  setBusy('Menempel gambar…');
  const dir = join(await dataDir(), 'paste');
  await invoke('ensure_dir', { path: dir });
  const id = uid().slice(0, 4);
  // name it after the file on the web ("kaget.gif" -> "kaget"), else "tempel"
  let label = 'tempel';
  try { if (/^https?:/i.test(url)) label = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().slice(0, 40) || 'tempel'; } catch { /* keep "tempel" */ }
  const save = async (bytes: Uint8Array) => {
    const ext = sniffExt(bytes);
    if (!ext) return '';
    const f = join(dir, `${label} ${id}.${ext}`);
    await invoke('write_bytes', { path: f, content: Array.from(bytes) });
    return f;
  };
  const tryAdd = async (path: string) => { try { return await addMeme(path, 'Tempel'); } catch { return null; } };
  let meme: Meme | null = null;
  try {
    // the original file first (keeps a GIF animated), then the copy the browser put on the clipboard
    if (url.startsWith('data:image/')) {
      const bin = atob(url.slice(url.indexOf(',') + 1));
      const path = await save(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      if (path) meme = await tryAdd(path);
    } else if (/^https?:\/\//i.test(url)) {
      const tmp = join(dir, `web-${id}.bin`);
      try {
        await invoke('download', { url, dest: tmp });
        const path = await save(Uint8Array.from(await invoke<number[]>('read_bytes', { path: tmp })));
        if (path) meme = await tryAdd(path);
      } catch { /* the site may refuse direct downloads; fall back to the clipboard copy */ }
      await invoke('remove_path', { path: tmp }).catch(() => undefined);
    }
    if (!meme && blob) {
      const path = await save(new Uint8Array(await blob.arrayBuffer()));
      if (path) meme = await tryAdd(path);
    }
    if (!meme) { toast('Gambar ini tidak bisa ditempel. Coba klik kanan gambarnya → Copy image, atau simpan dulu lalu tarik ke aplikasi.', 'error'); return; }
    await saveLibrary();
    library = await loadLibrary();
    insertMeme(meme);
    toast(meme.animated ? 'GIF ditempel di playhead (juga disimpan di library Meme, kategori Tempel).' : 'Gambar ditempel di playhead (juga disimpan di library Meme, kategori Tempel).');
  } finally {
    setBusy('');
  }
}

// ================= tooltips: every icon says what it does =================
function setupTooltips() {
  const tip = h('div', { class: 'tip', role: 'tooltip' });
  document.body.append(tip);
  let timer = 0;
  let cur: HTMLElement | null = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('show'); cur = null; };
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement).closest?.('[title],[data-tip],button[aria-label]') as HTMLElement | null;
    if (el === cur) return;
    hide();
    if (!el) return;
    // the browser's own tooltip is slow and plain: keep the text, show ours instead
    const own = el.getAttribute('title');
    if (own !== null) { if (own) el.dataset.tip = own; el.removeAttribute('title'); }
    const text = el.dataset.tip || (el.tagName === 'BUTTON' && !el.textContent?.trim() ? el.getAttribute('aria-label') ?? '' : '');
    if (!text) return;
    cur = el;
    timer = window.setTimeout(() => {
      if (cur !== el || !el.isConnected) return;
      tip.textContent = text;
      tip.classList.add('show');
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let top = r.bottom + 8;
      if (top + tr.height > window.innerHeight - 6) top = r.top - tr.height - 8;
      const left = clamp(r.left + r.width / 2 - tr.width / 2, 6, window.innerWidth - tr.width - 6);
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }, 420);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('keydown', hide, true);
}

// ================= Premiere-style tools: markers, In/Out, J/K/L, Q/W, waveforms =================

const MARKER_COLORS: [string, string][] = [['#3fc2cc', 'Tosca'], ['#ffb020', 'Kuning'], ['#ff5c7a', 'Merah'], ['#7c8cff', 'Ungu'], ['#7ddc6a', 'Hijau']];
const markers = () => (tl().markers ??= []);
const markerAtX = (x: number) => markers().find((m) => Math.abs(msToX(m.ms) - x) <= 6);

function addMarker() {
  if (!P) return;
  const near = markers().find((m) => Math.abs(m.ms - t) < 1000 / tl().fps);
  if (near) { void renameMarker(near); return; }
  snapshot();
  markers().push({ id: uid(), ms: Math.round(t), label: `Marker ${markers().length + 1}`, color: MARKER_COLORS[0][0] });
  markers().sort((a, b) => a.ms - b.ms);
  changed();
  toast('Marker ditambah. Tekan M lagi di tempat yang sama untuk ganti nama.');
}
function jumpMarker(dir: 1 | -1) {
  if (!P) return;
  const ms = markers().map((m) => m.ms);
  const r = tl().range;
  if (r) ms.push(r.inMs, r.outMs);
  const next = dir > 0 ? ms.filter((m) => m > t + 1).sort((a, b) => a - b)[0] : ms.filter((m) => m < t - 1).sort((a, b) => b - a)[0];
  if (next === undefined) { toast(dir > 0 ? 'Tidak ada marker sesudah ini.' : 'Tidak ada marker sebelum ini.'); return; }
  pause();
  seek(next);
}
async function renameMarker(m: Marker, at?: { x: number; y: number }) {
  const pos = at ?? (() => { const r = tlCanvas.getBoundingClientRect(); return { x: r.left + msToX(m.ms), y: r.top + RULER + 4 }; })();
  const name = await askText(pos.x, pos.y, 'Nama marker', m.label);
  if (name === null) return;
  snapshot();
  m.label = name.trim() || m.label;
  changed();
}
function markerMenu(e: MouseEvent, m: Marker) {
  openMenu(e.clientX, e.clientY, [
    { label: 'Ganti nama…', icon: 'text', run: () => void renameMarker(m, { x: e.clientX, y: e.clientY }) },
    { label: 'Loncat ke sini', icon: 'forward', run: () => seek(m.ms) },
    'sep',
    ...MARKER_COLORS.map(([c, n]) => ({ label: `Warna ${n}${m.color === c ? '  ✓' : ''}`, icon: 'color' as IconName, run: () => { snapshot(); m.color = c; changed(); } })),
    'sep',
    { label: 'Hapus marker', icon: 'trash', danger: true, run: () => { snapshot(); tl().markers = markers().filter((x) => x.id !== m.id); changed(); } },
    { label: 'Hapus semua marker', icon: 'trash', danger: true, disabled: markers().length < 2, run: () => { snapshot(); tl().markers = []; changed(); } },
  ]);
}
function rulerMenu(e: MouseEvent, x: number) {
  const m = markerAtX(x);
  if (m) { markerMenu(e, m); return; }
  const ms = Math.max(0, xToMs(x));
  const r = tl().range;
  openMenu(e.clientX, e.clientY, [
    { label: 'Tambah marker di sini', icon: 'plus', keys: 'M', run: () => { seek(ms); addMarker(); } },
    { label: 'Set In di sini', icon: 'fadeIn', keys: 'I', run: () => setRange('in', ms) },
    { label: 'Set Out di sini', icon: 'fadeOut', keys: 'O', run: () => setRange('out', ms) },
    { label: 'Hapus In/Out', icon: 'x', keys: 'Ctrl+Shift+X', disabled: !r, run: () => setRange('clear') },
    'sep',
    { label: 'Salin chapter YouTube', icon: 'copy', disabled: !markers().length, run: () => void copyChapters() },
  ]);
}

/** A small text box at the pointer; resolves with the text, or null on Esc / click away. */
function askText(x: number, y: number, title: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    document.querySelector('.ask-pop')?.remove();
    const input = h('input', { type: 'text', value, 'aria-label': title }) as HTMLInputElement;
    const pop = h('div', { class: 'ask-pop' }, h('div', { class: 'muted small' }, title), input);
    document.body.append(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    pop.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; pop.remove(); window.removeEventListener('pointerdown', away, true); resolve(v); };
    const away = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.ask-pop')) finish(input.value); };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });
    setTimeout(() => { window.addEventListener('pointerdown', away, true); input.focus(); input.select(); }, 0);
  });
}

async function copyChapters() {
  const r = tl().range;
  const text = youtubeChapters(markers().filter((m) => !r || (m.ms >= r.inMs && m.ms < r.outMs)), r?.inMs ?? 0);
  if (!text) { toast('Belum ada marker. Tekan M di awal tiap bagian video.'); return; }
  try { await navigator.clipboard.writeText(text); toast('Chapter YouTube disalin. Tempel di deskripsi video.'); }
  catch { void askText(window.innerWidth / 2 - 160, 120, 'Salin chapter ini (Ctrl+C)', text); }
}

function setRange(which: 'in' | 'out' | 'clear', at = t) {
  if (!P) return;
  snapshot();
  const total = timelineDuration(tl());
  const r = tl().range ?? { inMs: 0, outMs: total };
  if (which === 'clear') tl().range = null;
  else {
    if (which === 'in') r.inMs = Math.round(clamp(at, 0, total));
    else r.outMs = Math.round(clamp(at, 0, total));
    if (r.outMs - r.inMs < 100) { if (which === 'in') r.outMs = total; else r.inMs = 0; }
    tl().range = r;
  }
  changed();
  if (which !== 'clear') toast(`In/Out: ${tc(tl().range!.inMs, true)} – ${tc(tl().range!.outMs, true)} (${tc(tl().range!.outMs - tl().range!.inMs, true)})`);
}
/** In/Out clamped to the current timeline, or null when not set. */
function rangeNow(): { inMs: number; outMs: number } | null {
  const r = tl().range;
  if (!r) return null;
  const total = timelineDuration(tl());
  const a = clamp(r.inMs, 0, total), b = clamp(r.outMs, 0, total);
  return b - a >= 100 && (a > 0 || b < total) ? { inMs: a, outMs: b } : null;
}

// J / K / L: play backwards, stop, play forwards; press again for 2x, 4x, 8x
let shuttle = 0;
let reverseTimer = 0;
const playRate = () => Math.max(1, shuttle);
function stopReverse() { if (reverseTimer) { clearInterval(reverseTimer); reverseTimer = 0; } }
function shuttleKey(k: 'j' | 'k' | 'l') {
  if (!P) return;
  if (k === 'k') { stopReverse(); pause(); shuttle = 0; showSpeed(); return; }
  if (k === 'l') {
    stopReverse();
    const next = playing && shuttle > 0 ? Math.min(8, shuttle * 2) : 1;
    if (!playing) play();
    shuttle = next;
    clock = { at: performance.now(), t };
    syncVideo();
  } else {
    const next = reverseTimer && shuttle < 0 ? Math.max(-8, shuttle * 2) : -1;
    pause();
    shuttle = next;
    stopReverse();
    let last = performance.now();
    reverseTimer = window.setInterval(() => {
      const now = performance.now();
      const nt = t - (now - last) * -shuttle;
      last = now;
      if (nt <= 0) { seek(0); stopReverse(); shuttle = 0; return; }
      seek(nt);
    }, 60);
  }
  showSpeed();
}
function showSpeed() {
  const el = $('#time');
  if (!el) return;
  el.dataset.speed = shuttle && Math.abs(shuttle) !== 1 || shuttle < 0 ? `${shuttle < 0 ? '◀ ' : ''}${Math.abs(shuttle)}×` : '';
}

/** Q / W: cut the main clip under the playhead from its start (Q) or to its end (W), closing the gap. */
function rippleTrim(which: 'start' | 'end') {
  if (!P) return;
  const loc = locate(tl().clips, t);
  if (!loc) { toast('Taruh playhead di atas video utama.'); return; }
  const c = tl().clips[loc.index];
  const start = clipStarts(tl().clips)[loc.index];
  const off = t - start, len = clipDuration(c);
  if (off < 50 || len - off < 50) { toast('Playhead terlalu dekat dengan ujung potongan.'); return; }
  pause();
  const before = clipMap();
  snapshot();
  if (which === 'start') c.inMs = Math.round(c.inMs + off * c.speed);
  else c.outMs = Math.round(c.inMs + off * c.speed);
  followMainTrack(before);
  changed();
  seek(which === 'start' ? start : t);
  toast(which === 'start' ? `Awal potongan dibuang (${tc(off, true)}).` : `Sisa potongan dibuang (${tc(len - off, true)}).`);
}

// waveforms of the audio on the timeline, one peak per 100 ms, loaded once per file
const waves = new Map<string, Uint8Array | null>();
function waveOf(path: string): Uint8Array | undefined {
  if (!path) return undefined;
  if (waves.has(path)) return waves.get(path) ?? undefined;
  waves.set(path, null);
  invoke<number[]>('waveform', { path, track: 0, job: `wave-${uid()}` })
    .then((pk) => { if (pk?.length) { waves.set(path, Uint8Array.from(pk)); drawTimeline(); } })
    .catch(() => undefined);
  return undefined;
}
/** Bars from the bottom of a box; `srcAt(dx)` gives the file time (ms) at dx pixels into the box. */
function drawWave(ctx: CanvasRenderingContext2D, peaks: Uint8Array, x: number, y: number, w: number, hgt: number, viewW: number, srcAt: (dx: number) => number, color: string) {
  const x0 = Math.max(x, 0), x1 = Math.min(x + w, viewW);
  if (x1 <= x0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, x1 - x0, hgt); ctx.clip();
  ctx.fillStyle = color;
  for (let px = Math.floor(x0); px < x1; px += 2) {
    const a = Math.floor(srcAt(px - x) / 100), b = Math.floor(srcAt(px + 2 - x) / 100);
    let pk = 0;
    for (let i = Math.max(0, a); i <= Math.max(a, b) && i < peaks.length; i++) if (peaks[i] > pk) pk = peaks[i];
    const bh = Math.max(1, (pk / 255) * hgt);
    ctx.fillRect(px, y + hgt - bh, 1.5, bh);
  }
  ctx.restore();
}

/** Markers and In/Out on the ruler, with thin lines down through the lanes. */
function drawMarkersAndRange(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const r = tl().range;
  if (r) {
    const a = msToX(r.inMs), b = msToX(r.outMs);
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    if (a > 0) ctx.fillRect(0, RULER, Math.min(a, W), H - RULER);
    if (b < W) ctx.fillRect(Math.max(0, b), RULER, W - Math.max(0, b), H - RULER);
    ctx.fillStyle = 'rgba(63,194,204,.22)';
    ctx.fillRect(a, 0, b - a, RULER - 1);
    ctx.fillStyle = '#3fc2cc';
    ctx.fillRect(a, 0, 2, H); ctx.fillRect(b - 2, 0, 2, H);
    ctx.font = `700 9px ${TL_FONT}`;
    ctx.fillStyle = '#0f1414';
    roundRect(ctx, a, 2, 12, 11, 3); ctx.fillStyle = '#3fc2cc'; ctx.fill();
    roundRect(ctx, b - 12, 2, 12, 11, 3); ctx.fill();
    ctx.fillStyle = '#0f1414';
    ctx.fillText('I', a + 4.5, 8); ctx.fillText('O', b - 9.5, 8);
  }
  for (const m of markers()) {
    const x = msToX(m.ms);
    if (x < -80 || x > W + 4) continue;
    ctx.fillStyle = m.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, RULER, 1, H - RULER);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x - 5, RULER - 15); ctx.lineTo(x + 5, RULER - 15); ctx.lineTo(x + 5, RULER - 6); ctx.lineTo(x, RULER - 1); ctx.lineTo(x - 5, RULER - 6); ctx.closePath();
    ctx.fill();
    if (pxPerSec > 12 || markers().length < 12) {
      ctx.font = `600 10px ${TL_FONT}`;
      const tw = Math.min(140, ctx.measureText(m.label).width + 8);
      ctx.fillStyle = 'rgba(18,20,20,.9)';
      roundRect(ctx, x + 7, RULER - 16, tw, 13, 3); ctx.fill();
      ctx.fillStyle = m.color;
      ctx.fillText(m.label, x + 11, RULER - 9.5, tw - 8);
    }
  }
}

// ================= keyboard =================

function onKey(e: KeyboardEvent) {
  if (!P) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const frame = 1000 / tl().fps;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); splitHere(); return; }
  if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'x') { e.preventDefault(); copySelection(true); return; }
  if (ctrl && e.key.toLowerCase() === 'v') {
    // the paste event decides: a picture from the web/clipboard, else the app's own clipboard
    const shift = e.shiftKey;
    if (pendingPaste) clearTimeout(pendingPaste);
    pendingPaste = window.setTimeout(() => { pendingPaste = 0; pasteClipboard(shift && clipboard ? clipboard.base : undefined); }, 90);
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else groupSelection(); return; }
  // Photoshop habits
  if (ctrl && e.key.toLowerCase() === 'j') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && e.key.toLowerCase() === 't') { e.preventDefault(); startTransform('transform'); return; }
  if (ctrl && e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); toggleCanvasPop(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); jumpMarker(-1); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); setRange('clear'); return; }
  if (ctrl && ['u', 'l', 'm'].includes(e.key.toLowerCase())) { e.preventDefault(); switchTab('color'); return; }
  if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleExport(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow(); return; }
  if (ctrl && e.key === '0') { e.preventDefault(); fitZoom(); return; }
  if (ctrl && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); arrangeLayer(e.code === 'BracketRight' ? 1 : -1, e.shiftKey); return; }
  if (!ctrl && e.key === '\\' && !e.repeat) { gradeBypass = true; renderFrame(); return; }
  if (ctrl && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    multi.clear();
    for (const r of itemRects()) multi.add(mkey(r.kind, r.id));
    sel = null;
    renderInspector(); drawTimeline();
    toast(`${multi.size} item dipilih (semua kecuali potongan video).`);
    return;
  }
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (!ctrl && e.altKey && digit && library) {
    const c = (library.clips ?? [])[Number(digit[1]) - 1];
    if (c) { e.preventDefault(); void insertVideoMeme(c); }
    return;
  }
  if (!ctrl && !e.altKey && digit && library) {
    const n = Number(digit[1]) - 1;
    if (e.shiftKey) { const m = library.memes[n]; if (m) { e.preventDefault(); insertMeme(m); } }
    else { const pad = library.pads[n]; if (pad) { e.preventDefault(); insertSound(pad); } }
    return;
  }
  if (!ctrl && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === 'm') { e.preventDefault(); if (e.shiftKey) jumpMarker(1); else addMarker(); return; }
    if (key === 'i' || key === 'o') {
      e.preventDefault();
      if (e.shiftKey) { const r = tl().range; if (r) { pause(); seek(key === 'i' ? r.inMs : r.outMs); } }
      else setRange(key === 'i' ? 'in' : 'out');
      return;
    }
    if ((key === 'j' || key === 'k' || key === 'l') && !e.repeat) { e.preventDefault(); shuttleKey(key); return; }
    if ((key === 'q' || key === 'w') && !e.shiftKey) { e.preventDefault(); rippleTrim(key === 'q' ? 'start' : 'end'); return; }
  }
  if ((e.key === 'c' || e.key === 'C') && !ctrl && !e.altKey) { if (tab === 'crop' && cropMode) { cropMode = false; renderInspector(); renderFrame(); } else startTransform('crop'); return; }
  if (e.key === 'Enter' && (cropMode || tfSession)) { endTransform(true); return; }
  if (e.key === 'Escape' && tfSession) { endTransform(false); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seek(t - (e.shiftKey ? 1000 : frame)); break;
    case 'ArrowRight': e.preventDefault(); pause(); seek(t + (e.shiftKey ? 1000 : frame)); break;
    case 'Home': seek(0); break;
    case 'End': seek(timelineDuration(tl())); break;
    case 'Escape': if (auditionEl) { stopAudition(); break; } if (cropMode) { cropMode = false; } else { sel = null; multi.clear(); } renderInspector(); drawTimeline(); renderFrame(); break;
    case '=': case '+': zoomBy(1.25); break;
    case '-': zoomBy(0.8); break;
  }
}

window.addEventListener('keyup', (e) => { if (e.key === '\\' && gradeBypass) { gradeBypass = false; renderFrame(); } });

// ---------- Ctrl+T / C: a transform session like Photoshop's Free Transform ----------
let tfSession: { kind: SelKind; id: string; before: unknown } | null = null;
function startTransform(mode: 'transform' | 'crop') {
  if (!P) return;
  if (!sel || !['layer', 'clip', 'image', 'text'].includes(sel.kind)) {
    // nothing picked: take the video under the playhead
    const loc = locate(tl().clips, t);
    if (loc) { multi.clear(); sel = { kind: 'clip', id: tl().clips[loc.index].id }; }
    else { toast('Pilih video, layer, meme, atau teks dulu.'); return; }
  }
  const obj = (listOf(sel.kind) as { id: string }[]).find((x) => x.id === sel!.id);
  if (!obj) return;
  if (!tfSession || tfSession.id !== sel.id) { snapshot(); tfSession = { kind: sel.kind, id: sel.id, before: structuredClone(obj) }; }
  cropMode = mode === 'crop' && sel.kind === 'layer';
  switchTab(mode);
  showTfHint();
  renderInspector(); drawTimeline(); renderFrame();
}
function endTransform(commit: boolean) {
  if (tfSession && !commit) {
    const obj = (listOf(tfSession.kind) as { id: string }[]).find((x) => x.id === tfSession!.id);
    if (obj) Object.assign(obj, structuredClone(tfSession.before));
    toast('Transform dibatalkan.');
  }
  tfSession = null;
  cropMode = false;
  showTfHint();
  changed();
}
function showTfHint() {
  document.querySelector('.tf-hint')?.remove();
  if (!tfSession && !cropMode) return;
  $('#stage')?.append(h('div', { class: 'tf-hint' }, h('b', {}, cropMode ? 'CROP' : 'TRANSFORM'), h('span', {}, h('kbd', {}, 'Enter'), ' selesai'), h('span', {}, h('kbd', {}, 'Esc'), ' batal')));
}
/** Ctrl+] / Ctrl+[ : layer forward / backward (Shift: to the very front / back). */
function arrangeLayer(dir: 1 | -1, all: boolean) {
  const ly = selected('layer');
  if (!ly) { toast('Pilih layer video dulu untuk mengatur urutannya.'); return; }
  const a = layers(), i = a.indexOf(ly);
  const j = all ? (dir > 0 ? a.length - 1 : 0) : clamp(i + dir, 0, a.length - 1);
  if (i === j) return;
  snapshot();
  a.splice(i, 1); a.splice(j, 0, ly);
  changed({ left: tab === 'layers' });
  toast(dir > 0 ? 'Layer dibawa ke depan.' : 'Layer dibawa ke belakang.');
}
async function saveNow() {
  if (!P) return;
  await saveProject(P, true);
  await snapshotProject(P, 'simpan').catch(() => undefined);
  toast('Disimpan. Salinan versi juga dibuat di Riwayat versi.');
}

window.addEventListener('beforeunload', () => void flush());
// show unexpected errors instead of silently stopping, and keep the app usable
window.addEventListener('error', (e) => { toast(`Terjadi error: ${e.message}`, 'error'); setBusy(''); });
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | string | undefined;
  toast(`Terjadi error: ${typeof r === 'string' ? r : r?.message ?? 'tidak diketahui'}`, 'error');
  setBusy('');
});
void boot();
