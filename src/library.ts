// Two libraries shared by every project, stored in the app's data folder:
//  - Suara (soundboard): sound pads, hotkeys 1..9
//  - Meme: pictures, hotkeys Shift+1..9, each with its default entrance/exit animation
import { invoke, join, baseName, extName, stem } from './tauri';
import { dataDir, uid } from './store';
import type { Trans } from './render';

export const SOUND_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

export interface LibSound { id: string; name: string; file: string; durationMs: number }
export interface Pad { id: string; name: string; soundId: string; color: string }

export interface Meme {
  id: string;
  name: string;
  file: string;
  width: number;
  height: number;
  animated: boolean;
  durationMs: number;  // how long it stays on screen when placed
  transIn: Trans;
  transOut: Trans;
}

export interface Library {
  version: 2;
  sounds: LibSound[];
  pads: Pad[];     // order = hotkeys 1..9
  memes: Meme[];   // order = hotkeys Shift+1..9
  starterInstalled: boolean;
}

const PAD_COLORS = ['#ff6a1a', '#ffd400', '#4cc38a', '#4ea1ff', '#c77dff', '#ff5c8a', '#2ec4b6', '#f2c14e', '#a3a3a3'];

let lib: Library | null = null;

async function libDir() { return join(await dataDir(), 'library'); }
async function libFile() { return join(await libDir(), 'library.json'); }

interface V1 {
  version?: 1; starterInstalled?: boolean;
  sounds?: LibSound[];
  images?: { id: string; name: string; file: string; width: number; height: number; animated: boolean }[];
  pads?: { id: string; name: string; soundId?: string; imageId?: string; imageMs?: number; color: string }[];
}

/** v0.3 kept sounds and pictures on shared pads; split them into the two libraries. */
function migrate(old: V1): Library {
  const memes: Meme[] = [];
  for (const pad of old.pads ?? []) {
    const im = old.images?.find((x) => x.id === pad.imageId);
    if (im && !memes.some((m) => m.file === im.file)) {
      memes.push({ ...im, id: uid(), name: pad.soundId ? pad.name : im.name, durationMs: pad.imageMs ?? 2000, transIn: 'pop', transOut: 'fade' });
    }
  }
  for (const im of old.images ?? []) {
    if (!memes.some((m) => m.file === im.file)) memes.push({ ...im, durationMs: 2000, transIn: 'pop', transOut: 'fade' });
  }
  const pads = (old.pads ?? []).filter((p) => p.soundId).map((p) => ({ id: p.id, name: p.name, soundId: p.soundId!, color: p.color }));
  return { version: 2, sounds: old.sounds ?? [], pads, memes, starterInstalled: old.starterInstalled ?? false };
}

export async function loadLibrary(): Promise<Library> {
  if (lib) return lib;
  let raw: (Library | V1) | null = null;
  try { raw = JSON.parse(await invoke<string>('read_text', { path: await libFile() })); } catch { raw = null; }
  if (!raw) lib = { version: 2, sounds: [], pads: [], memes: [], starterInstalled: false };
  else if (raw.version === 2) lib = raw as Library;
  else { lib = migrate(raw as V1); await saveLibrary(); }
  if (!lib.starterInstalled) await installStarter(lib);
  return lib;
}

export async function saveLibrary() {
  if (lib) await invoke('write_text', { path: await libFile(), content: JSON.stringify(lib) });
}

interface Probe { streams: { codec_type: string; width?: number; height?: number; nb_frames?: string }[]; format: { duration?: string } }
const probe = async (path: string) => JSON.parse(await invoke<string>('probe', { path })) as Probe;

async function copyIn(path: string, sub: 'sounds' | 'images'): Promise<string> {
  const dest = join(await libDir(), sub, `${uid().slice(0, 8)}-${baseName(path)}`);
  await invoke('copy_file', { src: path, dest });
  return dest;
}

async function addSound(path: string, name = stem(path)): Promise<Pad> {
  const L = await loadLibrary();
  const info = await probe(path).catch(() => null);
  const ms = Math.round(Number(info?.format.duration ?? 0) * 1000);
  if (!info || !info.streams.some((s) => s.codec_type === 'audio') || !ms) throw new Error(`${baseName(path)} bukan file suara yang bisa dibaca.`);
  if (ms > 5 * 60_000) throw new Error(`${baseName(path)} terlalu panjang untuk soundboard (maks 5 menit).`);
  const s: LibSound = { id: uid(), name, file: await copyIn(path, 'sounds'), durationMs: ms };
  L.sounds.push(s);
  const pad: Pad = { id: uid(), name, soundId: s.id, color: PAD_COLORS[L.pads.length % PAD_COLORS.length] };
  L.pads.push(pad);
  return pad;
}

async function addMeme(path: string): Promise<Meme> {
  const L = await loadLibrary();
  const info = await probe(path).catch(() => null);
  const v = info?.streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!v || !v.width || !v.height) throw new Error(`${baseName(path)} bukan gambar yang bisa dibaca.`);
  const animated = extName(path) === 'gif' && Number(v.nb_frames ?? '2') !== 1;
  const m: Meme = {
    id: uid(), name: stem(path), file: await copyIn(path, 'images'), width: v.width, height: v.height, animated,
    durationMs: 2000, transIn: 'pop', transOut: 'fade',
  };
  L.memes.push(m);
  return m;
}

/** Sorts dropped files into the right library. */
export async function importFiles(paths: string[]): Promise<{ sounds: number; memes: number; errors: string[] }> {
  const errors: string[] = [];
  let sounds = 0, memes = 0;
  for (const p of paths) {
    const ext = extName(p);
    try {
      if (SOUND_EXT.includes(ext)) { await addSound(p); sounds++; }
      else if (IMAGE_EXT.includes(ext)) { await addMeme(p); memes++; }
      else errors.push(`${baseName(p)}: format belum didukung`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  await saveLibrary();
  return { sounds, memes, errors };
}

async function installStarter(L: Library) {
  try {
    const dir = await invoke<string>('starter_sfx_dir');
    const files = (await invoke<string[]>('list_dir', { path: dir })).filter((f) => f.endsWith('.ogg')).sort();
    for (const f of files) await addSound(join(dir, f), stem(f));
  } catch {
    // the starter pack is optional
  }
  L.starterInstalled = true;
  await saveLibrary();
}

export async function deletePad(id: string) {
  const L = await loadLibrary();
  const pad = L.pads.find((p) => p.id === id);
  L.pads = L.pads.filter((p) => p.id !== id);
  if (pad && !L.pads.some((p) => p.soundId === pad.soundId)) {
    const s = L.sounds.find((x) => x.id === pad.soundId);
    if (s) await invoke('remove_path', { path: s.file }).catch(() => undefined);
    L.sounds = L.sounds.filter((x) => x.id !== pad.soundId);
  }
  await saveLibrary();
}

export async function deleteMeme(id: string) {
  const L = await loadLibrary();
  const m = L.memes.find((x) => x.id === id);
  if (m) await invoke('remove_path', { path: m.file }).catch(() => undefined);
  L.memes = L.memes.filter((x) => x.id !== id);
  await saveLibrary();
}

export function move<T>(list: T[], from: number, to: number) {
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  void saveLibrary();
}

export const soundOf = (pad: Pad) => lib?.sounds.find((s) => s.id === pad.soundId);
