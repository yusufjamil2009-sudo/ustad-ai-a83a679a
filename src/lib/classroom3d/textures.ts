/**
 * Texture engine — procedural PBR texture generation (albedo, normal, roughness, AO),
 * UV/repeat control, mipmaps, anisotropy, quality tiers, caching and disposal.
 * No external asset downloads: every map is generated once on canvas and uploaded to the GPU.
 */
import * as THREE from "three";
import type { QualityTier } from "./types";

export type SurfaceKind =
  | "wallPaint"
  | "floorTile"
  | "ceiling"
  | "wood"
  | "woodDark"
  | "metal"
  | "plastic"
  | "fabric"
  | "paper"
  | "boardFrame";

export type TextureSet = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
};

type Recipe = {
  base: [number, number, number];
  /** height/pattern painter, returns grayscale height canvas */
  pattern: (c: CanvasRenderingContext2D, s: number) => void;
  grain: number;
  roughBase: number;
  roughVar: number;
};

const RECIPES: Record<SurfaceKind, Recipe> = {
  wallPaint: {
    base: [0x6f, 0x79, 0x9c],
    pattern: plaster,
    grain: 0.05,
    roughBase: 0.82,
    roughVar: 0.1,
  },
  ceiling: {
    base: [0x8a, 0x90, 0xa8],
    pattern: panels,
    grain: 0.04,
    roughBase: 0.95,
    roughVar: 0.05,
  },
  floorTile: {
    base: [0x5b, 0x60, 0x77],
    pattern: tiles,
    grain: 0.06,
    roughBase: 0.55,
    roughVar: 0.25,
  },
  wood: {
    base: [0xa8, 0x76, 0x4a],
    pattern: woodGrain,
    grain: 0.08,
    roughBase: 0.6,
    roughVar: 0.2,
  },
  woodDark: {
    base: [0x6b, 0x4a, 0x2c],
    pattern: woodGrain,
    grain: 0.09,
    roughBase: 0.66,
    roughVar: 0.18,
  },
  metal: {
    base: [0xb6, 0xbc, 0xcc],
    pattern: brushed,
    grain: 0.03,
    roughBase: 0.32,
    roughVar: 0.14,
  },
  plastic: {
    base: [0x8f, 0x9a, 0xc4],
    pattern: plaster,
    grain: 0.02,
    roughBase: 0.45,
    roughVar: 0.08,
  },
  fabric: { base: [0x4a, 0x5b, 0x8c], pattern: weave, grain: 0.1, roughBase: 0.9, roughVar: 0.08 },
  paper: {
    base: [0xf1, 0xed, 0xe0],
    pattern: plaster,
    grain: 0.04,
    roughBase: 0.92,
    roughVar: 0.06,
  },
  boardFrame: {
    base: [0x2a, 0x31, 0x4a],
    pattern: brushed,
    grain: 0.03,
    roughBase: 0.4,
    roughVar: 0.12,
  },
};

/* ---------------- pattern painters (grayscale height) ---------------- */

function fill(c: CanvasRenderingContext2D, s: number, v: number) {
  c.fillStyle = `rgb(${v},${v},${v})`;
  c.fillRect(0, 0, s, s);
}

function plaster(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 128);
  for (let i = 0; i < s * 8; i++) {
    const v = 118 + Math.random() * 22;
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
}

function panels(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 140);
  c.strokeStyle = "rgb(96,96,96)";
  c.lineWidth = Math.max(2, s / 256);
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const p = (i / n) * s;
    c.beginPath();
    c.moveTo(p, 0);
    c.lineTo(p, s);
    c.moveTo(0, p);
    c.lineTo(s, p);
    c.stroke();
  }
}

function tiles(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 150);
  const n = 4;
  const cell = s / n;
  const gap = Math.max(2, s / 200);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 145 + Math.random() * 18;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(x * cell + gap, y * cell + gap, cell - gap * 2, cell - gap * 2);
    }
  }
  // grout lines darker = lower height
  c.strokeStyle = "rgb(70,70,70)";
  c.lineWidth = gap;
  for (let i = 0; i <= n; i++) {
    const p = i * cell;
    c.beginPath();
    c.moveTo(p, 0);
    c.lineTo(p, s);
    c.moveTo(0, p);
    c.lineTo(s, p);
    c.stroke();
  }
}

function woodGrain(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 138);
  for (let y = 0; y < s; y++) {
    const wave = Math.sin(y * 0.06) * 6 + Math.sin(y * 0.21) * 3;
    const v = 130 + wave + Math.random() * 8;
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.fillRect(0, y, s, 1);
  }
  for (let k = 0; k < 14; k++) {
    c.strokeStyle = `rgba(90,90,90,${0.25 + Math.random() * 0.35})`;
    c.lineWidth = 1 + Math.random() * 2;
    c.beginPath();
    const y0 = Math.random() * s;
    c.moveTo(0, y0);
    for (let x = 0; x <= s; x += 16) c.lineTo(x, y0 + Math.sin(x * 0.02 + k) * 5);
    c.stroke();
  }
}

function brushed(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 140);
  for (let i = 0; i < s * 3; i++) {
    const v = 132 + Math.random() * 16;
    c.strokeStyle = `rgb(${v},${v},${v})`;
    c.lineWidth = 1;
    const y = Math.random() * s;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(s, y);
    c.stroke();
  }
}

function weave(c: CanvasRenderingContext2D, s: number) {
  fill(c, s, 130);
  const step = Math.max(4, s / 64);
  for (let y = 0; y < s; y += step) {
    for (let x = 0; x < s; x += step) {
      const on = ((x / step) | 0) % 2 === ((y / step) | 0) % 2;
      const v = on ? 148 : 112;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(x, y, step, step);
    }
  }
}

/* ---------------- map derivation ---------------- */

function canvasOf(size: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  return { cv, ctx: cv.getContext("2d")! };
}

function tex(cv: HTMLCanvasElement, srgb: boolean, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Sobel height → tangent-space normal map. */
function normalFromHeight(h: ImageData, size: number, strength: number): HTMLCanvasElement {
  const { cv, ctx } = canvasOf(size);
  const out = ctx.createImageData(size, size);
  const at = (x: number, y: number) => {
    const xx = (x + size) % size;
    const yy = (y + size) % size;
    return h.data[(yy * size + xx) * 4]! / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
      const i = (y * size + x) * 4;
      out.data[i] = (n.x * 0.5 + 0.5) * 255;
      out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      out.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

export class TextureEngine {
  private cache = new Map<string, TextureSet>();
  private quality: QualityTier;
  private aniso: number;

  constructor(quality: QualityTier = "high", maxAnisotropy = 8) {
    this.quality = quality;
    this.aniso = Math.min(maxAnisotropy, quality === "low" ? 1 : quality === "medium" ? 4 : 8);
  }

  private get size(): number {
    // adaptive texture-quality system: never larger than needed
    return this.quality === "low" ? 256 : this.quality === "medium" ? 512 : 1024;
  }

  setQuality(q: QualityTier): void {
    if (q === this.quality) return;
    this.quality = q;
    this.aniso = q === "low" ? 1 : q === "medium" ? 4 : 8;
    // regenerate lazily: drop cache so new requests pick up the new resolution
    this.dispose();
  }

  /** Get (or build) the full PBR map set for a surface kind. Cached + reused. */
  get(kind: SurfaceKind): TextureSet {
    const key = `${kind}@${this.size}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const size = this.size;
    const r = RECIPES[kind];

    // 1. height / pattern
    const height = canvasOf(size);
    r.pattern(height.ctx, size);
    const hData = height.ctx.getImageData(0, 0, size, size);

    // 2. albedo = base colour modulated by height + grain
    const albedo = canvasOf(size);
    const aImg = albedo.ctx.createImageData(size, size);
    const rough = canvasOf(size);
    const rImg = rough.ctx.createImageData(size, size);
    const ao = canvasOf(size);
    const oImg = ao.ctx.createImageData(size, size);

    for (let i = 0; i < size * size; i++) {
      const hv = hData.data[i * 4]! / 255;
      const shade = 0.78 + hv * 0.44 + (Math.random() - 0.5) * r.grain;
      const p = i * 4;
      aImg.data[p] = clamp255(r.base[0] * shade);
      aImg.data[p + 1] = clamp255(r.base[1] * shade);
      aImg.data[p + 2] = clamp255(r.base[2] * shade);
      aImg.data[p + 3] = 255;

      const rv = clamp255((r.roughBase + (1 - hv) * r.roughVar) * 255);
      rImg.data[p] = rImg.data[p + 1] = rImg.data[p + 2] = rv;
      rImg.data[p + 3] = 255;

      // crevices (low height) occlude
      const av = clamp255((0.55 + hv * 0.45) * 255);
      oImg.data[p] = oImg.data[p + 1] = oImg.data[p + 2] = av;
      oImg.data[p + 3] = 255;
    }
    albedo.ctx.putImageData(aImg, 0, 0);
    rough.ctx.putImageData(rImg, 0, 0);
    ao.ctx.putImageData(oImg, 0, 0);

    const set: TextureSet = {
      map: tex(albedo.cv, true, this.aniso),
      normalMap: tex(normalFromHeight(hData, size, 3.2), false, this.aniso),
      roughnessMap: tex(rough.cv, false, this.aniso),
      aoMap: tex(ao.cv, false, this.aniso),
    };
    this.cache.set(key, set);
    return set;
  }

  /** Clone the set with independent UV repeat (keeps GPU image shared where possible). */
  repeated(kind: SurfaceKind, rx: number, ry: number, rotation = 0): TextureSet {
    const src = this.get(kind);
    const out = {} as TextureSet;
    (Object.keys(src) as (keyof TextureSet)[]).forEach((k) => {
      const t = src[k].clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.rotation = rotation;
      t.center.set(0.5, 0.5);
      t.needsUpdate = true;
      out[k] = t;
    });
    return out;
  }

  dispose(): void {
    this.cache.forEach((s) => Object.values(s).forEach((t) => t.dispose()));
    this.cache.clear();
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
