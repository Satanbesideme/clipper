// Local AI: a small language model (Qwen3, Apache 2.0) run by llama.cpp on the PC. Nothing leaves the PC.
// Used for: rating highlight moments, titles/descriptions/hashtags, and fixing subtitle typos.
import { invoke, join } from './tauri';
import { dataDir, uid } from './store';

export type AiModelId = 'pintar' | 'cepat';
export const AI_MODELS: Record<AiModelId, { name: string; hint: string; bytes: number; urls: string[] }> = {
  pintar: {
    name: 'Pintar', hint: 'Qwen3 4B · ±2,5 GB · hasil paling bagus', bytes: 2_500_000_000,
    urls: [
      'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
      'https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf',
      'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    ],
  },
  cepat: {
    name: 'Cepat', hint: 'Qwen3 1.7B · ±1,1 GB · lebih cepat di PC biasa', bytes: 1_100_000_000,
    urls: [
      'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
      'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
      'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf',
    ],
  },
};

export async function aiModelPath(id: AiModelId) { return join(await dataDir(), 'models', 'ai', `${id}.gguf`); }
export async function aiModelReady(id: AiModelId) { return (await invoke<number>('file_size', { path: await aiModelPath(id) })) > 300_000_000; }
export async function aiEngineReady() { return invoke<boolean>('llama_available').catch(() => false); }

/** Downloads a model, trying each mirror in turn. */
export async function downloadAiModel(id: AiModelId, onFrac: (f: number) => void) {
  const dest = await aiModelPath(id);
  const part = `${dest}.part`;
  const iv = window.setInterval(() => {
    void invoke<number>('file_size', { path: part }).then((n) => onFrac(Math.min(0.99, n / AI_MODELS[id].bytes)));
  }, 600);
  let last: unknown = null;
  try {
    for (const url of AI_MODELS[id].urls) {
      try { await invoke('download', { url, dest }); return; } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error(String(last ?? 'Unduhan gagal.'));
  } finally {
    window.clearInterval(iv);
  }
}

let aiJob: string | null = null;
export async function cancelAi() { if (aiJob) await invoke('ffmpeg_cancel', { job: aiJob }).catch(() => undefined); }

/**
 * Asks the model once and returns its answer as JSON shaped by `schema` (llama.cpp enforces the schema,
 * so the answer always parses). Qwen3's thinking is switched off with /no_think for speed.
 */
export async function aiJson<T>(model: AiModelId, system: string, user: string, schema: object, maxTokens = 700): Promise<T> {
  const dir = join(await dataDir(), 'ai-tmp');
  await invoke('ensure_dir', { path: dir });
  const id = uid().slice(0, 8);
  const promptFile = join(dir, `p-${id}.txt`), schemaFile = join(dir, `s-${id}.json`);
  const prompt = `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}\n\n/no_think<|im_end|>\n<|im_start|>assistant\n`;
  await invoke('write_text', { path: promptFile, content: prompt });
  await invoke('write_text', { path: schemaFile, content: JSON.stringify(schema) });
  const cpus = await invoke<number>('cpu_count').catch(() => 4);
  const ctx = Math.min(16384, Math.max(2048, Math.ceil(prompt.length / 2.6) + maxTokens + 256));
  aiJob = `ai-${id}`;
  try {
    const out = await invoke<string>('llama_run', {
      job: aiJob,
      args: ['-m', await aiModelPath(model), '-f', promptFile, '-no-cnv', '--no-display-prompt', '-n', String(maxTokens), '-c', String(ctx),
        '--temp', '0.6', '--top-p', '0.9', '-t', String(Math.max(2, Math.min(8, cpus - 1))), '-jf', schemaFile],
    });
    const a = out.indexOf('{'), b = out.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Jawaban AI tidak terbaca. Coba lagi.');
    // the switch word must never end up in an answer
    return JSON.parse(out.slice(a, b + 1).replace(/\s*\/no_think/g, '')) as T;
  } finally {
    aiJob = null;
    await invoke('remove_path', { path: promptFile }).catch(() => undefined);
    await invoke('remove_path', { path: schemaFile }).catch(() => undefined);
  }
}

// ---------- highlight finding (works without the model; the model then rates and names the moments) ----------

export interface Moment { startMs: number; endMs: number; score: number; loud: number; words: number; hits: string[]; text: string; title?: string; reason?: string; ai?: number }

const EXCITE = /^(wk|wkwk\w*|haha\w*|anjir\w*|anjay\w*|anjrit\w*|anjing|astaga\w*|buset\w*|gila\w*|gokil|woy\w*|wo+i*|a{3,}h*|ah{2,}|aduh\w*|mampus|mati|menang|kalah|hah+|loh+|lah+|serius|parah|gg|wtf|ez|kabur|lari|tolong|anj\w*|sial\w*|kampret\w*|bangsat\w*|mantap\w*|keren|takut|kaget)$/i;

/**
 * Scores windows of the timeline by loudness (shouting, laughing), exciting words and speech, and returns the
 * best non-overlapping ones. `loudAt(ms)` gives a loudness 0..1 at a timeline time.
 */
export function findMoments(totalMs: number, loudAt: (ms: number) => number, words: { text: string; startMs: number }[], lines: { startMs: number; endMs: number; text: string }[], lenMs: number, count: number): Moment[] {
  if (totalMs < lenMs * 0.6) lenMs = Math.max(5000, totalMs);
  const step = 250;
  const n = Math.max(1, Math.floor(totalMs / step));
  const loud = new Float32Array(n);
  for (let i = 0; i < n; i++) loud[i] = loudAt(i * step);
  const sorted = Float32Array.from(loud).sort();
  const med = sorted[Math.floor(n * 0.5)] ?? 0, p90 = sorted[Math.floor(n * 0.9)] ?? 1;
  const span = Math.max(0.02, p90 - med);
  const hitsAt = words.filter((w) => EXCITE.test(w.text.replace(/[^\p{L}]/gu, ''))).map((w) => ({ t: w.startMs, w: w.text }));
  const wins: Moment[] = [];
  for (let s = 0; s + Math.min(lenMs, totalMs) <= totalMs + 1; s += 2500) {
    const e = Math.min(totalMs, s + lenMs);
    const a = Math.floor(s / step), b = Math.max(a + 1, Math.floor(e / step));
    let sum = 0, peak = 0, over = 0;
    for (let i = a; i < b && i < n; i++) { const z = (loud[i] - med) / span; sum += z; if (z > peak) peak = z; if (loud[i] > p90) over++; }
    const mean = sum / (b - a);
    const hs = hitsAt.filter((x) => x.t >= s && x.t < e);
    const wc = words.filter((w) => w.startMs >= s && w.startMs < e).length;
    const score = mean * 1.2 + Math.min(3, peak) * 0.6 + (over / (b - a)) * 3 + Math.min(6, hs.length) * 0.7 + Math.min(1, wc / ((e - s) / 400)) * 0.6;
    wins.push({ startMs: s, endMs: e, score, loud: mean, words: wc, hits: hs.map((x) => x.w), text: '' });
  }
  wins.sort((x, y) => y.score - x.score);
  const out: Moment[] = [];
  for (const w of wins) {
    if (out.length >= count) break;
    if (out.some((o) => w.startMs < o.endMs + 3000 && w.endMs > o.startMs - 3000)) continue;
    // start at the beginning of a sentence: the caption line just before
    const ln = [...lines].reverse().find((l) => l.startMs <= w.startMs + 1500 && l.startMs >= w.startMs - 4000);
    if (ln) { const d = w.startMs - ln.startMs; w.startMs -= d; w.endMs = Math.min(totalMs, w.endMs - d); }
    w.text = lines.filter((l) => l.endMs > w.startMs && l.startMs < w.endMs).map((l) => l.text).join(' ').slice(0, 600);
    out.push(w);
  }
  const top = Math.max(...out.map((o) => o.score), 1e-6);
  for (const o of out) o.score = Math.round(Math.max(1, (o.score / top) * 10) * 10) / 10;
  return out.sort((x, y) => x.startMs - y.startMs);
}

// ---------- thumbnails ----------

/** How good a frame looks as a thumbnail: sharp, colourful, not too dark or blown out. */
export function frameScore(c: CanvasRenderingContext2D, w: number, h: number): number {
  let d: Uint8ClampedArray;
  try { d = c.getImageData(0, 0, w, h).data; } catch { return 0; }
  let lap = 0, col = 0, lum = 0, n = 0;
  const L = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = (y * w + x) * 4;
    const l = L(i);
    const v = 4 * l - L(i - 4) - L(i + 4) - L(i - w * 4) - L(i + w * 4);
    lap += v * v;
    const rg = Math.abs(d[i] - d[i + 1]), yb = Math.abs((d[i] + d[i + 1]) / 2 - d[i + 2]);
    col += Math.sqrt(rg * rg + yb * yb);
    lum += l; n++;
  }
  if (!n) return 0;
  const sharp = Math.log10(1 + lap / n), colour = col / n / 60, bright = lum / n / 255;
  return sharp * 1.0 + colour * 1.2 - Math.abs(bright - 0.5) * 1.5;
}
