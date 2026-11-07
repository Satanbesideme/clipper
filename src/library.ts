// The soundboard library: sounds and meme pictures copied into the app's data folder,
// shared by every project. Pads can be a sound, a picture, or both (a "combo").
import { invoke, join, baseName, extName, stem } from './tauri';
import { dataDir, uid } from './store';

export const SOUND_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

export interface LibSound { id: string; name: string; file: string; durationMs: number }
export interface LibImage { id: string; name: string; file: string; width: number; height: number; animated: boolean }

export interface Pad {
  id: string;
  name: string;
  soundId?: string;
  imageId?: string;
  imageMs: number;   // how long the picture stays (when there is no sound to follow)
  color: string;     // pad colour
}

export interface Library {
  version: 1;
  sounds: LibSound[];
  images: LibImage[];
  pads: Pad[];        // order = hotkey order (1..9)
  starterInstalled: boolean;
}

const PAD_COLORS = ['#ff6a1a', '#ffd400', '#4cc38a', '#4ea1ff', '#c77dff', '#ff5c8a', '#2ec4b6', '#f2c14e', '#a3a3a3'];

let lib: Library | null = null;

async function libDir() { return join(await dataDir(), 'library'); }
async function libFile() { return join(await libDir(), 'library.json'); }

export async function loadLibrary(): Promise<Library> {
  if (lib) return lib;
  try {
    lib = JSON.parse(await invoke<string>('read_text', { path: await libFile() })) as Library;
  } catch {
    lib = { version: 1, sounds: [], images: [], pads: [], starterInstalled: false };
  }
  if (!lib.starterInstalled) await installStarter(lib);
  return lib;
}

export async function saveLibrary() {
  if (lib) await invoke('write_text', { path: await libFile(), content: JSON.stringify(lib) });
}

interface Probe { streams: { codec_type: string; width?: number; height?: number; nb_frames?: string }[]; format: { duration?: string; format_name?: string } }

async function probe(path: string): Promise<Probe> {
  return JSON.parse(await invoke<string>('probe', { path })) as Probe;
}

/** Copies a file into the library folder under a unique name. */
async function copyIn(path: string, sub: 'sounds' | 'images'): Promise<string> {
  const dest = join(await libDir(), sub, `${uid().slice(0, 8)}-${baseName(path)}`);
  await invoke('copy_file', { src: path, dest });
  return dest;
}

export async function addSound(path: string, name = stem(path), copy = true): Promise<LibSound> {
  const L = await loadLibrary();
  const info = await probe(path).catch(() => null);
  const ms = Math.round(Number(info?.format.duration ?? 0) * 1000);
  if (!info || !info.streams.some((s) => s.codec_type === 'audio') || !ms) throw new Error(`${baseName(path)} bukan file suara yang bisa dibaca.`);
  if (ms > 5 * 60_000) throw new Error(`${baseName(path)} terlalu panjang untuk soundboard (maks 5 menit).`);
  const s: LibSound = { id: uid(), name, file: copy ? await copyIn(path, 'sounds') : path, durationMs: ms };
  L.sounds.push(s);
  return s;
}

export async function addImage(path: string, name = stem(path)): Promise<LibImage> {
  const L = await loadLibrary();
  const info = await probe(path).catch(() => null);
  const v = info?.streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!v || !v.width || !v.height) throw new Error(`${baseName(path)} bukan gambar yang bisa dibaca.`);
  const animated = extName(path) === 'gif' && Number(v.nb_frames ?? '2') !== 1;
  const im: LibImage = { id: uid(), name, file: await copyIn(path, 'images'), width: v.width, height: v.height, animated };
  L.images.push(im);
  return im;
}

/** Imports any mix of sound and picture files; each becomes its own pad. */
export async function importFiles(paths: string[]): Promise<{ added: number; errors: string[] }> {
  const L = await loadLibrary();
  const errors: string[] = [];
  let added = 0;
  for (const p of paths) {
    const ext = extName(p);
    try {
      if (SOUND_EXT.includes(ext)) {
        const s = await addSound(p);
        L.pads.push(newPad(s.name, { soundId: s.id }));
        added++;
      } else if (IMAGE_EXT.includes(ext)) {
        const im = await addImage(p);
        L.pads.push(newPad(im.name, { imageId: im.id }));
        added++;
      } else {
        errors.push(`${baseName(p)}: format belum didukung`);
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  await saveLibrary();
  return { added, errors };
}

export function newPad(name: string, parts: { soundId?: string; imageId?: string }): Pad {
  const n = lib?.pads.length ?? 0;
  return { id: uid(), name, ...parts, imageMs: 2000, color: PAD_COLORS[n % PAD_COLORS.length] };
}

async function installStarter(L: Library) {
  try {
    const dir = await invoke<string>('starter_sfx_dir');
    const files = (await invoke<string[]>('list_dir', { path: dir })).filter((f) => f.endsWith('.ogg')).sort();
    for (const f of files) {
      const s = await addSound(join(dir, f), stem(f), true);
      L.pads.push(newPad(s.name, { soundId: s.id }));
    }
  } catch {
    // starter pack is optional
  }
  L.starterInstalled = true;
  await saveLibrary();
}

export async function deletePad(id: string) {
  const L = await loadLibrary();
  const pad = L.pads.find((p) => p.id === id);
  L.pads = L.pads.filter((p) => p.id !== id);
  // drop library files nothing else uses
  for (const key of ['soundId', 'imageId'] as const) {
    const ref = pad?.[key];
    if (!ref || L.pads.some((p) => p[key] === ref)) continue;
    const list = key === 'soundId' ? L.sounds : L.images;
    const item = list.find((x) => x.id === ref);
    if (item) await invoke('remove_path', { path: item.file }).catch(() => undefined);
    if (key === 'soundId') L.sounds = L.sounds.filter((x) => x.id !== ref);
    else L.images = L.images.filter((x) => x.id !== ref);
  }
  await saveLibrary();
}

export function movePad(from: number, to: number) {
  if (!lib) return;
  const [p] = lib.pads.splice(from, 1);
  lib.pads.splice(to, 0, p);
  void saveLibrary();
}

export const soundOf = (pad: Pad) => lib?.sounds.find((s) => s.id === pad.soundId);
export const imageOf = (pad: Pad) => lib?.images.find((s) => s.id === pad.imageId);
