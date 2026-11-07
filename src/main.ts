import './styles.css';
import { dialog, fileSrc, invoke, isTauri, join, onDrop, baseName } from './tauri';
import { type Layout, type Rect, splitHeights } from './ffmpeg';
import {
  deleteProject, flush, listProjects, loadProject, loadSettings, projectDir, saveProject, saveSettings, uid,
  type Clip, type Project, type Settings,
} from './store';
import {
  ENCODER_LABEL, PRESET_LIMIT_SEC, buildThumbs, buildWaveform, cancelExport, detectEncoder, enqueueExport,
  importVideo, loadWaveform, onQueueChange, queue, stripEmoji, type Preset,
} from './jobs';
import { moveRect, normalize, partAspect, resizeRect, withType, type Part } from './layout';

// ---------------- tiny DOM helper ----------------

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const app = document.getElementById('app')!;

function tc(ms: number, withMs = false): string {
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const ff = Math.floor((ms % 1000) / 100);
  const base = `${hh > 0 ? `${hh}:` : ''}${String(mm).padStart(hh > 0 ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
  return (neg ? '-' : '') + base + (withMs ? `.${ff}` : '');
}
function parseTc(s: string): number | null {
  const parts = s.trim().split(':').map((x) => x.trim());
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + Number(p);
  return Math.round(sec * 1000);
}

function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 7000 : 3000);
  setTimeout(() => t.remove(), kind === 'error' ? 7400 : 3400);
}

// ---------------- state ----------------

let settings: Settings = { outDir: '', encoder: '', fps: 0 };
let project: Project | null = null;
let wave: Uint8Array | null = null;
let selectedId: string | null = null;
let markIn: number | null = null;
let markOut: number | null = null;
let view = { start: 0, end: 60000 };
let status = { text: '', frac: -1 };
let preset: Preset = 'tiktok';
const sheets: HTMLImageElement[] = [];

const selected = (): Clip | null => project?.clips.find((c) => c.id === selectedId) ?? null;
const editingLayout = (): Layout => (selected()?.layout ?? project!.defaultLayout);

function setLayout(l: Layout) {
  if (!project) return;
  const c = selected();
  if (c) c.layout = l; else project.defaultLayout = l;
  void saveProject(project);
  drawOverlay();
  drawPreview();
}

// ---------------- boot ----------------

async function boot() {
  if (!isTauri()) {
    app.append(h('div', { class: 'center-msg' }, 'Buka lewat aplikasi GALSURKU Clipper.'));
    return;
  }
  settings = await loadSettings();
  void onDrop((paths) => { if (paths[0]) void startImport(paths[0]); });
  onQueueChange(renderQueue);
  window.addEventListener('keydown', onKey);
  await renderHome();
  if (!settings.encoder) {
    settings.encoder = await detectEncoder();
    await saveSettings(settings);
    $('#enc')?.replaceChildren(ENCODER_LABEL[settings.encoder]);
  }
}

// ---------------- home ----------------

async function renderHome() {
  await flush();
  project = null;
  wave = null;
  selectedId = null;
  const list = await listProjects();
  app.replaceChildren(
    h('header', { class: 'bar' },
      h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'GALSURKU Clipper'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'muted', id: 'enc' }, settings.encoder ? ENCODER_LABEL[settings.encoder] : 'Mengecek GPU…'),
    ),
    h('main', { class: 'home' },
      h('button', { class: 'drop', onclick: () => void pickFile() },
        h('div', { class: 'drop-title' }, 'Import rekaman live'),
        h('div', { class: 'muted' }, 'Klik, atau tarik file MP4 / MKV dari OBS ke jendela ini'),
      ),
      h('div', { id: 'import-status', class: 'muted' }),
      list.length ? h('h2', {}, 'Proyek terakhir') : null,
      h('ul', { class: 'projects' },
        ...list.map((p) => h('li', {},
          h('button', { class: 'proj', onclick: () => void openProject(p.id) },
            h('div', { class: 'proj-name' }, p.name),
            h('div', { class: 'muted' }, `${tc(p.durationMs)} · ${p.clips} klip · ${baseName(p.source)}`),
          ),
          h('button', {
            class: 'icon-btn', title: 'Hapus proyek (file video asli tidak dihapus)', 'aria-label': `Hapus proyek ${p.name}`,
            onclick: async () => {
              if (await dialog().ask(`Hapus proyek "${p.name}"?\nFile video asli tetap aman.`, { title: 'Hapus proyek', kind: 'warning' })) {
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

async function pickFile() {
  const f = await dialog().open({ title: 'Pilih rekaman live', filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'flv', 'ts', 'm4v'] }] });
  if (typeof f === 'string') await startImport(f);
}

let importing = false;
async function startImport(path: string) {
  if (importing) return;
  importing = true;
  const out = $('#import-status');
  try {
    const p = await importVideo(path, (msg, frac) => {
      if (out) out.textContent = frac !== undefined ? `${msg} ${Math.round(frac * 100)}%` : msg;
    });
    await saveProject(p, true);
    await openProject(p.id);
  } catch (e) {
    if (out) out.textContent = '';
    await dialog().message((e as Error).message, { title: 'Import gagal', kind: 'error' });
  } finally {
    importing = false;
  }
}

// ---------------- editor ----------------

async function openProject(id: string) {
  const p = await loadProject(id);
  if (!p) { toast('Proyek tidak ditemukan.', 'error'); return; }
  if (!(await invoke<boolean>('exists', { path: p.playable }))) {
    await dialog().message(`File videonya tidak ditemukan:\n${p.playable}\n\nKalau filenya dipindah, import ulang dari lokasi baru.`, { title: 'Video hilang', kind: 'error' });
    return;
  }
  project = p;
  selectedId = null;
  markIn = markOut = null;
  view = { start: 0, end: Math.min(p.durationMs, 10 * 60000) };
  renderEditor();
  void loadCaches();
}

async function loadCaches() {
  const p = project!;
  const dir = await projectDir(p.id);
  try {
    if (!p.thumbs.ready) {
      setStatus('Membuat thumbnail timeline…', 0);
      await buildThumbs(p, (f) => setStatus('Membuat thumbnail timeline…', f));
      await saveProject(p);
    }
    sheets.length = 0;
    for (let i = 1; i <= p.thumbs.sheets; i++) {
      const img = new Image();
      img.src = fileSrc(join(dir, `thumbs_${String(i).padStart(3, '0')}.jpg`));
      img.onload = () => drawTimeline();
      sheets.push(img);
    }
    wave = p.waveformReady ? await loadWaveform(p) : null;
    if (!wave) {
      setStatus('Membaca gelombang suara…', 0);
      wave = await buildWaveform(p, (f) => setStatus('Membaca gelombang suara…', f));
      await saveProject(p);
    }
    setStatus('', -1);
  } catch (e) {
    setStatus('', -1);
    toast(`Timeline tidak lengkap: ${(e as Error).message}`, 'error');
  }
  drawTimeline();
}

function setStatus(text: string, frac: number) {
  status = { text, frac };
  const el = $('#status');
  if (el) el.textContent = text ? (frac >= 0 ? `${text} ${Math.round(Math.min(1, frac) * 100)}%` : text) : '';
}

let video: HTMLVideoElement;
let tl: HTMLCanvasElement;
let preview: HTMLCanvasElement;
let overlay: HTMLDivElement;

function renderEditor() {
  const p = project!;
  video = h('video', { class: 'player', src: fileSrc(p.playable), preload: 'auto' });
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('seeked', () => { onTime(); drawPreview(); });
  video.addEventListener('loadeddata', () => { drawPreview(); drawOverlay(); });
  video.addEventListener('play', () => { renderTransport(); loopPreview(); });
  video.addEventListener('pause', () => renderTransport());
  video.addEventListener('error', () => toast('Video tidak bisa diputar di aplikasi. Format atau codec mungkin tidak didukung.', 'error'));
  overlay = h('div', { class: 'overlay' });
  tl = h('canvas', { class: 'timeline', 'aria-label': 'Timeline rekaman' });
  preview = h('canvas', { class: 'preview', width: 270, height: 480, 'aria-label': 'Preview 9:16' });

  app.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'ghost', onclick: () => void renderHome() }, '← Proyek'),
      h('input', {
        class: 'title-input', value: p.name, 'aria-label': 'Nama proyek',
        onchange: (e) => { p.name = (e.target as HTMLInputElement).value.trim() || p.name; void saveProject(p); },
      }),
      h('span', { class: 'muted' }, `${p.width}×${p.height} · ${p.fps} fps · ${tc(p.durationMs)}`),
      h('div', { class: 'spacer' }),
      h('span', { class: 'muted', id: 'status' }),
      h('span', { class: 'muted', id: 'enc' }, settings.encoder ? ENCODER_LABEL[settings.encoder] : ''),
    ),
    h('div', { class: 'editor' },
      h('aside', { class: 'clips' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Klip'), h('span', { class: 'muted', id: 'clip-count' })),
        h('ul', { id: 'clip-list' }),
        h('div', { class: 'hint muted' },
          h('div', {}, h('kbd', {}, 'I'), ' awal  ', h('kbd', {}, 'O'), ' akhir  ', h('kbd', {}, 'Enter'), ' buat klip'),
          h('div', {}, h('kbd', {}, 'Spasi'), ' putar  ', h('kbd', {}, 'J'), h('kbd', {}, 'L'), ' ±5 dtk  ', h('kbd', {}, '←'), h('kbd', {}, '→'), ' ±1 dtk'),
        ),
      ),
      h('section', { class: 'stage' },
        h('div', { class: 'player-wrap' }, video, overlay),
        h('div', { class: 'transport', id: 'transport' }),
        h('div', { class: 'tl-wrap' }, tl),
      ),
      h('aside', { class: 'inspector', id: 'inspector' }),
    ),
  );
  setupTimeline();
  setupOverlay();
  new ResizeObserver(() => { sizeTimeline(); drawOverlay(); }).observe(app.querySelector('.stage')!);
  renderClipList();
  renderTransport();
  renderInspector();
  setStatus(status.text, status.frac);
}

function onTime() {
  drawTimeline();
  const t = $('#time');
  if (t) t.textContent = `${tc(video.currentTime * 1000, true)} / ${tc(project!.durationMs)}`;
  // keep the playhead in view while playing
  const ms = video.currentTime * 1000;
  if (!video.paused && (ms > view.end || ms < view.start)) {
    const span = view.end - view.start;
    view.start = Math.max(0, ms - span * 0.1);
    view.end = view.start + span;
  }
}

function seek(ms: number) {
  if (!project) return;
  video.currentTime = Math.max(0, Math.min(project.durationMs, ms)) / 1000;
}

// ---------------- transport ----------------

function renderTransport() {
  const el = $('#transport');
  if (!el || !project) return;
  el.replaceChildren(
    h('button', { class: 'icon-btn', 'aria-label': 'Mundur 5 detik', onclick: () => seek(video.currentTime * 1000 - 5000) }, '«'),
    h('button', { class: 'primary round', 'aria-label': video.paused ? 'Putar' : 'Jeda', onclick: togglePlay }, video.paused ? '▶' : '❚❚'),
    h('button', { class: 'icon-btn', 'aria-label': 'Maju 5 detik', onclick: () => seek(video.currentTime * 1000 + 5000) }, '»'),
    h('span', { id: 'time', class: 'mono' }, `${tc(video.currentTime * 1000, true)} / ${tc(project.durationMs)}`),
    h('div', { class: 'spacer' }),
    h('button', { class: 'secondary', onclick: () => { markIn = video.currentTime * 1000; renderTransport(); drawTimeline(); } },
      'Awal ', h('span', { class: 'mono muted' }, markIn !== null ? tc(markIn) : '—')),
    h('button', { class: 'secondary', onclick: () => { markOut = video.currentTime * 1000; renderTransport(); drawTimeline(); } },
      'Akhir ', h('span', { class: 'mono muted' }, markOut !== null ? tc(markOut) : '—')),
    h('button', { class: 'primary', onclick: addClipFromMarks, disabled: markIn === null }, '+ Buat klip'),
    ...(project.audioTracks > 1 ? [h('select', {
          'aria-label': 'Track audio', title: 'Track audio yang dipakai untuk ekspor',
          onchange: (e) => void changeTrack(Number((e.target as HTMLSelectElement).value)),
        }, ...Array.from({ length: project.audioTracks }, (_, i) => {
          const o = h('option', { value: i }, `Audio ${i + 1}`);
          if (i === project!.audioTrack) o.selected = true;
          return o;
        }))] : []),
  );
}

async function changeTrack(i: number) {
  const p = project!;
  p.audioTrack = i;
  p.waveformReady = false;
  await saveProject(p);
  wave = null;
  drawTimeline();
  void loadCaches();
}

function togglePlay() {
  if (video.paused) void video.play(); else video.pause();
}

function addClipFromMarks() {
  const p = project!;
  if (markIn === null) { toast('Tandai awal klip dulu (tombol I).'); return; }
  let a = markIn;
  let b = markOut ?? Math.min(p.durationMs, a + 30000);
  if (b < a) [a, b] = [b, a];
  if (b - a < 1000) { toast('Klip minimal 1 detik.'); return; }
  const clip: Clip = {
    id: uid(),
    name: `Klip ${p.clips.length + 1}`,
    inMs: Math.round(a),
    outMs: Math.round(b),
    title: '',
    titlePos: 'top',
    layout: structuredClone(p.defaultLayout),
    exported: false,
  };
  p.clips.push(clip);
  p.clips.sort((x, y) => x.inMs - y.inMs);
  markIn = markOut = null;
  selectedId = clip.id;
  void saveProject(p);
  renderClipList();
  renderTransport();
  renderInspector();
  drawTimeline();
  drawOverlay();
  drawPreview();
}

// ---------------- clip list ----------------

function renderClipList() {
  const p = project!;
  $('#clip-count')!.textContent = p.clips.length ? String(p.clips.length) : '';
  const ul = $('#clip-list')!;
  if (!p.clips.length) {
    ul.replaceChildren(h('li', { class: 'empty muted' }, 'Belum ada klip. Putar rekaman, tekan I di awal momen dan O di akhirnya, lalu Enter.'));
    return;
  }
  ul.replaceChildren(...p.clips.map((c) => h('li', { class: c.id === selectedId ? 'sel' : '' },
    h('button', { class: 'clip-row', onclick: () => selectClip(c.id) },
      h('div', { class: 'clip-name' }, c.name, c.exported ? h('span', { class: 'badge ok' }, 'diekspor') : null),
      h('div', { class: 'muted mono' }, `${tc(c.inMs)} → ${tc(c.outMs)} · ${tc(c.outMs - c.inMs)}`),
    ),
  )));
}

function selectClip(id: string | null) {
  selectedId = id;
  const c = selected();
  if (c) {
    seek(c.inMs);
    const span = view.end - view.start;
    if (c.inMs < view.start || c.outMs > view.end) {
      view.start = Math.max(0, c.inMs - span * 0.2);
      view.end = view.start + Math.max(span, (c.outMs - c.inMs) * 1.5);
    }
  }
  renderClipList();
  renderInspector();
  drawTimeline();
  drawOverlay();
  drawPreview();
}

// ---------------- inspector ----------------

function field(label: string, control: HTMLElement) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
}

function renderInspector() {
  const el = $('#inspector');
  if (!el || !project) return;
  const p = project;
  const c = selected();
  const l = editingLayout();
  const isSplit = l.type === 'split';

  const layoutSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' },
    h('button', { class: !isSplit ? 'on' : '', onclick: () => { setLayout(withType(l, 'crop', p.width, p.height)); renderInspector(); } }, 'Crop'),
    h('button', { class: isSplit ? 'on' : '', onclick: () => { setLayout(withType(l, 'split', p.width, p.height)); renderInspector(); } }, 'Facecam + game'),
  );

  const splitControls = isSplit ? h('div', { class: 'stack' },
    field('Posisi facecam', h('div', { class: 'seg' },
      h('button', { class: l.camPosition !== 'bottom' ? 'on' : '', onclick: () => { setLayout({ ...l, camPosition: 'top' }); renderInspector(); } }, 'Atas'),
      h('button', { class: l.camPosition === 'bottom' ? 'on' : '', onclick: () => { setLayout({ ...l, camPosition: 'bottom' }); renderInspector(); } }, 'Bawah'),
    )),
    field(`Tinggi facecam ${Math.round(l.camRatio * 100)}%`, h('input', {
      type: 'range', min: 25, max: 55, value: Math.round(l.camRatio * 100),
      oninput: (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        setLayout(normalize({ ...l, camRatio: v }, p.width, p.height));
        const lab = (e.target as HTMLElement).previousElementSibling;
        if (lab) lab.textContent = `Tinggi facecam ${Math.round(v * 100)}%`;
      },
    })),
  ) : null;

  const layoutBlock = h('div', { class: 'block' },
    h('h3', {}, c ? 'Layout klip ini' : 'Layout default untuk klip baru'),
    layoutSeg,
    splitControls,
    h('p', { class: 'muted small' }, isSplit
      ? 'Geser kotak oranye (gameplay) dan kotak putih (facecam) langsung di video. Tarik pojok kanan bawah untuk ubah ukuran.'
      : 'Geser kotak oranye di video untuk memilih bagian yang tampil.'),
    c ? h('button', { class: 'ghost small', onclick: () => { p.defaultLayout = structuredClone(c.layout); void saveProject(p); toast('Dipakai sebagai layout default untuk klip baru.'); } }, 'Jadikan default') : null,
  );

  if (!c) {
    el.replaceChildren(
      h('div', { class: 'preview-holder' }, preview),
      layoutBlock,
      h('div', { class: 'block muted small' }, 'Pilih atau buat klip untuk mengatur judul dan ekspor.'),
      h('div', { class: 'block', id: 'queue' }),
    );
    renderQueue();
    drawPreview();
    return;
  }

  const dur = c.outMs - c.inMs;
  const limit = PRESET_LIMIT_SEC[preset] * 1000;
  const timeInput = (key: 'inMs' | 'outMs') => h('input', {
    class: 'mono', value: tc(c[key], true), 'aria-label': key === 'inMs' ? 'Waktu awal' : 'Waktu akhir',
    onchange: (e) => {
      const v = parseTc((e.target as HTMLInputElement).value);
      if (v === null || v < 0 || v > p.durationMs) { toast('Format waktu: menit:detik, misal 12:34.5'); renderInspector(); return; }
      c[key] = v;
      if (c.outMs - c.inMs < 1000) { toast('Klip minimal 1 detik.'); c[key] = key === 'inMs' ? c.outMs - 1000 : c.inMs + 1000; }
      void saveProject(p); renderInspector(); renderClipList(); drawTimeline();
    },
  });

  el.replaceChildren(
    h('div', { class: 'preview-holder' }, preview),
    h('div', { class: 'block' },
      field('Nama klip', h('input', { value: c.name, onchange: (e) => { c.name = (e.target as HTMLInputElement).value.trim() || c.name; void saveProject(p); renderClipList(); } })),
      h('div', { class: 'row2' },
        field('Awal', timeInput('inMs')),
        field('Akhir', timeInput('outMs')),
      ),
      h('div', { class: 'row2' },
        h('button', { class: 'ghost small', onclick: () => { c.inMs = Math.min(Math.round(video.currentTime * 1000), c.outMs - 1000); void saveProject(p); renderInspector(); renderClipList(); drawTimeline(); } }, 'Awal = posisi sekarang'),
        h('button', { class: 'ghost small', onclick: () => { c.outMs = Math.max(Math.round(video.currentTime * 1000), c.inMs + 1000); void saveProject(p); renderInspector(); renderClipList(); drawTimeline(); } }, 'Akhir = posisi sekarang'),
      ),
      h('div', { class: dur > limit ? 'warn small' : 'muted small' },
        `Durasi ${tc(dur, true)}${dur > limit ? ` — lebih dari batas ${preset === 'shorts' ? 'YouTube Shorts (3 menit)' : 'TikTok (10 menit)'}` : ''}`),
    ),
    layoutBlock,
    h('div', { class: 'block' },
      h('h3', {}, 'Judul'),
      h('textarea', {
        rows: 2, placeholder: 'Tulis hook di sini (opsional)', 'aria-label': 'Judul di video',
        oninput: (e) => { c.title = (e.target as HTMLTextAreaElement).value; void saveProject(p); drawPreview(); },
      }, c.title),
      stripEmoji(c.title) !== c.title.trim() && c.title ? h('div', { class: 'muted small' }, 'Emoji tidak ikut di video hasil ekspor.') : null,
      h('div', { class: 'seg' },
        ...(['top', 'center', 'bottom'] as const).map((pos) => h('button', {
          class: c.titlePos === pos ? 'on' : '',
          onclick: () => { c.titlePos = pos; void saveProject(p); renderInspector(); drawPreview(); },
        }, pos === 'top' ? 'Atas' : pos === 'center' ? 'Tengah' : 'Bawah')),
      ),
    ),
    h('div', { class: 'block' },
      h('h3', {}, 'Ekspor'),
      h('div', { class: 'seg' },
        h('button', { class: preset === 'tiktok' ? 'on' : '', onclick: () => { preset = 'tiktok'; renderInspector(); } }, 'TikTok'),
        h('button', { class: preset === 'shorts' ? 'on' : '', onclick: () => { preset = 'shorts'; renderInspector(); } }, 'YouTube Shorts'),
      ),
      h('div', { class: 'muted small' }, `1080×1920 · ${exportFps()} fps · MP4`),
      h('button', { class: 'primary wide', onclick: () => void exportClips([c]) }, 'Ekspor klip ini'),
      p.clips.length > 1 ? h('button', { class: 'secondary wide', onclick: () => void exportClips(p.clips) }, `Ekspor semua (${p.clips.length})`) : null,
      h('button', { class: 'ghost small', onclick: () => void chooseOutDir() }, `Simpan ke: ${settings.outDir}`),
      h('button', {
        class: 'danger-ghost small',
        onclick: async () => {
          if (!(await dialog().ask(`Hapus "${c.name}"?`, { title: 'Hapus klip', kind: 'warning' }))) return;
          p.clips = p.clips.filter((x) => x.id !== c.id);
          void saveProject(p);
          selectClip(null);
        },
      }, 'Hapus klip'),
    ),
    h('div', { class: 'block', id: 'queue' }),
  );
  renderQueue();
  drawPreview();
}

function exportFps(): 30 | 60 {
  if (settings.fps) return settings.fps;
  return project && project.fps >= 50 ? 60 : 30;
}

async function chooseOutDir() {
  const d = await dialog().open({ directory: true, title: 'Folder hasil ekspor' });
  if (typeof d === 'string') { settings.outDir = d; await saveSettings(settings); renderInspector(); }
}

async function exportClips(clips: Clip[]) {
  const p = project!;
  const enc = settings.encoder || (await detectEncoder());
  const over = clips.filter((c) => c.outMs - c.inMs > PRESET_LIMIT_SEC[preset] * 1000);
  if (over.length && !(await dialog().ask(`${over.length} klip lebih panjang dari batas ${preset === 'shorts' ? 'YouTube Shorts' : 'TikTok'}. Tetap ekspor?`, { title: 'Durasi', kind: 'warning' }))) return;
  for (const c of clips) {
    try {
      await enqueueExport(p, c, { outDir: settings.outDir, encoder: enc, fps: exportFps() });
    } catch (e) {
      toast(`${c.name}: ${(e as Error).message}`, 'error');
    }
  }
}

function renderQueue() {
  const el = $('#queue');
  if (!el) return;
  const jobs = queue.filter((j) => j.status !== 'cancelled').slice(-8).reverse();
  if (!jobs.length) { el.replaceChildren(); return; }
  for (const j of queue) {
    if (j.status === 'done' && project && j.projectId === project.id) {
      const c = project.clips.find((x) => x.id === j.clipId);
      if (c && !c.exported) { c.exported = true; void saveProject(project); renderClipList(); }
    }
  }
  el.replaceChildren(
    h('h3', {}, 'Antrean ekspor'),
    ...jobs.map((j) => h('div', { class: `job ${j.status}` },
      h('div', { class: 'job-head' },
        h('span', {}, j.label),
        h('span', { class: 'muted small' },
          j.status === 'queued' ? 'menunggu' : j.status === 'running' ? `${Math.round(j.progress * 100)}%` : j.status === 'done' ? 'selesai' : 'gagal'),
      ),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.round(j.progress * 100)}%` })),
      j.status === 'failed' ? h('div', { class: 'warn small' }, j.error) : null,
      h('div', { class: 'job-actions' },
        j.status === 'done' ? h('button', { class: 'ghost small', onclick: () => void invoke('reveal', { path: j.outPath }) }, 'Buka folder') : null,
        j.status === 'queued' || j.status === 'running' ? h('button', { class: 'ghost small', onclick: () => void cancelExport(j) }, 'Batal') : null,
      ),
    )),
  );
}

// ---------------- 9:16 preview ----------------

function drawPreview() {
  if (!project || !preview || !video || video.readyState < 2) return;
  const ctx = preview.getContext('2d');
  if (!ctx) return;
  const W = preview.width, H = preview.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  const l = editingLayout();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const draw = (r: Rect, dy: number, dh: number) =>
    ctx.drawImage(video, r.x * vw, r.y * vh, r.w * vw, r.h * vh, 0, dy, W, dh);
  if (l.type === 'split' && l.cam) {
    const s = splitHeights(l, H);
    if (l.camPosition === 'bottom') { draw(l.main, 0, s.main); draw(l.cam, s.main, s.cam); }
    else { draw(l.cam, 0, s.cam); draw(l.main, s.cam, s.main); }
  } else {
    draw(l.main, 0, H);
  }
  const c = selected();
  const title = c ? stripEmoji(c.title) : '';
  if (title) {
    const k = W / 1080;
    const size = 68 * k;
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const lines = title.split('\n');
    const lh = size * 1.2;
    const bw = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 48 * k;
    const bh = lines.length * lh + 48 * k - (lh - size);
    const y = c!.titlePos === 'center' ? (H - bh) / 2 : c!.titlePos === 'bottom' ? H - bh - 360 * k : 200 * k - 24 * k;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect((W - bw) / 2, y, bw, bh);
    ctx.fillStyle = '#fff';
    lines.forEach((t, i) => ctx.fillText(t, W / 2, y + 24 * k + i * lh));
  }
}

function loopPreview() {
  if (!video || video.paused) return;
  drawPreview();
  requestAnimationFrame(loopPreview);
}

// ---------------- crop boxes over the player ----------------

function videoRect() {
  // where the picture actually sits inside the <video> element (object-fit: contain)
  const box = video.getBoundingClientRect();
  const wrap = overlay.parentElement!.getBoundingClientRect();
  const ar = project!.width / project!.height;
  let w = box.width, hh = box.width / ar;
  if (hh > box.height) { hh = box.height; w = hh * ar; }
  return { left: box.left - wrap.left + (box.width - w) / 2, top: box.top - wrap.top + (box.height - hh) / 2, w, h: hh };
}

function drawOverlay() {
  if (!overlay || !project) return;
  const vr = videoRect();
  const l = editingLayout();
  const parts: [Part, Rect][] = [['main', l.main]];
  if (l.type === 'split' && l.cam) parts.push(['cam', l.cam]);
  overlay.replaceChildren(...parts.map(([part, r]) => {
    const box = h('div', {
      class: `crop ${part}`, 'data-part': part,
      style: `left:${vr.left + r.x * vr.w}px;top:${vr.top + r.y * vr.h}px;width:${r.w * vr.w}px;height:${r.h * vr.h}px`,
    },
      h('span', { class: 'crop-label' }, part === 'main' ? (l.type === 'split' ? 'Gameplay' : '9:16') : 'Facecam'),
      h('span', { class: 'handle', 'data-handle': '1' }),
    );
    return box;
  }));
}

function setupOverlay() {
  let drag: { part: Part; mode: 'move' | 'resize'; sx: number; sy: number; start: Rect } | null = null;
  overlay.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const box = t.closest('.crop') as HTMLElement | null;
    if (!box) return;
    const part = box.dataset.part as Part;
    const l = editingLayout();
    const start = part === 'cam' ? l.cam! : l.main;
    drag = { part, mode: t.dataset.handle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, start: { ...start } };
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!drag || !project) return;
    const vr = videoRect();
    const dx = (e.clientX - drag.sx) / vr.w;
    const dy = (e.clientY - drag.sy) / vr.h;
    const l = structuredClone(editingLayout());
    const aspect = partAspect(l, drag.part, project.width, project.height);
    const r = drag.mode === 'move' ? moveRect(drag.start, dx, dy) : resizeRect(drag.start, drag.start.w + dx, aspect);
    if (drag.part === 'cam') l.cam = r; else l.main = r;
    const c = selected();
    if (c) c.layout = l; else project.defaultLayout = l;
    drawOverlay();
    drawPreview();
  });
  const end = () => { if (drag && project) void saveProject(project); drag = null; };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
}

// ---------------- timeline ----------------

const TL = { ruler: 20, thumbs: 54, wave: 56, clips: 26 };
const TL_H = TL.ruler + TL.thumbs + TL.wave + TL.clips;

function sizeTimeline() {
  if (!tl) return;
  const r = tl.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  tl.width = Math.max(100, Math.floor(r.width * dpr));
  tl.height = Math.floor(TL_H * dpr);
  tl.style.height = `${TL_H}px`;
  drawTimeline();
}

const msToX = (ms: number, w: number) => ((ms - view.start) / (view.end - view.start)) * w;
const xToMs = (x: number, w: number) => view.start + (x / w) * (view.end - view.start);

function niceStep(spanMs: number, width: number) {
  const target = (spanMs / width) * 90;
  const steps = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000];
  return steps.find((s) => s >= target) ?? 3600000;
}

function drawTimeline() {
  if (!tl || !project) return;
  const ctx = tl.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = tl.width / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, W, TL_H);
  const span = view.end - view.start;

  // ruler
  ctx.fillStyle = '#a3a3a3';
  ctx.font = '11px "JetBrains Mono", Consolas, monospace';
  ctx.textBaseline = 'middle';
  const step = niceStep(span, W);
  for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
    const x = msToX(t, W);
    ctx.fillRect(x, TL.ruler - 6, 1, 6);
    ctx.fillText(tc(t), x + 3, 9);
  }

  // thumbnails
  const y0 = TL.ruler;
  const every = project.thumbs.everySec * 1000;
  const tw = 96, th = TL.thumbs;
  if (sheets.length) {
    for (let x = 0; x < W; x += tw) {
      const t = xToMs(x + tw / 2, W);
      const i = Math.floor(t / every);
      const sheet = sheets[Math.floor(i / 100)];
      if (!sheet || !sheet.complete || !sheet.naturalWidth) continue;
      const k = i % 100;
      ctx.drawImage(sheet, (k % 10) * 160, Math.floor(k / 10) * 90, 160, 90, x, y0, tw, th);
    }
  } else {
    ctx.fillStyle = '#262626';
    ctx.fillRect(0, y0, W, th);
  }

  // waveform: one bar per pixel, max of the 100 ms peaks under it
  const wy = TL.ruler + TL.thumbs;
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, wy, W, TL.wave);
  if (wave) {
    ctx.fillStyle = '#6b6b6b';
    const mid = wy + TL.wave / 2;
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, Math.floor(xToMs(x, W) / 100));
      const b = Math.min(wave.length, Math.max(a + 1, Math.floor(xToMs(x + 1, W) / 100)));
      let m = 0;
      for (let i = a; i < b; i++) if (wave[i] > m) m = wave[i];
      const hh = (m / 255) * (TL.wave - 6);
      ctx.fillRect(x, mid - hh / 2, 1, Math.max(1, hh));
    }
  }

  // clips lane
  const cy = wy + TL.wave;
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, cy, W, TL.clips);
  for (const c of project.clips) {
    const a = msToX(c.inMs, W), b = msToX(c.outMs, W);
    if (b < 0 || a > W) continue;
    const sel = c.id === selectedId;
    ctx.fillStyle = sel ? 'rgba(255,106,26,.28)' : 'rgba(255,255,255,.07)';
    ctx.fillRect(a, TL.ruler, b - a, TL_H - TL.ruler);
    ctx.fillStyle = sel ? '#ff6a1a' : '#3a3a3a';
    ctx.fillRect(a, cy + 3, Math.max(2, b - a), TL.clips - 6);
    ctx.fillStyle = sel ? '#121212' : '#ededed';
    ctx.font = '600 11px Inter, "Segoe UI", sans-serif';
    ctx.save();
    ctx.beginPath(); ctx.rect(a, cy, b - a, TL.clips); ctx.clip();
    ctx.fillText(c.name, a + 6, cy + TL.clips / 2);
    ctx.restore();
    if (sel) { ctx.fillStyle = '#ff6a1a'; ctx.fillRect(a - 1, TL.ruler, 3, TL_H); ctx.fillRect(b - 2, TL.ruler, 3, TL_H); }
  }

  // pending marks
  if (markIn !== null) {
    const a = msToX(markIn, W);
    const b = markOut !== null ? msToX(markOut, W) : null;
    ctx.fillStyle = 'rgba(242,193,78,.18)';
    if (b !== null) ctx.fillRect(Math.min(a, b), TL.ruler, Math.abs(b - a), TL_H);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(a, TL.ruler, 2, TL_H);
    if (b !== null) ctx.fillRect(b, TL.ruler, 2, TL_H);
  }

  // playhead
  if (video) {
    const x = msToX(video.currentTime * 1000, W);
    ctx.fillStyle = '#ff6a1a';
    ctx.fillRect(x - 1, 0, 2, TL_H);
    ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.fill();
  }

  // overview scrollbar hint
  const vis = span / project.durationMs;
  if (vis < 1) {
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect((view.start / project.durationMs) * W, TL_H - 3, Math.max(8, vis * W), 3);
  }
}

function setupTimeline() {
  let drag: { mode: 'seek' | 'in' | 'out'; clip?: Clip } | null = null;
  const pos = (e: MouseEvent) => {
    const r = tl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  };
  tl.addEventListener('pointerdown', (e) => {
    if (!project) return;
    const { x, w } = pos(e);
    const c = selected();
    if (c) {
      const a = msToX(c.inMs, w), b = msToX(c.outMs, w);
      if (Math.abs(x - a) < 7) drag = { mode: 'in', clip: c };
      else if (Math.abs(x - b) < 7) drag = { mode: 'out', clip: c };
    }
    if (!drag) {
      const { y } = pos(e);
      const ms = xToMs(x, w);
      if (y > TL.ruler + TL.thumbs + TL.wave) {
        const hit = project.clips.find((k) => ms >= k.inMs && ms <= k.outMs);
        if (hit) { selectClip(hit.id); return; }
      }
      drag = { mode: 'seek' };
      seek(ms);
    }
    tl.setPointerCapture(e.pointerId);
  });
  tl.addEventListener('pointermove', (e) => {
    const { x, w } = pos(e);
    if (!drag) {
      const c = selected();
      const near = c && (Math.abs(x - msToX(c.inMs, w)) < 7 || Math.abs(x - msToX(c.outMs, w)) < 7);
      tl.style.cursor = near ? 'ew-resize' : 'pointer';
      return;
    }
    const ms = Math.max(0, Math.min(project!.durationMs, xToMs(x, w)));
    if (drag.mode === 'seek') seek(ms);
    else if (drag.clip) {
      if (drag.mode === 'in') drag.clip.inMs = Math.round(Math.min(ms, drag.clip.outMs - 1000));
      else drag.clip.outMs = Math.round(Math.max(ms, drag.clip.inMs + 1000));
      seek(drag.mode === 'in' ? drag.clip.inMs : drag.clip.outMs);
      drawTimeline();
    }
  });
  const end = () => {
    if (drag?.clip && project) { void saveProject(project); renderInspector(); renderClipList(); }
    drag = null;
  };
  tl.addEventListener('pointerup', end);
  tl.addEventListener('pointercancel', end);
  tl.addEventListener('wheel', (e) => {
    if (!project) return;
    e.preventDefault();
    const { x, w } = pos(e);
    const span = view.end - view.start;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.deltaX || e.deltaY) / w) * span;
      const s = Math.max(0, Math.min(project.durationMs - span, view.start + d));
      view = { start: s, end: s + span };
    } else {
      const at = xToMs(x, w);
      const ns = Math.max(5000, Math.min(project.durationMs, span * (e.deltaY > 0 ? 1.25 : 0.8)));
      let s = at - (x / w) * ns;
      s = Math.max(0, Math.min(project.durationMs - ns, s));
      view = { start: s, end: s + ns };
    }
    drawTimeline();
  }, { passive: false });
}

// ---------------- keyboard ----------------

function onKey(e: KeyboardEvent) {
  if (!project || !video) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const now = video.currentTime * 1000;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'i': case 'I': markIn = now; renderTransport(); drawTimeline(); break;
    case 'o': case 'O': markOut = now; renderTransport(); drawTimeline(); break;
    case 'Enter': addClipFromMarks(); break;
    case 'j': case 'J': seek(now - 5000); break;
    case 'l': case 'L': seek(now + 5000); break;
    case 'k': case 'K': video.pause(); break;
    case 'ArrowLeft': e.preventDefault(); seek(now - (e.shiftKey ? 1000 / project.fps : 1000)); break;
    case 'ArrowRight': e.preventDefault(); seek(now + (e.shiftKey ? 1000 / project.fps : 1000)); break;
    case 'Escape': markIn = markOut = null; renderTransport(); drawTimeline(); break;
    case 'Delete': {
      const c = selected();
      if (c) void dialog().ask(`Hapus "${c.name}"?`, { title: 'Hapus klip', kind: 'warning' }).then((ok) => {
        if (!ok || !project) return;
        project.clips = project.clips.filter((x) => x.id !== c.id);
        void saveProject(project);
        selectClip(null);
      });
      break;
    }
  }
}

window.addEventListener('beforeunload', () => void flush());
void boot();
