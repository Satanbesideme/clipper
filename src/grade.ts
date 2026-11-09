// Colour grading: one model, three uses. The same maths runs in a WebGL shader for the preview and in
// JavaScript to bake a .cube LUT for the export (ffmpeg lut3d), so what you see is what you export.
// Spatial effects (sharpness, vignette) are not in the LUT: the preview and ffmpeg each do their own.

export interface Grade {
  exposure: number;    // -2..2 stops
  contrast: number;    // -1..1
  highlights: number;  // -1..1
  shadows: number;     // -1..1
  fade: number;        // 0..1, lifts the blacks
  temperature: number; // -1 cool .. 1 warm
  tint: number;        // -1 green .. 1 magenta
  saturation: number;  // -1..1 (-1 = black and white)
  vibrance: number;    // -1..1, saturation that spares already colourful pixels
  sharpen: number;     // 0..1
  vignette: number;    // 0..1
  lut?: string;        // absolute path of a .cube file
  lutAmount?: number;  // 0..1
  look?: string;       // name of the look it started from
}

export const NEUTRAL: Grade = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, fade: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, sharpen: 0, vignette: 0 };

export const LOOKS: { id: string; name: string; g: Partial<Grade> }[] = [
  { id: 'natural', name: 'Natural', g: {} },
  { id: 'vivid', name: 'Vivid', g: { contrast: 0.12, saturation: 0.22, vibrance: 0.3, sharpen: 0.3 } },
  { id: 'cinematic', name: 'Cinematic', g: { contrast: 0.2, saturation: -0.12, fade: 0.15, temperature: 0.08, highlights: -0.15, vignette: 0.35 } },
  { id: 'gaming', name: 'Gaming Pop', g: { contrast: 0.18, saturation: 0.32, vibrance: 0.4, highlights: -0.15, shadows: 0.1, sharpen: 0.45 } },
  { id: 'warm', name: 'Warm', g: { temperature: 0.35, saturation: 0.05, highlights: -0.1 } },
  { id: 'cool', name: 'Cool', g: { temperature: -0.3, tint: 0.05, contrast: 0.08 } },
  { id: 'moody', name: 'Moody', g: { exposure: -0.25, contrast: 0.22, saturation: -0.22, shadows: -0.12, temperature: -0.1, vignette: 0.45 } },
  { id: 'film', name: 'Film', g: { fade: 0.4, contrast: -0.08, saturation: -0.15, temperature: 0.1, vignette: 0.25 } },
  { id: 'bw', name: 'B&W', g: { saturation: -1, contrast: 0.25, sharpen: 0.2 } },
];

export const gradeOf = (g?: Partial<Grade> | null): Grade => ({ ...NEUTRAL, ...(g ?? {}) });

/** True when the grade changes nothing (so nothing needs to run). */
export function isNeutral(g?: Partial<Grade> | null): boolean {
  if (!g) return true;
  const x = gradeOf(g);
  return !hasColour(x) && x.sharpen < 0.005 && x.vignette < 0.005;
}
export function hasColour(g: Grade): boolean {
  return Math.abs(g.exposure) > 0.005 || Math.abs(g.contrast) > 0.005 || Math.abs(g.highlights) > 0.005 || Math.abs(g.shadows) > 0.005 ||
    g.fade > 0.005 || Math.abs(g.temperature) > 0.005 || Math.abs(g.tint) > 0.005 || Math.abs(g.saturation) > 0.005 ||
    Math.abs(g.vibrance) > 0.005 || (!!g.lut && (g.lutAmount ?? 1) > 0.005);
}

// ---------- the colour maths (keep in step with the shader below) ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Grades one pixel (sRGB 0..1) without the LUT. */
export function gradeRgb(r: number, g: number, b: number, x: Grade): [number, number, number] {
  // exposure in linear light
  const e = Math.pow(2, x.exposure);
  r = Math.pow(Math.pow(r, 2.2) * e, 1 / 2.2); g = Math.pow(Math.pow(g, 2.2) * e, 1 / 2.2); b = Math.pow(Math.pow(b, 2.2) * e, 1 / 2.2);
  // white balance
  r *= 1 + 0.12 * x.temperature + 0.05 * x.tint;
  b *= 1 - 0.12 * x.temperature + 0.05 * x.tint;
  g *= 1 - 0.09 * x.tint;
  // highlights / shadows
  let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ws = Math.pow(1 - clamp01(L), 2), wh = Math.pow(clamp01(L), 2);
  const lift = 0.3 * x.shadows * ws + 0.3 * x.highlights * wh;
  r += lift; g += lift; b += lift;
  // contrast around mid grey
  const k = 1 + x.contrast;
  r = (r - 0.5) * k + 0.5; g = (g - 0.5) * k + 0.5; b = (b - 0.5) * k + 0.5;
  // saturation + vibrance
  L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const s = Math.max(0, (1 + x.saturation) * (1 + x.vibrance * (1 - clamp01(sat * 1.5))));
  r = L + (r - L) * s; g = L + (g - L) * s; b = L + (b - L) * s;
  // fade: lift the blacks
  const f = 0.14 * x.fade;
  r = f + r * (1 - f); g = f + g * (1 - f); b = f + b * (1 - f);
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// ---------- .cube files ----------

export interface Cube { size: number; data: Float32Array }   // r fastest, then g, then b (cube order)

export function parseCube(text: string): Cube {
  let size = 0;
  const vals: number[] = [];
  let min = [0, 0, 0], max = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { min = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { max = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]/.test(up)) continue;   // TITLE, LUT_1D_SIZE, ...
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((n) => Number.isFinite(n))) vals.push(p[0], p[1], p[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('File LUT tidak bisa dibaca (harus .cube 3D).');
  const data = new Float32Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    data[i] = clamp01((vals[i] - min[c]) / ((max[c] - min[c]) || 1));
  }
  return { size, data };
}

/** Trilinear lookup in a cube. */
export function sampleCube(cube: Cube, r: number, g: number, b: number): [number, number, number] {
  const n = cube.size - 1;
  const fr = clamp01(r) * n, fg = clamp01(g) * n, fb = clamp01(b) * n;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const at = (ri: number, gi: number, bi: number, c: number) => cube.data[((bi * cube.size + gi) * cube.size + ri) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(r0, g0, b0, c) * (1 - dr) + at(r1, g0, b0, c) * dr;
    const c10 = at(r0, g1, b0, c) * (1 - dr) + at(r1, g1, b0, c) * dr;
    const c01 = at(r0, g0, b1, c) * (1 - dr) + at(r1, g0, b1, c) * dr;
    const c11 = at(r0, g1, b1, c) * (1 - dr) + at(r1, g1, b1, c) * dr;
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db;
  }
  return out;
}

/** The whole colour part of a grade (adjustments, then the user's LUT at its strength) as a .cube text. */
export function bakeCube(x: Grade, user: Cube | null, size = 33): string {
  const lines = ['TITLE "Gals Clip Studio grade"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const amt = user ? clamp01(x.lutAmount ?? 1) : 0;
  const n = size - 1;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    let [r, g, b] = gradeRgb(ri / n, gi / n, bi / n, x);
    if (user && amt > 0) {
      const [lr, lg, lb] = sampleCube(user, r, g, b);
      r += (lr - r) * amt; g += (lg - g) * amt; b += (lb - b) * amt;
    }
    lines.push(`${r.toFixed(5)} ${g.toFixed(5)} ${b.toFixed(5)}`);
  }
  return lines.join('\n') + '\n';
}

/** ffmpeg filters for sharpness and vignette (on the canvas-sized picture). */
export function spatialFilters(x: Grade): string[] {
  const out: string[] = [];
  if (x.sharpen > 0.005) out.push(`unsharp=5:5:${(x.sharpen * 1.6).toFixed(3)}:5:5:0`);
  if (x.vignette > 0.005) out.push(`vignette=angle=${(0.25 + x.vignette * 0.75).toFixed(3)}`);
  return out;
}

// ---------- preview (WebGL2) ----------

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform sampler3D lut; uniform float lutAmt; uniform float lutN;
uniform vec2 texel; uniform float sharpen;
uniform float exposure, contrast, highlights, shadows, fade, temperature, tint, saturation, vibrance;
vec3 grade(vec3 c) {
  float e = exp2(exposure);
  c = pow(pow(max(c, 0.0), vec3(2.2)) * e, vec3(1.0 / 2.2));
  c.r *= 1.0 + 0.12 * temperature + 0.05 * tint;
  c.b *= 1.0 - 0.12 * temperature + 0.05 * tint;
  c.g *= 1.0 - 0.09 * tint;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float ws = pow(1.0 - clamp(L, 0.0, 1.0), 2.0), wh = pow(clamp(L, 0.0, 1.0), 2.0);
  c += 0.3 * shadows * ws + 0.3 * highlights * wh;
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float s = max(0.0, (1.0 + saturation) * (1.0 + vibrance * (1.0 - clamp(sat * 1.5, 0.0, 1.0))));
  c = L + (c - L) * s;
  float f = 0.14 * fade;
  c = f + c * (1.0 - f);
  return clamp(c, 0.0, 1.0);
}
void main() {
  vec3 c = texture(src, uv).rgb;
  if (sharpen > 0.0) {
    vec3 n = texture(src, uv + vec2(texel.x, 0.0)).rgb + texture(src, uv - vec2(texel.x, 0.0)).rgb
           + texture(src, uv + vec2(0.0, texel.y)).rgb + texture(src, uv - vec2(0.0, texel.y)).rgb;
    c = clamp(c + (c - n * 0.25) * sharpen * 1.6, 0.0, 1.0);
  }
  c = grade(c);
  if (lutAmt > 0.0) {
    vec3 q = c * ((lutN - 1.0) / lutN) + 0.5 / lutN;
    c = mix(c, texture(lut, q).rgb, lutAmt);
  }
  o = vec4(c, 1.0);
}`;

let gl: WebGL2RenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let prog: WebGLProgram | null = null;
let srcTex: WebGLTexture | null = null;
let failed = false;
const lutTex = new Map<string, { tex: WebGLTexture; size: number }>();
let emptyLut: WebGLTexture | null = null;
const uni = new Map<string, WebGLUniformLocation | null>();

function setup(): boolean {
  if (gl) return true;
  if (failed) return false;
  try {
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('no webgl2');
    const sh = (type: number, srcText: string) => {
      const s = gl!.createShader(type)!; gl!.shaderSource(s, srcText); gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    emptyLut = makeLut({ size: 2, data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]) });
    for (const n of ['src', 'lut', 'lutAmt', 'lutN', 'texel', 'sharpen', 'exposure', 'contrast', 'highlights', 'shadows', 'fade', 'temperature', 'tint', 'saturation', 'vibrance']) uni.set(n, gl.getUniformLocation(prog, n));
    gl.uniform1i(uni.get('src')!, 0); gl.uniform1i(uni.get('lut')!, 1);
    return true;
  } catch {
    failed = true; gl = null;
    return false;
  }
}

function makeLut(cube: Cube): WebGLTexture {
  const g = gl!;
  const tex = g.createTexture()!;
  g.activeTexture(g.TEXTURE1);
  g.bindTexture(g.TEXTURE_3D, tex);
  const n = cube.size;
  const bytes = new Uint8Array(n * n * n * 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(cube.data[i] * 255);
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  g.texImage3D(g.TEXTURE_3D, 0, g.RGB8, n, n, n, 0, g.RGB, g.UNSIGNED_BYTE, bytes);
  for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_R, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_3D, k, v);
  g.activeTexture(g.TEXTURE0);
  return tex;
}

/** Registers a parsed LUT for the preview under its file path. */
export function registerLut(path: string, cube: Cube) {
  if (!setup()) return;
  const old = lutTex.get(path);
  if (old) gl!.deleteTexture(old.tex);
  lutTex.set(path, { tex: makeLut(cube), size: cube.size });
}
export const lutReady = (path: string) => lutTex.has(path);

/**
 * Grades a picture for the preview. Returns a canvas `w` x `h` (the size it will be drawn at),
 * or null when WebGL is not available (the caller then draws the picture as it is).
 */
export function gradeImage(src: TexImageSource, w: number, h: number, x: Grade): HTMLCanvasElement | null {
  if (!setup()) return null;
  const g = gl!, cv = glCanvas!;
  w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.viewport(0, 0, w, h);
  g.activeTexture(g.TEXTURE0);
  g.bindTexture(g.TEXTURE_2D, srcTex);
  try { g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src); } catch { return null; }
  const lt = x.lut ? lutTex.get(x.lut) : undefined;
  g.activeTexture(g.TEXTURE1);
  g.bindTexture(g.TEXTURE_3D, lt?.tex ?? emptyLut);
  g.activeTexture(g.TEXTURE0);
  g.uniform1f(uni.get('lutAmt')!, lt ? clamp01(x.lutAmount ?? 1) : 0);
  g.uniform1f(uni.get('lutN')!, lt?.size ?? 2);
  g.uniform2f(uni.get('texel')!, 1 / w, 1 / h);
  g.uniform1f(uni.get('sharpen')!, x.sharpen);
  for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'fade', 'temperature', 'tint', 'saturation', 'vibrance'] as const) g.uniform1f(uni.get(k)!, x[k]);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return cv;
}

/** Darkens the edges like ffmpeg's vignette, over a rectangle of the preview. */
export function drawVignette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number) {
  if (amount <= 0.005) return;
  const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
  const gr = ctx.createRadialGradient(cx, cy, r * (0.75 - 0.45 * amount), cx, cy, r);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, 0.25 + amount * 0.6)})`);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
  ctx.restore();
}
