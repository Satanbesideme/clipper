import './styles.css';
import { dialog, fileSrc, invoke, isTauri, onDrop, extName, join } from './tauri';
import {
  DEFAULT_CAPTION, DEFAULT_TEXT, clipDuration, clipStarts, locate, splitAt, timelineDuration,
  type CaptionLine, type ImageItem, type Watermark, type SoundItem, type TextItem, type TextStyle, type Trans, type VideoClip, type Word,
  transState, TRANS_IN_MS,
} from './render';
import {
  IMAGE_EXT, SOUND_EXT, deleteMeme, deletePad, importFiles as importLibFiles, loadLibrary, move, saveLibrary, soundOf,
  type Library, type Meme, type Pad,
} from './library';
import {
  dataDir, deleteProject, flush, listProjects, loadProject, loadSettings, newProject, saveProject, saveSettings, uid,
  type MediaEntry, type Project, type Settings,
} from './store';
import {
  ENCODER_LABEL, MODELS, VIDEO_EXT, buildThumbs, cancelExport, detectEncoder, downloadModel, enqueueExport,
  importMedia, modelReady, onQueueChange, queue, thumbPath, transcribe,
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
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  const life = kind === 'error' ? 8000 : 3000;
  setTimeout(() => t.classList.add('out'), life);
  setTimeout(() => t.remove(), life + 400);
}

const FONTS = ['Segoe UI', 'Bahnschrift', 'Impact', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Comic Sans MS'];

// ================= state =================

type SelKind = 'clip' | 'text' | 'line' | 'sound' | 'image';
type Sel = { kind: SelKind; id: string } | null;
type LeftTab = 'media' | 'sound' | 'meme' | 'text' | 'captions';

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
function listOf(kind: SelKind): { id: string }[] {
  return kind === 'clip' ? tl().clips : kind === 'text' ? tl().texts : kind === 'line' ? tl().captions.lines : kind === 'sound' ? sounds() : images();
}
const selected = <T extends SelKind>(kind: T) =>
  (sel?.kind === kind ? listOf(kind).find((x) => x.id === sel!.id) : undefined) as
  (T extends 'clip' ? VideoClip : T extends 'text' ? TextItem : T extends 'line' ? CaptionLine : T extends 'sound' ? SoundItem : ImageItem) | undefined;
let library: Library | null = null;
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
  t = clamp(t, 0, Math.max(0, timelineDuration(tl()) - 1));
  drawTimeline();
  renderFrame();
  if (opts.inspector !== false) renderInspector();
  if (opts.left) renderLeft();
  updateTime();
  const fm = $('#fmt');
  if (fm) fm.textContent = `${tl().width}×${tl().height} · ${tl().fps} fps`;
}
function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(JSON.stringify(P!.timeline));
  P!.timeline = JSON.parse(s);
  sel = null;
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
    app.append(h('div', { class: 'center-msg' }, 'Buka lewat aplikasi GALSURKU Clipper.'));
    return;
  }
  settings = await loadSettings();
  void onDrop((paths) => void dropped(paths));
  onQueueChange(renderQueue);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { layoutPreview(); sizeTimeline(); });
  await renderHome();
  if (!settings.encoder) {
    settings.encoder = await detectEncoder();
    await saveSettings(settings);
  }
}

async function dropped(paths: string[]) {
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

async function renderHome() {
  pause();
  await flush();
  P = null;
  sel = null;
  videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  videos.clear();
  sheets.clear();
  const list = await listProjects();
  app.replaceChildren(
    h('header', { class: 'bar' },
      h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'GALSURKU Clipper'),
    ),
    h('main', { class: 'home' },
      h('button', {
        class: 'drop', onclick: async () => {
          const files = await dialog().open({ multiple: true, title: 'Pilih rekaman', filters: [{ name: 'Video', extensions: VIDEO_EXT }] });
          const arr = typeof files === 'string' ? [files] : files ?? [];
          if (arr.length) await dropped(arr);
        },
      },
        h('div', { class: 'drop-plus' }, '+'),
        h('div', { class: 'drop-title' }, 'Proyek baru'),
        h('div', { class: 'muted' }, 'Klik untuk memilih rekaman, atau tarik file video ke jendela ini'),
      ),
      list.length ? h('h2', { class: 'section' }, 'Proyek') : null,
      h('ul', { class: 'projects' },
        ...list.map((p) => h('li', {},
          h('button', { class: 'proj', onclick: () => void openProject(p.id) },
            h('div', { class: 'proj-name' }, p.name),
            h('div', { class: 'muted small' }, `${tc(p.durationMs)} · ${p.clips} potongan · ${new Date(p.updatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`),
          ),
          h('button', {
            class: 'icon-btn', title: 'Hapus proyek', 'aria-label': `Hapus proyek ${p.name}`,
            onclick: async () => {
              if (await dialog().ask(`Hapus proyek "${p.name}"?\nFile rekaman asli tidak ikut terhapus.`, { title: 'Hapus proyek', kind: 'warning' })) {
                await deleteProject(p.id);
                await renderHome();
              }
            },
          }, '✕'),
        )),
      ),
    ),
  );
}

async function openProject(id: string, importNow: string[] = []) {
  const p = await loadProject(id);
  if (!p) { toast('Proyek tidak bisa dibuka.', 'error'); return; }
  P = p;
  p.timeline.sounds ??= [];
  p.timeline.images ??= [];
  sel = null;
  t = 0;
  void loadLibrary().then((l) => { library = l; if (tab === 'sound' || tab === 'meme') renderLeft(); });
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
        tl().clips.push({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 1, fit: m.width / m.height < 0.7 ? 'fill' : 'fit' });
        if (tl().clips.length === 1) tl().fps = m.fps >= 50 ? 60 : 30;
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
  preview = h('canvas', { class: 'preview', width: 540, height: 960, 'aria-label': 'Preview video' });
  tlCanvas = h('canvas', { class: 'tl-canvas', 'aria-label': 'Timeline' });
  app.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'ghost', onclick: () => void renderHome() }, '← Proyek'),
      h('input', {
        class: 'title-input', value: p.name, 'aria-label': 'Nama proyek',
        onchange: (e) => { p.name = (e.target as HTMLInputElement).value.trim() || p.name; void saveProject(p); },
      }),
      h('div', { class: 'spacer' }),
      h('span', { id: 'busy', class: 'busy muted small' }),
      h('button', { class: 'primary', id: 'export-btn', onclick: toggleExport }, 'Ekspor'),
    ),
    h('div', { class: 'workspace' },
      h('aside', { class: 'left' },
        h('nav', { class: 'tabs', role: 'tablist' },
          ...(['media', 'sound', 'meme', 'text', 'captions'] as LeftTab[]).map((k) => h('button', {
            role: 'tab', class: tab === k ? 'on' : '', 'aria-selected': tab === k ? 'true' : 'false', 'data-tab': k,
            onclick: () => { libEdit = false; switchTab(k); },
          }, k === 'media' ? 'Media' : k === 'sound' ? 'Suara' : k === 'meme' ? 'Meme' : k === 'text' ? 'Teks' : 'Subtitle')),
        ),
        h('div', { class: 'left-body', id: 'left' }),
      ),
      h('section', { class: 'viewer' },
        h('div', { class: 'stage', id: 'stage' }, preview),
        h('div', { class: 'transport' },
          h('span', { class: 'mono small', id: 'time' }),
          h('button', { class: 'play', id: 'play', 'aria-label': 'Putar', onclick: togglePlay }, '▶'),
          h('span', { class: 'muted small', id: 'fmt' }, `${tl().width}×${tl().height} · ${tl().fps} fps`),
        ),
      ),
      h('aside', { class: 'right', id: 'inspector' }),
    ),
    h('section', { class: 'timeline' },
      h('div', { class: 'tl-tools' },
        h('button', { class: 'tool', title: 'Urungkan (Ctrl+Z)', onclick: undo }, '↶'),
        h('button', { class: 'tool', title: 'Ulangi (Ctrl+Y)', onclick: redo }, '↷'),
        h('span', { class: 'sep' }),
        h('button', { class: 'tool', title: 'Potong di playhead (Ctrl+B)', onclick: splitHere }, '✂ Split'),
        h('button', { class: 'tool', title: 'Hapus (Delete)', onclick: deleteSelected }, '🗑 Hapus'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'tool', title: 'Perkecil', onclick: () => zoomBy(0.8) }, '−'),
        h('input', { type: 'range', id: 'zoom', min: 0, max: 100, 'aria-label': 'Zoom timeline', oninput: (e) => setZoomFromSlider(Number((e.target as HTMLInputElement).value)) }),
        h('button', { class: 'tool', title: 'Perbesar', onclick: () => zoomBy(1.25) }, '+'),
        h('button', { class: 'tool', title: 'Muat seluruh timeline', onclick: fitZoom }, 'Pas'),
      ),
      h('div', { class: 'tl-body', id: 'tl-body' }, tlCanvas),
    ),
    h('div', { class: 'export-pop', id: 'export-pop', hidden: true }),
  );
  setupTimeline();
  setupPreviewDrag();
  renderLeft();
  renderInspector();
  setBusy(busy);
  requestAnimationFrame(() => { layoutPreview(); sizeTimeline(); renderFrame(); updateTime(); });
  new ResizeObserver(() => { layoutPreview(); sizeTimeline(); }).observe($('#stage')!);
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
  if (el && P) el.textContent = `${tc(t, true)} / ${tc(timelineDuration(tl()), true)}`;
}

// ================= left panel =================

function renderLeft() {
  const el = $('#left');
  if (!el || !P) return;
  if (tab === 'media') el.replaceChildren(...mediaPanel());
  else if (tab === 'sound') el.replaceChildren(...soundPanel());
  else if (tab === 'meme') el.replaceChildren(...memePanel());
  else if (tab === 'text') el.replaceChildren(...textPanel());
  else el.replaceChildren(...captionPanel());
}

function mediaPanel(): Node[] {
  const p = P!;
  return [
    h('button', { class: 'secondary wide', onclick: () => void pickAndImport() }, '+ Tambah video'),
    p.media.length ? h('div', { class: 'media-grid' },
      ...p.media.map((m) => {
        const thumb = h('div', { class: 'media-thumb' });
        const img = sheets.get(m.id)?.[0];
        if (img?.complete && img.naturalWidth) {
          thumb.style.backgroundImage = `url("${img.src}")`;
          thumb.style.backgroundSize = `${m.thumbs.tw * 10}px auto`;
          thumb.style.width = `${m.thumbs.tw}px`;
        }
        return h('div', { class: 'media-item' },
          thumb,
          h('div', { class: 'media-meta' },
            h('div', { class: 'media-name', title: m.path }, m.name),
            h('div', { class: 'muted small mono' }, `${tc(m.durationMs)} · ${m.width}×${m.height}`),
          ),
          h('button', {
            class: 'icon-btn add', title: 'Tambahkan ke akhir timeline', 'aria-label': `Tambahkan ${m.name} ke timeline`,
            onclick: () => {
              snapshot();
              tl().clips.push({ id: uid(), mediaId: m.id, inMs: 0, outMs: m.durationMs, speed: 1, volume: 1, fit: m.width / m.height < 0.7 ? 'fill' : 'fit' });
              changed();
              fitZoom();
            },
          }, '+'),
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
];

function textPanel(): Node[] {
  return [
    h('p', { class: 'muted small hint-p' }, 'Teks muncul di posisi playhead selama 3 detik. Geser di preview untuk memindahkan.'),
    h('div', { class: 'preset-grid' },
      ...TEXT_PRESETS.map((pr) => {
        const st = { ...DEFAULT_TEXT, ...pr.style };
        return h('button', {
          class: 'preset', style: `font-family:"${st.font}";font-weight:${st.bold ? 700 : 400};color:${st.color};${st.box ? 'background:rgba(0,0,0,.6);' : `-webkit-text-stroke:1px #000;`}`,
          onclick: () => addText(st),
        }, pr.name);
      }),
    ),
  ];
}

function addText(style: TextStyle) {
  if (!P) return;
  snapshot();
  const total = Math.max(3000, timelineDuration(tl()));
  const start = Math.round(clamp(t, 0, total - 500));
  const item: TextItem = { id: uid(), startMs: start, endMs: Math.min(total, start + 3000), text: 'Ketik teks', x: 0.5, y: 0.2, style: { ...style } };
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
      action,
      downloading >= 0 ? h('div', {}, h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', id: 'dl-bar', style: `width:${Math.round(downloading * 100)}%` })), h('div', { class: 'muted small', id: 'dl-label' }, 'Mengunduh model…')) : null,
      !hasClips ? h('div', { class: 'muted small' }, 'Tambahkan video ke timeline dulu.') : null,
    ),
    h('div', { class: 'block' },
      h('div', { class: 'label' }, 'Gaya'),
      h('div', { class: 'seg' },
        h('button', { class: cap.mode === 'word' ? 'on' : '', onclick: () => { snapshot(); cap.mode = 'word'; changed({ left: true, inspector: false }); } }, 'Kata menyala'),
        h('button', { class: cap.mode === 'line' ? 'on' : '', onclick: () => { snapshot(); cap.mode = 'line'; changed({ left: true, inspector: false }); } }, 'Per kalimat'),
      ),
      ...styleControls(st, styleSet, cap.mode === 'word'),
      field('Posisi tinggi', h('input', { type: 'range', min: 8, max: 92, value: Math.round(cap.y * 100), oninput: (e) => { cap.y = Number((e.target as HTMLInputElement).value) / 100; void saveProject(p); renderFrame(); }, onchange: () => undefined })),
    ),
    cap.lines.length ? h('div', { class: 'block' },
      h('div', { class: 'row-between' },
        h('div', { class: 'label' }, `${cap.lines.length} baris`),
        h('button', { class: 'danger-ghost small', onclick: async () => { if (await dialog().ask('Hapus semua subtitle?', { title: 'Subtitle', kind: 'warning' })) { snapshot(); cap.lines = []; sel = null; changed({ left: true }); } } }, 'Hapus semua'),
      ),
      h('ol', { class: 'lines' }, ...cap.lines.map((l) => h('li', { class: sel?.kind === 'line' && sel.id === l.id ? 'sel' : '' },
        h('button', { class: 'line-time mono', onclick: () => { sel = { kind: 'line', id: l.id }; seek(l.startMs); renderInspector(); renderLeft(); } }, tc(l.startMs)),
        h('input', {
          value: l.words.map((w) => w.text).join(' '), 'aria-label': `Subtitle ${tc(l.startMs)}`,
          onfocus: () => { sel = { kind: 'line', id: l.id }; seek(l.startMs); renderInspector(); },
          onchange: (e) => { snapshot(); setLineText(l, (e.target as HTMLInputElement).value); changed({ inspector: false }); },
        }),
      ))),
    ) : h('span'),
  ];
}

function setLineText(l: CaptionLine, text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) { tl().captions.lines = tl().captions.lines.filter((x) => x.id !== l.id); return; }
  // keep the original word timing when the word count is unchanged, else spread evenly
  if (parts.length === l.words.length) { l.words = l.words.map((w, i) => ({ ...w, text: parts[i] })); return; }
  const d = (l.endMs - l.startMs) / parts.length;
  l.words = parts.map((w, i): Word => ({ text: w, startMs: Math.round(l.startMs + i * d), endMs: Math.round(l.startMs + (i + 1) * d) }));
}

async function runCaptions() {
  const p = P!;
  if (tl().captions.lines.length && !(await dialog().ask('Subtitle yang sekarang akan diganti. Lanjut?', { title: 'Buat ulang subtitle', kind: 'warning' }))) return;
  pause();
  try {
    const lines = await transcribe(p, settings.model, (msg, frac) => setBusy(`${msg}${frac >= 0 && !/%$/.test(msg) ? ` ${Math.round(frac * 100)}%` : ''}`));
    snapshot();
    tl().captions.lines = lines;
    changed({ left: true });
    toast(lines.length ? `${lines.length} baris subtitle dibuat. Klik barisnya untuk koreksi.` : 'Tidak ada ucapan yang terdengar.');
  } catch (e) {
    toast(`Subtitle gagal: ${(e as Error).message}`, 'error');
  } finally {
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
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.bold, onchange: (e) => set({ bold: (e.target as HTMLInputElement).checked }) }), 'Tebal'),
  ];
}

function renderInspector() {
  const el = $('#inspector');
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
          onchange: (e) => set({ speed: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4][Number((e.target as HTMLInputElement).value)] }),
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
          onchange: () => { void saveProject(P!); renderInspector(); },
        })),
        (clip.zoom ?? 1) > 1 ? h('div', { class: 'muted small' }, 'Geser di preview untuk mengarahkan zoom ke wajah atau momennya.') : h('div', { class: 'muted small' }, 'Tip punch-in: split di momen lucu, lalu zoom potongan itu 130–160%.'),
        (clip.zoom ?? 1) > 1 ? h('button', { class: 'ghost small', onclick: () => set({ zoom: 1, zx: 0.5, zy: 0.5 }) }, 'Reset zoom') : h('span'),
      ),
      h('div', { class: 'block' },
        h('button', { class: 'secondary wide', onclick: splitHere }, '✂ Split di playhead'),
        h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus potongan'),
      ),
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
        h('button', { class: 'secondary wide', onclick: () => audition(snd.file, snd.volume) }, '▶ Dengarkan'),
        h('div', { class: 'muted small' }, 'Geser di timeline untuk memindah. Tarik ujung kanannya untuk memotong.'),
        h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus suara'),
      ),
    );
    return;
  }

  const img = selected('image');
  if (img) {
    el.replaceChildren(
      h('h3', {}, 'Gambar'),
      h('div', { class: 'muted small' }, img.name),
      h('div', { class: 'muted small mono' }, `${tc(img.startMs, true)} → ${tc(img.endMs, true)}`),
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
        img.animated ? h('div', { class: 'muted small' }, 'GIF tampil diam di preview, tapi bergerak di hasil ekspor.') : h('span'),
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
      h('div', { class: 'block' }, ...styleControls(text.style, set, false)),
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
      h('div', { class: 'muted small' }, 'Gaya semua subtitle diatur di tab Subtitle sebelah kiri.'),
      h('button', { class: 'danger-ghost wide', onclick: deleteSelected }, 'Hapus baris ini'),
    );
    return;
  }

  el.replaceChildren(
    h('h3', {}, 'Proyek'),
    field('Frame rate', h('div', { class: 'seg' },
      ...([30, 60] as const).map((f) => h('button', { class: tl().fps === f ? 'on' : '', onclick: () => { snapshot(); tl().fps = f; changed(); const fm = $('#fmt'); if (fm) fm.textContent = `${tl().width}×${tl().height} · ${f} fps`; } }, `${f} fps`)),
    )),
    h('div', { class: 'muted small' }, `Durasi ${tc(timelineDuration(tl()), true)} · ${tl().clips.length} potongan · ${tl().texts.length} teks · ${tl().captions.lines.length} baris subtitle`),
    watermarkBlock(),
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
  if (!P || !sel) { toast('Pilih dulu potongan, teks, atau subtitle di timeline.'); return; }
  snapshot();
  if (sel.kind === 'clip') tl().clips = tl().clips.filter((c) => c.id !== sel!.id);
  else if (sel.kind === 'text') tl().texts = tl().texts.filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'sound') tl().sounds = sounds().filter((x) => x.id !== sel!.id);
  else if (sel.kind === 'image') tl().images = images().filter((x) => x.id !== sel!.id);
  else tl().captions.lines = tl().captions.lines.filter((x) => x.id !== sel!.id);
  sel = null;
  changed({ left: tab === 'captions' });
}

// ================= preview engine =================

function videoFor(mediaId: string): HTMLVideoElement | null {
  let v = videos.get(mediaId);
  if (v) return v;
  const m = mediaOf(mediaId);
  if (!m) return null;
  v = h('video', { preload: 'auto', playsinline: true });
  v.src = fileSrc(m.playable);
  v.addEventListener('seeked', () => { if (!playing) renderFrame(); });
  v.addEventListener('loadeddata', () => { if (!playing) { syncVideo(); renderFrame(); } });
  v.addEventListener('error', () => toast(`Video ${m.name} tidak bisa diputar di preview (codec belum didukung). Ekspor tetap bisa.`, 'error'));
  videos.set(mediaId, v);
  return v;
}

let activeVideo: HTMLVideoElement | null = null;
let activeIndex = -1;

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
  v.playbackRate = c.speed;
  v.volume = clamp(c.volume, 0, 1);
  if (Math.abs(v.currentTime * 1000 - loc.sourceMs) > 40) v.currentTime = loc.sourceMs / 1000;
}

function seek(ms: number) {
  if (!P) return;
  t = clamp(ms, 0, Math.max(0, timelineDuration(tl()) - 1));
  syncVideo();
  if (playing && activeVideo) void activeVideo.play().catch(() => undefined);
  renderFrame();
  drawTimeline();
  updateTime();
}

function togglePlay() { if (playing) pause(); else play(); }

function play() {
  if (!P || !tl().clips.length) return;
  if (t >= timelineDuration(tl()) - 50) t = 0;
  playing = true;
  syncVideo();
  void activeVideo?.play().catch(() => undefined);
  const btn = $('#play');
  if (btn) { btn.textContent = '❚❚'; btn.setAttribute('aria-label', 'Jeda'); }
  requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  activeVideo?.pause();
  sfxEls.forEach((a) => a.pause());
  const btn = $('#play');
  if (btn) { btn.textContent = '▶'; btn.setAttribute('aria-label', 'Putar'); }
}

function tick() {
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
  }
  // keep the playhead in view
  const tb = $('#tl-body');
  if (tb) {
    const x = HEAD_W + (t / 1000) * pxPerSec - scrollX;
    if (x > tb.clientWidth - 40) scrollX += tb.clientWidth * 0.6;
  }
  syncSfx();
  renderFrame();
  drawTimeline();
  updateTime();
  requestAnimationFrame(tick);
}

interface Box { kind: 'text' | 'captions' | 'image'; id: string; x: number; y: number; w: number; h: number }
let boxes: Box[] = [];

function renderFrame() {
  if (!preview || !P) return;
  const ctx = preview.getContext('2d');
  if (!ctx) return;
  const W = preview.width, H = preview.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  boxes = [];
  const loc = locate(tl().clips, t);
  if (loc) {
    const c = tl().clips[loc.index];
    const v = videos.get(c.mediaId) ?? videoFor(c.mediaId);
    if (v && v.readyState >= 2 && v.videoWidth) {
      const vw = v.videoWidth, vh = v.videoHeight;
      const z = Math.max(1, c.zoom ?? 1);
      const s = c.fit === 'fill' ? Math.max((W * z) / vw, (H * z) / vh) : Math.min((W * z) / vw, (H * z) / vh);
      const dw = vw * s, dh = vh * s;
      const pw = Math.max(dw, W), ph = Math.max(dh, H);
      const ox = (pw - W) * (c.zx ?? 0.5), oy = (ph - H) * (c.zy ?? 0.5);
      ctx.drawImage(v, (pw - dw) / 2 - ox, (ph - dh) / 2 - oy, dw, dh);
    }
  } else {
    ctx.fillStyle = '#6b6b6b';
    ctx.font = '500 18px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tambahkan video dari tab Media', W / 2, H / 2);
  }
  const k = W / tl().width;
  for (const im of images()) {
    if (t < im.startMs || t >= im.endMs) continue;
    const el = imageEl(im.file);
    const w = im.scale * W, hh = w / im.aspect;
    const x = im.x * W - w / 2, y = im.y * H - hh / 2;
    const an = transState(im, t - im.startMs);
    if (el.complete && el.naturalWidth) {
      const aw = w * an.scale, ah = hh * an.scale;
      ctx.globalAlpha = an.alpha;
      ctx.drawImage(el, im.x * W - aw / 2, im.y * H - ah / 2 + an.dy * H, aw, ah);
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
      const w = wm.scale * W, hh = w / wm.aspect, m = 40 * k;
      ctx.globalAlpha = wm.opacity;
      ctx.drawImage(el, wm.corner.endsWith('l') ? m : W - w - m, wm.corner.startsWith('t') ? m + 60 * k : H - hh - m - 220 * k, w, hh);
      ctx.globalAlpha = 1;
    }
  }
  const cap = tl().captions;
  const line = cap.lines.find((l) => t >= l.startMs && t < l.endMs);
  if (line) {
    let active = -1;
    if (cap.mode === 'word') line.words.forEach((w, i) => { if (t >= w.startMs) active = i; });
    const segs = line.words.map((w, i) => ({ text: w.text, color: i === active ? cap.style.highlight : cap.style.color }));
    const b = drawText(ctx, wrapSegs(ctx, segs, cap.style, k, W * 0.9), W / 2, cap.y * H, cap.style, k);
    boxes.push({ kind: 'captions', id: line.id, ...b });
  }
  for (const x of tl().texts) {
    if (t < x.startMs || t >= x.endMs || !x.text.trim()) continue;
    const lines = x.text.split('\n').flatMap((l) => wrapSegs(ctx, l.split(/\s+/).filter(Boolean).map((w) => ({ text: w, color: x.style.color })), x.style, k, W * 0.92));
    const b = drawText(ctx, lines, x.x * W, x.y * H, x.style, k);
    boxes.push({ kind: 'text', id: x.id, ...b });
    if (sel?.kind === 'text' && sel.id === x.id) {
      ctx.strokeStyle = '#ff6a1a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.setLineDash([]);
    }
  }
}

type Seg = { text: string; color: string };
const fontOf = (st: TextStyle, k: number) => `${st.bold ? 700 : 400} ${st.size * k}px "${st.font}", "Segoe UI", sans-serif`;

function wrapSegs(ctx: CanvasRenderingContext2D, segs: Seg[], st: TextStyle, k: number, maxW: number): Seg[][] {
  ctx.font = fontOf(st, k);
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

function drawText(ctx: CanvasRenderingContext2D, lines: Seg[][], cx: number, cy: number, st: TextStyle, k: number) {
  ctx.font = fontOf(st, k);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  const lh = st.size * k * 1.18;
  const widths = lines.map((l) => l.reduce((s, x, i) => s + ctx.measureText(x.text).width + (i ? space : 0), 0));
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
      if (!st.box && st.outline > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = st.outline * 2 * k;
        ctx.strokeStyle = '#000';
        ctx.strokeText(s.text, x, y);
      }
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, x, y);
      x += ctx.measureText(s.text).width + space;
    }
  });
  return { x: cx - maxW / 2, y: top, w: maxW, h: totalH };
}

/** Drag text (or the captions) around on the preview. */
function setupPreviewDrag() {
  let pan: { c: VideoClip; sx: number; sy: number; ox: number; oy: number } | null = null;
  let drag: { box: Box; sx: number; sy: number; ox: number; oy: number } | null = null;
  const toCanvas = (e: PointerEvent) => {
    const r = preview.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * preview.width, y: ((e.clientY - r.top) / r.height) * preview.height };
  };
  preview.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const hit = [...boxes].reverse().find((b) => p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10);
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
    const p = toCanvas(e);
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
  const end = () => { if (drag || pan) { void saveProject(P!); drag = null; pan = null; } };
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

interface Lane { kind: 'text' | 'image' | 'captions' | 'main' | 'sound'; y: number; h: number }
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
  y += GAP - 3;
  lanes.push({ kind: 'captions', y, h: ROW_CAP }); y += ROW_CAP + GAP;
  lanes.push({ kind: 'main', y, h: ROW_MAIN }); y += ROW_MAIN + GAP;
  for (let i = 0; i < nSnd; i++) { lanes.push({ kind: 'sound', y, h: ROW_SOUND }); y += ROW_SOUND + 3; }
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
  if (z) z.value = String(Math.round((Math.log(pxPerSec / 2) / Math.log(300)) * 100));
  if (body) drawTimeline();
}
function setZoomFromSlider(v: number) { zoomBy((2 * Math.pow(300, v / 100)) / pxPerSec); }
function fitZoom() {
  const body = $('#tl-body');
  if (!body || !P) return;
  const total = Math.max(5000, timelineDuration(tl()));
  pxPerSec = clamp(((body.clientWidth - 60) / total) * 1000, 2, 600);
  scrollX = 0;
  const z = $<HTMLInputElement>('#zoom');
  if (z) z.value = String(Math.round((Math.log(pxPerSec / 2) / Math.log(300)) * 100));
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
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), hh, Math.min(r, w / 2));
}

function drawTimeline() {
  if (!tlCanvas || !P) return;
  const ctx = tlCanvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = tlCanvas.width / dpr, H = tlCanvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, W, H);
  computeLanes();

  // lane backgrounds
  for (const l of lanes) {
    ctx.fillStyle = l.kind === 'main' ? '#1c1c1c' : '#191919';
    ctx.fillRect(0, l.y, W, l.h);
  }
  ctx.fillStyle = '#6b6b6b';
  ctx.font = '500 10px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const lt = laneOf('text'), lc = laneOf('captions');
  if (!tl().texts.length) ctx.fillText('TEKS', 8, lt.y + lt.h / 2);
  if (!tl().captions.lines.length) ctx.fillText('SUBTITLE', 8, lc.y + lc.h / 2);
  const li = laneOf('image'), ls = laneOf('sound');
  if (!images().length) ctx.fillText('GAMBAR', 8, li.y + li.h / 2);
  if (!sounds().length) ctx.fillText('SUARA · tekan 1–9 atau pad Soundboard', 8, ls.y + ls.h / 2);

  // ruler
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, W, RULER);
  const step = niceStep();
  ctx.font = '10px "JetBrains Mono", Consolas, monospace';
  for (let ms = Math.floor(xToMs(0) / step) * step; msToX(ms) < W; ms += step) {
    if (ms < 0) continue;
    const x = msToX(ms);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(x, RULER - 7, 1, 7);
    ctx.fillStyle = '#a3a3a3';
    ctx.fillText(step < 1000 ? tc(ms, true) : tc(ms), x + 3, 9);
    for (let s = 1; s < 5; s++) { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + (s * step * pxPerSec) / 5000, RULER - 3, 1, 3); }
  }

  // main track: clips with filmstrip
  const lm = laneOf('main');
  const starts = clipStarts(tl().clips);
  tl().clips.forEach((c, i) => {
    const x = msToX(starts[i]), w = (clipDuration(c) / 1000) * pxPerSec;
    if (x + w < 0 || x > W) return;
    const isSel = sel?.kind === 'clip' && sel.id === c.id;
    ctx.save();
    roundRect(ctx, x + 1, lm.y, w - 2, lm.h, 5);
    ctx.clip();
    ctx.fillStyle = '#2b2b2b';
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
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(x, lm.y + lm.h - 16, w, 16);
    ctx.fillStyle = '#ededed';
    ctx.font = '500 10px "Segoe UI", sans-serif';
    const label = `${c.speed !== 1 ? `${c.speed}× · ` : ''}${tc(clipDuration(c), true)}`;
    ctx.fillText(label, x + 6, lm.y + lm.h - 8);
    ctx.restore();
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#ffffff' : '#000';
    roundRect(ctx, x + 1, lm.y, w - 2, lm.h, 5);
    ctx.stroke();
    if (isSel) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 1, lm.y + lm.h / 2 - 10, 4, 20);
      ctx.fillRect(x + w - 5, lm.y + lm.h / 2 - 10, 4, 20);
    }
  });

  // captions
  for (const l of tl().captions.lines) {
    const x = msToX(l.startMs), w = ((l.endMs - l.startMs) / 1000) * pxPerSec;
    if (x + w < 0 || x > W) continue;
    const isSel = sel?.kind === 'line' && sel.id === l.id;
    roundRect(ctx, x + 0.5, lc.y, w - 1, lc.h, 4);
    ctx.fillStyle = isSel ? '#ffd400' : '#3d3520';
    ctx.fill();
    if (w > 24) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, lc.y, w - 4, lc.h); ctx.clip();
      ctx.fillStyle = isSel ? '#121212' : '#f2d98c';
      ctx.font = '500 10px "Segoe UI", sans-serif';
      ctx.fillText(l.words.map((q) => q.text).join(' '), x + 5, lc.y + lc.h / 2);
      ctx.restore();
    }
  }

  // texts
  for (const x of tl().texts) {
    const ln = laneOf('text', textRows.get(x.id) ?? 0);
    const xx = msToX(x.startMs), w = ((x.endMs - x.startMs) / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    const isSel = sel?.kind === 'text' && sel.id === x.id;
    roundRect(ctx, xx + 0.5, ln.y, w - 1, ln.h, 4);
    ctx.fillStyle = isSel ? '#ff6a1a' : '#4a2a18';
    ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(xx, ln.y, w - 4, ln.h); ctx.clip();
    ctx.fillStyle = isSel ? '#121212' : '#ffc29e';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillText(`T  ${x.text.replace(/\n/g, ' ')}`, xx + 6, ln.y + ln.h / 2);
    ctx.restore();
    if (isSel) {
      ctx.fillStyle = '#121212';
      ctx.fillRect(xx + 2, ln.y + 6, 2, ln.h - 12);
      ctx.fillRect(xx + w - 4, ln.y + 6, 2, ln.h - 12);
    }
  }

  // meme pictures
  for (const im of images()) {
    const ln = laneOf('image', textRows.get(im.id) ?? 0);
    const xx = msToX(im.startMs), w = ((im.endMs - im.startMs) / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    const isSel = sel?.kind === 'image' && sel.id === im.id;
    roundRect(ctx, xx + 0.5, ln.y, w - 1, ln.h, 4);
    ctx.fillStyle = isSel ? '#2ec4b6' : '#173d3a';
    ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(xx, ln.y, w - 4, ln.h); ctx.clip();
    const el = imageEl(im.file);
    if (el.complete && el.naturalWidth) ctx.drawImage(el, xx + 3, ln.y + 3, (ln.h - 6) * im.aspect, ln.h - 6);
    ctx.fillStyle = isSel ? '#121212' : '#9ee6df';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillText(im.name, xx + 8 + (ln.h - 6) * im.aspect, ln.y + ln.h / 2);
    ctx.restore();
  }

  // sound effects
  for (const sn of sounds()) {
    const ln = laneOf('sound', textRows.get(sn.id) ?? 0);
    const xx = msToX(sn.startMs), w = (sn.lengthMs / 1000) * pxPerSec;
    if (xx + w < 0 || xx > W) continue;
    const isSel = sel?.kind === 'sound' && sel.id === sn.id;
    roundRect(ctx, xx + 0.5, ln.y, Math.max(6, w - 1), ln.h, 4);
    ctx.fillStyle = isSel ? '#4cc38a' : '#1d3a2b';
    ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(xx, ln.y, Math.max(6, w - 4), ln.h); ctx.clip();
    ctx.fillStyle = isSel ? '#121212' : '#a6e8c6';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillText(`♪ ${sn.name}`, xx + 5, ln.y + ln.h / 2);
    ctx.restore();
  }

  // drop marker while dragging a clip
  if (dropX !== null) {
    ctx.fillStyle = '#ff6a1a';
    ctx.fillRect(dropX - 1, lm.y - 4, 3, lm.h + 8);
  }

  // playhead
  const px = msToX(t);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px - 0.5, 0, 1.5, H);
  ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px + 6, 8); ctx.lineTo(px, 14); ctx.lineTo(px - 6, 8); ctx.fill();
}

let dropX: number | null = null;

type Hit = { kind: SelKind; id: string; edge: 'in' | 'out' | null } | null;

function hitTest(x: number, y: number): Hit {
  const EDGE = 7;
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
    ['sound', 'sound', sounds().map((q) => ({ id: q.id, startMs: q.startMs, endMs: soundEnd(q) }))],
  ];
  for (const [kind, laneKind, items] of groups) {
    for (const x2 of items) {
      const ln = laneOf(laneKind, textRows.get(x2.id) ?? 0);
      if (y < ln.y || y > ln.y + ln.h) continue;
      const a = msToX(x2.startMs), b = Math.max(a + 6, msToX(x2.endMs));
      if (x >= a && x <= b) {
        const edge = x - a < EDGE && kind !== 'sound' ? 'in' : b - x < EDGE ? 'out' : null;
        return { kind, id: x2.id, edge };
      }
    }
  }
  return null;
}

/** Start/end of any movable item, and a setter, so one drag handler serves them all. */
function span(kind: SelKind, id: string): { a: number; b: number; set: (a: number, b: number) => void; max: number } | null {
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
    | { mode: 'item'; kind: SelKind; id: string; edge: 'in' | 'out' | null; sx: number; a: number; b: number };
  let drag: Drag | null = null;
  const pos = (e: MouseEvent) => { const r = tlCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  tlCanvas.addEventListener('pointerdown', (e) => {
    if (!P) return;
    const { x, y } = pos(e);
    tlCanvas.setPointerCapture(e.pointerId);
    if (y < RULER) { drag = { mode: 'scrub' }; seek(xToMs(x)); return; }
    const hit = hitTest(x, y);
    if (!hit) { sel = null; renderInspector(); drag = { mode: 'scrub' }; seek(xToMs(x)); if (tab === 'captions') renderLeft(); return; }
    sel = { kind: hit.kind, id: hit.id };
    snapshot();
    if (hit.kind === 'clip') {
      const c = tl().clips.find((q) => q.id === hit.id)!;
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
      if (hit.kind !== 'sound' && (t < sp.a || t >= sp.b)) seek(sp.a);
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
      const total = Math.max(timelineDuration(tl()), drag.b);
      const len = drag.b - drag.a;
      if (drag.edge === 'in') sp.set(Math.round(clamp(snapMs(drag.a + dms, drag.id), 0, drag.b - 100)), drag.b);
      else if (drag.edge === 'out') sp.set(drag.a, Math.round(clamp(snapMs(drag.b + dms, drag.id), drag.a + 100, Math.min(drag.kind === 'sound' ? drag.a + sp.max : Infinity, Math.max(total, drag.b)))));
      else {
        let a = snapMs(drag.a + dms, drag.id);
        if (a === drag.a + dms) a = snapMs(drag.b + dms, drag.id) - len;
        a = Math.round(clamp(a, 0, Math.max(0, total - (drag.kind === 'sound' ? 50 : len))));
        sp.set(a, a + len);
      }
      drawTimeline();
      renderFrame();
    }
  });

  const end = (e: PointerEvent) => {
    if (!drag || !P) { drag = null; return; }
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
      const maxScroll = Math.max(0, (timelineDuration(tl()) / 1000) * pxPerSec - tlCanvas.clientWidth + 120);
      scrollX = clamp(scrollX + (e.deltaX || e.deltaY), 0, maxScroll);
      drawTimeline();
    }
  }, { passive: false });
}

// ================= soundboard & meme libraries =================

const imageEls = new Map<string, HTMLImageElement>();
function imageEl(file: string) {
  let el = imageEls.get(file);
  if (!el) {
    el = new Image();
    el.src = fileSrc(file);
    el.onload = () => { renderFrame(); drawTimeline(); };
    imageEls.set(file, el);
  }
  return el;
}

let auditionEl: HTMLAudioElement | null = null;
function audition(file: string, volume = 1) {
  auditionEl?.pause();
  auditionEl = new Audio(fileSrc(file));
  auditionEl.volume = clamp(volume, 0, 1);
  void auditionEl.play().catch(() => undefined);
}

const sfxEls = new Map<string, HTMLAudioElement>();
/** Plays the sound items under the playhead while the preview runs. */
function syncSfx() {
  for (const s of sounds()) {
    let a = sfxEls.get(s.id);
    const inside = t >= s.startMs && t < soundEnd(s);
    if (!inside) { if (a && !a.paused) a.pause(); continue; }
    if (!a) { a = new Audio(fileSrc(s.file)); a.preload = 'auto'; sfxEls.set(s.id, a); }
    a.volume = clamp(s.volume, 0, 1);
    const want = (t - s.startMs) / 1000;
    if (a.paused) { a.currentTime = want; void a.play().catch(() => undefined); }
    else if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
  }
}

function switchTab(k: LeftTab) {
  tab = k;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === k));
  renderLeft();
}

async function addToLibrary(paths: string[]) {
  setBusy('Menambahkan ke library…');
  try {
    const r = await importLibFiles(paths);
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
  if (!tl().clips.length) { toast('Tambahkan video ke timeline dulu.'); return; }
  const snd = soundOf(pad);
  if (!snd) { toast('File suara pad ini hilang dari library.'); return; }
  snapshot();
  sounds().push({ id: uid(), file: snd.file, name: pad.name, startMs: Math.floor(t), lengthMs: snd.durationMs, sourceMs: snd.durationMs, volume: 1 });
  if (!playing) audition(snd.file);
  changed({ inspector: false });
  flash(pad.id);
}

/** Drops a meme picture at the playhead with its default animations. */
function insertMeme(m: Meme) {
  if (!P) return;
  if (!tl().clips.length) { toast('Tambahkan video ke timeline dulu.'); return; }
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
    }, kind === 'sound' ? '+ Tambah suara' : '+ Tambah meme'),
    h('button', { class: libEdit ? 'secondary on-accent-border' : 'ghost', onclick: () => { libEdit = !libEdit; renderLeft(); } }, libEdit ? 'Selesai' : 'Atur'),
  );
}

function orderButtons<T>(list: T[], i: number) {
  return [
    h('button', { class: 'icon-btn', 'aria-label': 'Naik', disabled: i === 0, onclick: () => { move(list, i, i - 1); renderLeft(); } }, '↑'),
    h('button', { class: 'icon-btn', 'aria-label': 'Turun', disabled: i === list.length - 1, onclick: () => { move(list, i, i + 1); renderLeft(); } }, '↓'),
  ];
}

function soundPanel(): Node[] {
  if (!library) return [h('p', { class: 'muted small hint-p' }, 'Memuat library…')];
  const L = library;
  if (!libEdit) {
    return [
      h('p', { class: 'muted small hint-p' }, 'Pause di momennya, pencet pad atau angka 1–9, lalu lanjut putar.'),
      libHead('sound'),
      L.pads.length ? h('div', { class: 'pads' },
        ...L.pads.map((pad, i) => h('div', { class: 'pad-wrap' },
          h('button', { class: 'pad', 'data-pad': pad.id, style: `--pad:${pad.color}`, title: `${pad.name}${i < 9 ? ` (tombol ${i + 1})` : ''}`, onclick: () => insertSound(pad) },
            h('span', { class: 'pad-name' }, pad.name),
            h('span', { class: 'pad-meta' }, tc(soundOf(pad)?.durationMs ?? 0, true)),
            i < 9 ? h('span', { class: 'pad-key' }, String(i + 1)) : null,
          ),
          h('button', { class: 'pad-play', title: 'Dengarkan', 'aria-label': `Dengarkan ${pad.name}`, onclick: (e) => { e.stopPropagation(); const s = soundOf(pad); if (s) audition(s.file); } }, '▶'),
        )),
      ) : h('p', { class: 'muted small' }, 'Belum ada suara. Tarik file MP3/WAV/OGG ke jendela.'),
    ];
  }
  return [
    h('p', { class: 'muted small hint-p' }, 'Urutan menentukan tombol 1–9.'),
    libHead('sound'),
    ...L.pads.map((pad, i) => h('div', { class: 'pad-edit' },
      h('div', { class: 'row-between' },
        h('input', { value: pad.name, 'aria-label': 'Nama suara', onchange: async (e) => { pad.name = (e.target as HTMLInputElement).value.trim() || pad.name; await saveLibrary(); } }),
        h('input', { type: 'color', value: pad.color, class: 'pad-color', 'aria-label': 'Warna pad', onchange: async (e) => { pad.color = (e.target as HTMLInputElement).value; await saveLibrary(); } }),
      ),
      h('div', { class: 'row-between' },
        h('span', { class: 'muted small' }, i < 9 ? `Tombol ${i + 1}` : 'Tanpa tombol'),
        h('div', {}, ...orderButtons(L.pads, i),
          h('button', {
            class: 'icon-btn', 'aria-label': `Hapus ${pad.name}`, onclick: async () => {
              if (!(await dialog().ask(`Hapus "${pad.name}" dari library?\nYang sudah ada di timeline tetap aman.`, { title: 'Hapus suara', kind: 'warning' }))) return;
              await deletePad(pad.id); library = await loadLibrary(); renderLeft();
            },
          }, '✕'),
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
      h('p', { class: 'muted small hint-p' }, 'Pause di momennya, klik meme atau Shift + 1–9. Gambar muncul dengan animasi masuk dan keluar.'),
      libHead('meme'),
      L.memes.length ? h('div', { class: 'memes' },
        ...L.memes.map((m, i) => h('button', { class: 'meme', 'data-pad': m.id, title: `${m.name}${i < 9 ? ` (Shift+${i + 1})` : ''}`, onclick: () => insertMeme(m) },
          h('img', { src: fileSrc(m.file), alt: m.name, loading: 'lazy' }),
          h('span', { class: 'meme-name' }, m.name),
          i < 9 ? h('span', { class: 'pad-key' }, `⇧${i + 1}`) : null,
        )),
      ) : h('p', { class: 'muted small' }, 'Belum ada meme. Tarik gambar PNG/JPG/GIF ke jendela.'),
    ];
  }
  return [
    h('p', { class: 'muted small hint-p' }, 'Atur default tiap meme. Urutan menentukan Shift + 1–9.'),
    libHead('meme'),
    ...L.memes.map((m, i) => h('div', { class: 'pad-edit' },
      h('div', { class: 'row-between' },
        h('img', { class: 'meme-mini', src: fileSrc(m.file), alt: '' }),
        h('input', { value: m.name, 'aria-label': 'Nama meme', onchange: async (e) => { m.name = (e.target as HTMLInputElement).value.trim() || m.name; await saveLibrary(); } }),
      ),
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
          }, '✕'),
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
    h('div', { class: 'row-between' }, h('h3', {}, 'Ekspor'), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: toggleExport }, '✕')),
    h('div', { class: 'muted small' }, `${tl().width}×${tl().height} · ${tl().fps} fps · MP4 H.264 · ${tc(d, true)}`),
    d > 180000 ? h('div', { class: 'warn small' }, 'Lebih dari 3 menit: YouTube Shorts membatasi 3 menit. TikTok masih bisa.') : h('span'),
    h('div', { class: 'muted small' }, `Encoder: ${settings.encoder ? ENCODER_LABEL[settings.encoder] : 'mengecek…'}`),
    h('button', {
      class: 'ghost small path', title: settings.outDir,
      onclick: async () => {
        const dir = await dialog().open({ directory: true, title: 'Folder hasil ekspor' });
        if (typeof dir === 'string') { settings.outDir = dir; await saveSettings(settings); renderExport(); }
      },
    }, `📁 ${settings.outDir}`),
    h('button', {
      class: 'primary wide', disabled: !tl().clips.length,
      onclick: async () => {
        pause();
        try {
          await flush();
          await enqueueExport(P!, { outDir: settings.outDir, encoder: settings.encoder || (await detectEncoder()) });
        } catch (e) { toast((e as Error).message, 'error'); }
      },
    }, 'Ekspor video'),
    h('div', { id: 'queue' }),
  );
  renderQueue();
}

function renderQueue() {
  const el = $('#queue');
  const btn = $('#export-btn');
  const run = queue.find((j) => j.status === 'running');
  if (btn) btn.textContent = run ? `Ekspor ${Math.round(run.progress * 100)}%` : 'Ekspor';
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
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (!ctrl && !e.altKey && digit && library) {
    const n = Number(digit[1]) - 1;
    if (e.shiftKey) { const m = library.memes[n]; if (m) { e.preventDefault(); insertMeme(m); } }
    else { const pad = library.pads[n]; if (pad) { e.preventDefault(); insertSound(pad); } }
    return;
  }
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seek(t - (e.shiftKey ? 1000 : frame)); break;
    case 'ArrowRight': e.preventDefault(); pause(); seek(t + (e.shiftKey ? 1000 : frame)); break;
    case 'Home': seek(0); break;
    case 'End': seek(timelineDuration(tl())); break;
    case 'Escape': sel = null; renderInspector(); drawTimeline(); renderFrame(); break;
    case '=': case '+': zoomBy(1.25); break;
    case '-': zoomBy(0.8); break;
  }
}

window.addEventListener('beforeunload', () => void flush());
void boot();
