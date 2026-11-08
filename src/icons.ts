// Line icons on a 24px grid, drawn as SVG in the interface and as Path2D on the timeline canvas.

const P: Record<string, string[]> = {
  media: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v18', 'M17 3v18', 'M3 8h4', 'M3 16h4', 'M17 8h4', 'M17 16h4', 'M3 12h18'],
  layers: ['M12 2.5 2.5 7.5l9.5 5 9.5-5-9.5-5z', 'M2.5 16.5l9.5 5 9.5-5', 'M2.5 12l9.5 5 9.5-5'],
  music: ['M9 18V5l12-2v13', 'M6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6z', 'M18 13a3 3 0 1 0 0 6 3 3 0 1 0 0-6z'],
  meme: ['M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19z', 'M8 14s1.5 2.2 4 2.2 4-2.2 4-2.2', 'M9 9.5h.01', 'M15 9.5h.01'],
  vmeme: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M10 9.2v5.6l4.8-2.8z'],
  text: ['M4 7V4.5h16V7', 'M9 20h6', 'M12 4.5V20'],
  captions: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M7 10.5h5', 'M14.5 10.5h2.5', 'M7 14.5h2.5', 'M12 14.5h5'],
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z', 'M21 15l-5-5L5 21'],
  wave: ['M3 10v4', 'M7 6v12', 'M11 3v18', 'M15 8v8', 'M19 10v4'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  split: ['M6 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6z', 'M6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6z', 'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  silence: ['M3 10v4', 'M7 6v12', 'M11 9v6', 'M14.5 12h6.5'],
  minus: ['M5 12h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  fit: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  play: ['M7 4.6v14.8a1 1 0 0 0 1.5.86l12.2-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z'],
  pause: ['M6.5 4h3.5v16H6.5z', 'M14 4h3.5v16H14z'],
  stop: ['M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
  back: ['M11 17l-5-5 5-5', 'M18 17l-5-5 5-5'],
  forward: ['M13 17l5-5-5-5', 'M6 17l5-5-5-5'],
  help: ['M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  export: ['M12 15V3', 'M7 8l5-5 5 5', 'M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'],
  home: ['M15 18l-6-6 6-6'],
  safe: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2'],
  up: ['M12 19V5', 'M5 12l7-7 7 7'],
  down: ['M12 5v14', 'M19 12l-7 7-7-7'],
  panelLeft: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18'],
  panelRight: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  sparkle: ['M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z'],
  video: ['M15 10l5-3v10l-5-3', 'M4 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
};
const FILLED = new Set(['play', 'pause', 'stop']);

export type IconName = keyof typeof P;

export function icon(name: IconName, size = 18, cls = ''): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', `ico${cls ? ' ' + cls : ''}`);
  const filled = FILLED.has(name);
  s.setAttribute('fill', filled ? 'currentColor' : 'none');
  s.setAttribute('stroke', filled ? 'none' : 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  for (const d of P[name] ?? []) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

const cache = new Map<string, Path2D[]>();
/** Strokes an icon on a canvas at (x, y) with the given size. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
  let paths = cache.get(name);
  if (!paths) { paths = (P[name] ?? []).map((d) => new Path2D(d)); cache.set(name, paths); }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 1.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of paths) { if (FILLED.has(name)) ctx.fill(p); else ctx.stroke(p); }
  ctx.restore();
}
