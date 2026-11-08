// Runs every export feature through the real ffmpeg build the app ships, one scenario at a time,
// so a failure points at the feature. Usage: node build-test/tests/export-scenarios.js <ffmpeg> <workdir> <fontsdir> <font>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DEFAULT_CAPTION, DEFAULT_TEXT, buildAss, renderArgs, type Timeline, type Media, type ImageItem } from '../src/render';

const [ffmpeg, dir, fontsDir, font] = process.argv.slice(2);
const run = (args: string[]) => spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const make = (args: string[]) => { const r = run(['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status) throw new Error(r.stderr); };

make(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=12', '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*220*t)*lt(mod(t\\,3.5)\\,2):s=48000:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', `${dir}/vod.mp4`]);
make(['-f', 'lavfi', '-i', 'color=c=black@0:s=400x300,format=rgba', '-vf', "geq=r='255':g='106':b='26':a='if(lt(hypot(X-200\\,Y-150)\\,140)\\,255\\,0)'", '-frames:v', '1', `${dir}/meme.png`]);
make(['-f', 'lavfi', '-i', 'color=c=white:s=200x200:r=10:d=1', '-vf', "geq=r='255*(1-mod(N\\,10)/10)':g='212':b='0'", `${dir}/anim.gif`]);
make(['-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*1320*t)*exp(-4.5*t):s=48000:d=1.2', '-c:a', 'libvorbis', `${dir}/sfx.ogg`]);
make(['-f', 'lavfi', '-i', 'aevalsrc=0.15*(sin(2*PI*261.6*t)+sin(2*PI*329.6*t)):s=48000:d=30', '-c:a', 'libvorbis', `${dir}/music.ogg`]);

const media: Record<string, Media> = { m: { id: 'm', path: '', playable: `${dir}/vod.mp4`, name: 'vod', durationMs: 12000, width: 1080, height: 1920, fps: 30, hasAudio: true } };
const base = (): Timeline => ({
  width: 1080, height: 1920, fps: 30,
  clips: [{ id: 'a', mediaId: 'm', inMs: 0, outMs: 4000, speed: 1, volume: 1, fit: 'fill' }, { id: 'b', mediaId: 'm', inMs: 5000, outMs: 9000, speed: 1, volume: 1, fit: 'fill' }],
  texts: [], captions: { mode: 'word', y: 0.7, style: { ...DEFAULT_CAPTION, font }, lines: [] }, sounds: [], images: [], music: [], watermark: null,
});
const meme = (id: string, file: string, a: number, b: number, tin: ImageItem['transIn'], tout: ImageItem['transOut'], animated = false): ImageItem =>
  ({ id, file, name: id, startMs: a, endMs: b, x: 0.5, y: 0.4, scale: 0.5, aspect: animated ? 1 : 400 / 300, animated, transIn: tin, transOut: tout });

const scenarios: [string, (tl: Timeline) => void][] = [
  ['dasar (2 potongan)', () => undefined],
  ['zoom statis 150%', (tl) => { tl.clips[1].zoom = 1.5; tl.clips[1].zx = 0.7; }],
  ['speed 2x', (tl) => { tl.clips[1].speed = 2; }],
  ['transisi punch', (tl) => { tl.clips[1].trans = 'punch'; tl.clips[1].zoom = 1.4; }],
  ['transisi guncang', (tl) => { tl.clips[1].trans = 'shake'; }],
  ['transisi blur', (tl) => { tl.clips[1].trans = 'blur'; }],
  ['transisi kilat', (tl) => { tl.clips[1].trans = 'flash'; }],
  ['transisi gelap', (tl) => { tl.clips[1].trans = 'fade'; }],
  ['meme png tanpa animasi', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'none', 'none')]; }],
  ['meme pop', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'pop', 'pop')]; }],
  ['meme fade', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'fade', 'fade')]; }],
  ['meme pop masuk + fade keluar (default)', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'pop', 'fade')]; }],
  ['meme fade masuk + pop keluar', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'fade', 'pop')]; }],
  ['meme geser', (tl) => { tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'slide', 'slide')]; }],
  ['gif bergerak', (tl) => { tl.images = [meme('g', `${dir}/anim.gif`, 500, 2500, 'pop', 'fade', true)]; }],
  ['efek suara', (tl) => { tl.sounds = [{ id: 's', file: `${dir}/sfx.ogg`, name: 's', startMs: 1000, lengthMs: 1200, sourceMs: 1200, volume: 1 }]; }],
  ['musik + ducking', (tl) => { tl.music = [{ id: 'mu', file: `${dir}/music.ogg`, name: 'm', startMs: 0, inMs: 0, lengthMs: 30000, sourceMs: 30000, volume: 0.5, duck: 'medium' }]; }],
  ['watermark', (tl) => { tl.watermark = { file: `${dir}/meme.png`, aspect: 400 / 300, corner: 'tr', scale: 0.2, opacity: 0.8 }; }],
  ['subtitle kata menyala', (tl) => { tl.captions.lines = [{ id: 'l', startMs: 300, endMs: 2000, words: [{ text: 'halo', startMs: 300, endMs: 800 }, { text: 'semua', startMs: 800, endMs: 2000 }] }]; }],
  ['layer dari video utama (gameplay atas, facecam bawah, utama disembunyikan)', (tl) => {
    tl.hideMain = true;
    tl.clips[1].speed = 1.5;
    tl.layers = [
      { id: 'g', name: 'Gameplay', source: 'main', inMs: 0, startMs: 0, endMs: 99999, crop: { l: 0, t: 0.05, r: 0, b: 0.6 }, box: { x: 0.5, y: 0.3, w: 1, h: 0.6 }, opacity: 1, volume: 0 },
      { id: 'c', name: 'Facecam', source: 'main', inMs: 0, startMs: 0, endMs: 99999, crop: { l: 0.1, t: 0.6, r: 0.1, b: 0 }, box: { x: 0.5, y: 0.8, w: 1, h: 0.4 }, opacity: 1, volume: 0 },
    ];
  }],
  ['layer dari video utama tanpa menyembunyikan', (tl) => {
    tl.layers = [{ id: 'g', name: 'Zoom', source: 'main', inMs: 0, startMs: 1000, endMs: 3000, crop: { l: 0.2, t: 0.2, r: 0.2, b: 0.4 }, box: { x: 0.7, y: 0.25, w: 0.5, h: 0.35 }, opacity: 0.8, volume: 0 }];
  }],
  ['layer video lain dengan suara', (tl) => {
    tl.layers = [{ id: 'o', name: 'Lain', source: 'media', mediaId: 'm', inMs: 6000, startMs: 2000, endMs: 5000, crop: { l: 0.1, t: 0.1, r: 0.1, b: 0.5 }, box: { x: 0.5, y: 0.5, w: 0.6, h: 0.3 }, opacity: 1, volume: 0.8 }];
  }],
  ['kualitas 40%', () => undefined],
  ...(['pop', 'fade', 'rise', 'shake', 'word', 'bounce'] as const).flatMap((a) => (['word', 'line'] as const).map((mode): [string, (tl: Timeline) => void] => [`subtitle animasi ${a} (${mode})`, (tl) => {
    tl.captions.mode = mode;
    tl.captions.anim = a;
    tl.captions.lines = [
      { id: 'l1', startMs: 300, endMs: 1800, words: [{ text: 'halo', startMs: 300, endMs: 700 }, { text: 'semua', startMs: 700, endMs: 1200 }, { text: 'gas', startMs: 1200, endMs: 1800 }] },
      { id: 'l2', startMs: 1800, endMs: 2600, words: [{ text: 'oke', startMs: 1800, endMs: 2600 }] },
    ];
  }])),
  ...(['pop', 'fade', 'rise', 'type', 'shake'] as const).map((a): [string, (tl: Timeline) => void] => [`teks animasi ${a}`, (tl) => {
    tl.texts = [{ id: 't', startMs: 200, endMs: 2600, text: 'MOMEN\nGILA', x: 0.5, y: 0.3, style: { ...DEFAULT_TEXT, font }, anim: a }];
  }]),
  ['teks dengan kotak', (tl) => { tl.texts = [{ id: 't', startMs: 0, endMs: 3000, text: 'MOMEN', x: 0.5, y: 0.2, style: { ...DEFAULT_TEXT, font, box: true } }]; }],
];
scenarios.push(['SEMUA SEKALIGUS', (tl) => { for (const [name, f] of scenarios) if (name !== 'SEMUA SEKALIGUS' && !name.startsWith('meme') && !name.startsWith('layer') && name !== 'speed 2x') f(tl); tl.images = [meme('i', `${dir}/meme.png`, 500, 2500, 'pop', 'fade'), meme('g', `${dir}/anim.gif`, 4500, 6500, 'slide', 'pop', true)]; tl.clips[1].trans = 'punch'; tl.layers = [{ id: 'g', name: 'G', source: 'main', inMs: 0, startMs: 0, endMs: 99999, crop: { l: 0, t: 0, r: 0, b: 0.5 }, box: { x: 0.5, y: 0.25, w: 1, h: 0.5 }, opacity: 1, volume: 0 }, { id: 'o', name: 'O', source: 'media', mediaId: 'm', inMs: 2000, startMs: 1000, endMs: 4000, crop: { l: 0, t: 0.5, r: 0, b: 0 }, box: { x: 0.5, y: 0.75, w: 1, h: 0.5 }, opacity: 1, volume: 0.5 }]; tl.hideMain = true; }]);

let failed = 0;
for (const [name, setup] of scenarios) {
  const tl = base();
  setup(tl);
  let assFile: string | undefined;
  if (tl.texts.length || tl.captions.lines.length) { assFile = `${dir}/subs.ass`; writeFileSync(assFile, buildAss(tl)); }
  const q = name.startsWith('kualitas') ? 0.4 : 1;
  const args = renderArgs({ tl, media, encoder: 'libx264', bitrateK: Math.round(8000 * q), quality: q, assFile, fontsDir, outPath: `${dir}/out.mp4` });
  const r = run(args);
  if (r.status === 0) { console.log(`OK    ${name}`); continue; }
  failed++;
  const lines = r.stderr.split('\n').filter((l) => /error|invalid|failed|not supported|cannot|unable|no such|unknown|mismatch|reinit|changing/i.test(l)).slice(-8);
  console.log(`GAGAL ${name}\n      ${lines.join('\n      ')}`);
}
const v = run(['-version']).stdout.split('\n')[0];
console.log(`\n${v}\n${failed} gagal dari ${scenarios.length}`);
process.exit(failed ? 1 : 0);
