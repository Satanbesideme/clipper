// Projects live as JSON files in the app data folder. Nothing leaves the PC.
import type { TextStyle } from './render';
import { invoke, join } from './tauri';
import type { Encoder } from './ffmpeg';
import { DEFAULT_CAPTION, timelineDuration, type Media, type Range, type Timeline, type Watermark } from './render';

export interface MediaEntry extends Media {
  thumbs: { everySec: number; sheets: number; tw: number; th: number; ready: boolean };
  silences?: Record<string, Range[]>;  // keyed by noise threshold, e.g. "-38"
}

export interface Project {
  version: 2;
  id: string;
  name: string;
  media: MediaEntry[];
  timeline: Timeline;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary { id: string; name: string; durationMs: number; clips: number; updatedAt: string; version?: number }

export type ModelSize = 'base' | 'small';
export interface Settings { outDir: string; encoder: Encoder | ''; model: ModelSize; watermark?: Watermark | null; fontScale?: Record<string, number>; quality?: number; sttTracks?: 'all' | number; sttCareful?: boolean; insertVolume?: number; leftW?: number; rightW?: number; leftHidden?: boolean; rightHidden?: boolean; exportPreset?: string; namePattern?: string; exportFormat?: string; textPresets?: { name: string; style: TextStyle }[] }

let dataDirCache = '';
export async function dataDir(): Promise<string> {
  if (!dataDirCache) dataDirCache = await invoke<string>('data_dir');
  return dataDirCache;
}
export async function projectDir(id: string) { return join(await dataDir(), 'projects', id); }

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await invoke<string>('read_text', { path })) as T; } catch { return fallback; }
}
async function writeJson(path: string, value: unknown) {
  await invoke('write_text', { path, content: JSON.stringify(value) });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const list = await readJson<ProjectSummary[]>(join(await dataDir(), 'projects.json'), []);
  return list.filter((p) => p.version === 2).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | null> {
  const p = await readJson<Project | null>(join(await projectDir(id), 'project.json'), null);
  return p && p.version === 2 ? p : null;
}

export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    version: 2,
    id: uid(),
    name,
    media: [],
    timeline: {
      width: 1080, height: 1920, fps: 60, clips: [], texts: [], sounds: [], images: [], music: [],
      captions: { mode: 'word', y: 0.7, style: { ...DEFAULT_CAPTION }, lines: [] },
    },
    createdAt: now,
    updatedAt: now,
  };
}

let saveTimer: number | undefined;
let pending: Project | null = null;

/** Debounced save, so dragging on the timeline does not hammer the disk. */
export function saveProject(p: Project, now = false) {
  p.updatedAt = new Date().toISOString();
  pending = p;
  window.clearTimeout(saveTimer);
  if (now) return flush();
  saveTimer = window.setTimeout(() => void flush(), 500);
  return Promise.resolve();
}

let savedCb: (at: Date) => void = () => undefined;
/** Called after every successful save (autosave indicator). */
export function onSaved(cb: (at: Date) => void) { savedCb = cb; }

export async function flush() {
  const p = pending;
  pending = null;
  if (!p) return;
  await writeJson(join(await projectDir(p.id), 'project.json'), p);
  const all = await readJson<ProjectSummary[]>(join(await dataDir(), 'projects.json'), []);
  const list = all.filter((x) => x.id !== p.id && x.version === 2);
  list.unshift({ id: p.id, name: p.name, durationMs: timelineDuration(p.timeline), clips: p.timeline.clips.length, updatedAt: p.updatedAt, version: 2 });
  await writeJson(join(await dataDir(), 'projects.json'), list);
  savedCb(new Date());
}

// ---------- version history ----------

export interface Version { file: string; at: Date; reason: string }
const HISTORY_KEEP = 40;

async function historyDir(id: string) { return join(await projectDir(id), 'history'); }

/** Keeps a copy of the project as it is now. File name: <unix ms>_<reason>.json */
export async function snapshotProject(p: Project, reason: string) {
  const dir = await historyDir(p.id);
  await invoke('ensure_dir', { path: dir });
  const safe = reason.replace(/[^a-z0-9-]/gi, '-').slice(0, 30) || 'auto';
  await writeJson(join(dir, `${Date.now()}_${safe}.json`), p);
  const all = (await listVersions(p.id)).slice(HISTORY_KEEP);
  for (const v of all) await invoke('remove_path', { path: join(dir, v.file) }).catch(() => undefined);
}

/** Newest first. */
export async function listVersions(id: string): Promise<Version[]> {
  const files = await invoke<string[]>('list_dir', { path: await historyDir(id) }).catch(() => [] as string[]);
  return files
    .map((f) => /^(\d{12,})_(.*)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ file: m[0], at: new Date(Number(m[1])), reason: m[2] }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export async function loadVersion(id: string, file: string): Promise<Project | null> {
  return readJson<Project | null>(join(await historyDir(id), file), null);
}

export async function deleteProject(id: string) {
  await invoke('remove_path', { path: await projectDir(id) });
  const all = await readJson<ProjectSummary[]>(join(await dataDir(), 'projects.json'), []);
  await writeJson(join(await dataDir(), 'projects.json'), all.filter((x) => x.id !== id && x.version === 2));
}

export async function loadSettings(): Promise<Settings> {
  const s = await readJson<Partial<Settings>>(join(await dataDir(), 'settings.json'), {});
  let outDir = s.outDir ?? '';
  if (!outDir) {
    const vids = await invoke<string>('videos_dir');
    outDir = join(vids || (await dataDir()), 'Gals Clip Studio');
  }
  return { outDir, encoder: s.encoder ?? '', model: s.model ?? 'small', watermark: s.watermark ?? null, fontScale: s.fontScale ?? {}, quality: s.quality ?? 0.75, sttTracks: s.sttTracks ?? 'all', sttCareful: s.sttCareful ?? true, insertVolume: s.insertVolume ?? 0.25, leftW: s.leftW, rightW: s.rightW, leftHidden: s.leftHidden ?? false, rightHidden: s.rightHidden ?? false };
}

export async function saveSettings(s: Settings) {
  await writeJson(join(await dataDir(), 'settings.json'), s);
}

export const uid = () => crypto.randomUUID() as string;
