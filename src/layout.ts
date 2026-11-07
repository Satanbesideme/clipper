// Geometry for the crop boxes. All rects are relative (0..1) to the source frame.
import { cropAspectFor, splitHeights, OUT_W, OUT_H, type Layout, type Rect } from './ffmpeg';

export type Part = 'main' | 'cam';

/** w/h (in relative units) a part's crop box must keep. */
export function partAspect(layout: Layout, part: Part, srcW: number, srcH: number): number {
  if (layout.type === 'crop') return cropAspectFor(OUT_W, OUT_H, srcW, srcH);
  const h = splitHeights(layout);
  return cropAspectFor(OUT_W, part === 'cam' ? h.cam : h.main, srcW, srcH);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the centre, changes height (and width if needed) to match the aspect, stays inside the frame. */
export function fitToAspect(r: Rect, aspect: number): Rect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = clamp(r.w, 0.02, 1);
  let h = w / aspect;
  if (h > 1) { h = 1; w = aspect; }
  if (w > 1) { w = 1; h = 1 / aspect; }
  return place({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function place(r: Rect): Rect {
  return { x: clamp(r.x, 0, 1 - r.w), y: clamp(r.y, 0, 1 - r.h), w: r.w, h: r.h };
}

export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return place({ ...r, x: r.x + dx, y: r.y + dy });
}

/** Resize from the bottom-right corner, keeping the top-left fixed and the aspect locked. */
export function resizeRect(r: Rect, newW: number, aspect: number): Rect {
  let w = clamp(newW, 0.03, 1 - r.x);
  let h = w / aspect;
  if (r.y + h > 1) { h = 1 - r.y; w = h * aspect; }
  return { x: r.x, y: r.y, w, h };
}

export function normalize(layout: Layout, srcW: number, srcH: number): Layout {
  const out: Layout = structuredClone(layout);
  out.main = fitToAspect(out.main, partAspect(out, 'main', srcW, srcH));
  if (out.type === 'split') {
    out.cam = fitToAspect(out.cam ?? { x: 0.75, y: 0.7, w: 0.25, h: 0.3 }, partAspect(out, 'cam', srcW, srcH));
    out.camPosition = out.camPosition ?? 'top';
    if (!out.camRatio) out.camRatio = 0.4;
  }
  return out;
}

/** Switches between single crop and facecam split, keeping what can be kept. */
export function withType(layout: Layout, type: Layout['type'], srcW: number, srcH: number): Layout {
  const l: Layout = { ...structuredClone(layout), type };
  if (type === 'split') {
    l.camRatio = l.camRatio || 0.4;
    l.camPosition = l.camPosition ?? 'top';
    l.name = 'Facecam + gameplay';
  } else {
    l.name = 'Crop';
  }
  return normalize(l, srcW, srcH);
}
