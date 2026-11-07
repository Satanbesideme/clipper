// Projects live as JSON files in the app data folder. Nothing leaves the PC.
import { invoke, join } from './tauri';
import type { Encoder, Layout, TitlePos } from './ffmpeg';

export interface Clip {
  id: string;
  name: string;
  inMs: number;
  outMs: number;
  title: string;
  titlePos: TitlePos;
  layout: Layout;
  exported: boolean;
}

export interface Project {
  id: string;
  name: string;
  source: string;      // original file
  playable: string;    // file the player uses (remuxed MP4 or the original)
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  audioTracks: number;
  audioTrack: number;  // track used for export and waveform
  thumbs: { everySec: number; sheets: number; ready: boolean };
  waveformReady: boolean;
  defaultLayout: Layout;
  clips: Clip[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary { id: string; name: string; source: string; durationMs: number; clips: number; updatedAt: string }

export interface Settings { outDir: string; encoder: Encoder | ''; fps: 30 | 60 | 0 }

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
  await invoke('write_text', { path, content: JSON.stringify(value, null, 1) });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const list = await readJson<ProjectSummary[]>(join(await dataDir(), 'projects.json'), []);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | null> {
  return readJson<Project | null>(join(await projectDir(id), 'project.json'), null);
}

let saveTimer: number | undefined;
let pending: Project | null = null;

/** Debounced save, so dragging a crop box does not hammer the disk. */
export function saveProject(p: Project, now = false) {
  p.updatedAt = new Date().toISOString();
  pending = p;
  window.clearTimeout(saveTimer);
  if (now) return flush();
  saveTimer = window.setTimeout(flush, 400);
  return Promise.resolve();
}

export async function flush() {
  const p = pending;
  pending = null;
  if (!p) return;
  await writeJson(join(await projectDir(p.id), 'project.json'), p);
  const list = (await listProjects()).filter((x) => x.id !== p.id);
  list.unshift({ id: p.id, name: p.name, source: p.source, durationMs: p.durationMs, clips: p.clips.length, updatedAt: p.updatedAt });
  await writeJson(join(await dataDir(), 'projects.json'), list);
}

export async function deleteProject(id: string) {
  await invoke('remove_path', { path: await projectDir(id) });
  const list = (await listProjects()).filter((x) => x.id !== id);
  await writeJson(join(await dataDir(), 'projects.json'), list);
}

export async function loadSettings(): Promise<Settings> {
  const s = await readJson<Partial<Settings>>(join(await dataDir(), 'settings.json'), {});
  let outDir = s.outDir ?? '';
  if (!outDir) {
    const vids = await invoke<string>('videos_dir');
    outDir = join(vids || (await dataDir()), 'GALSURKU Clipper');
  }
  return { outDir, encoder: s.encoder ?? '', fps: s.fps ?? 0 };
}

export async function saveSettings(s: Settings) {
  await writeJson(join(await dataDir(), 'settings.json'), s);
}

export const uid = () => crypto.randomUUID();
