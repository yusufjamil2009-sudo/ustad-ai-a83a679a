/**
 * Material library — reusable PBR presets wired to the texture engine.
 * One material instance per preset (reused across meshes) to keep draw calls and memory low.
 */
import * as THREE from "three";
import { TextureEngine, type SurfaceKind } from "./textures";
import type { QualityTier } from "./types";

export type MaterialId =
  | "WALL_PAINT_PBR"
  | "FLOOR_TILE_PBR"
  | "CEILING_PBR"
  | "WOOD_DESK_PBR"
  | "WOOD_CHAIR_PBR"
  | "DOOR_PBR"
  | "METAL_PBR"
  | "PLASTIC_PBR"
  | "GLASS_PBR"
  | "BOARD_FRAME_PBR"
  | "FABRIC_PBR"
  | "PAPER_PBR";

type Preset = {
  surface: SurfaceKind | null;
  color: number;
  roughness: number;
  metalness: number;
  repeat: [number, number];
  normalScale?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
};

const PRESETS: Record<MaterialId, Preset> = {
  WALL_PAINT_PBR: {
    surface: "wallPaint",
    color: 0xa9b2d0,
    roughness: 0.85,
    metalness: 0.02,
    repeat: [4, 1.6],
    normalScale: 0.35,
  },
  FLOOR_TILE_PBR: {
    surface: "floorTile",
    color: 0x8f96ad,
    roughness: 0.5,
    metalness: 0.04,
    repeat: [6, 6],
    normalScale: 0.8,
  },
  CEILING_PBR: {
    surface: "ceiling",
    color: 0x9aa0b8,
    roughness: 0.95,
    metalness: 0.0,
    repeat: [4, 4],
    normalScale: 0.5,
  },
  WOOD_DESK_PBR: {
    surface: "wood",
    color: 0xd8ae82,
    roughness: 0.55,
    metalness: 0.03,
    repeat: [2, 1],
    normalScale: 0.6,
  },
  WOOD_CHAIR_PBR: {
    surface: "woodDark",
    color: 0xb08558,
    roughness: 0.65,
    metalness: 0.03,
    repeat: [1.5, 1],
    normalScale: 0.6,
  },
  DOOR_PBR: {
    surface: "woodDark",
    color: 0xa9764a,
    roughness: 0.6,
    metalness: 0.03,
    repeat: [1, 2],
    normalScale: 0.7,
  },
  METAL_PBR: {
    surface: "metal",
    color: 0xd6dae6,
    roughness: 0.3,
    metalness: 0.85,
    repeat: [2, 2],
    normalScale: 0.4,
  },
  PLASTIC_PBR: {
    surface: "plastic",
    color: 0xb6c0e6,
    roughness: 0.4,
    metalness: 0.05,
    repeat: [2, 2],
    normalScale: 0.25,
  },
  GLASS_PBR: {
    surface: null,
    color: 0xbfe4ff,
    roughness: 0.08,
    metalness: 0.0,
    repeat: [1, 1],
    transparent: true,
    opacity: 0.35,
    emissive: 0x9fd8ff,
    emissiveIntensity: 0.5,
  },
  BOARD_FRAME_PBR: {
    surface: "boardFrame",
    color: 0x39415e,
    roughness: 0.42,
    metalness: 0.55,
    repeat: [4, 2],
    normalScale: 0.4,
  },
  FABRIC_PBR: {
    surface: "fabric",
    color: 0x7f8cc0,
    roughness: 0.92,
    metalness: 0.0,
    repeat: [3, 3],
    normalScale: 0.9,
  },
  PAPER_PBR: {
    surface: "paper",
    color: 0xf6f2e6,
    roughness: 0.92,
    metalness: 0.0,
    repeat: [1, 1],
    normalScale: 0.2,
  },
};

export class MaterialLibrary {
  readonly textures: TextureEngine;
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private plain = new Map<string, THREE.MeshStandardMaterial>();

  constructor(quality: QualityTier = "high", maxAnisotropy = 8) {
    this.textures = new TextureEngine(quality, maxAnisotropy);
  }

  /** Get a shared PBR material for a preset, optionally with custom UV repeat. */
  get(id: MaterialId, repeat?: [number, number]): THREE.MeshStandardMaterial {
    const p = PRESETS[id];
    const rep = repeat ?? p.repeat;
    const key = `${id}:${rep[0]}x${rep[1]}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const base: THREE.MeshStandardMaterialParameters = {
      color: p.color,
      roughness: p.roughness,
      metalness: p.metalness,
    };
    if (p.transparent) {
      base.transparent = true;
      base.opacity = p.opacity ?? 0.4;
    }
    if (p.emissive !== undefined) {
      base.emissive = new THREE.Color(p.emissive);
      base.emissiveIntensity = p.emissiveIntensity ?? 0.4;
    }
    if (p.surface) {
      const set = this.textures.repeated(p.surface, rep[0], rep[1]);
      base.map = set.map;
      base.normalMap = set.normalMap;
      base.roughnessMap = set.roughnessMap;
      base.aoMap = set.aoMap;
      base.aoMapIntensity = 0.85;
    }
    const m = new THREE.MeshStandardMaterial(base);
    if (p.normalScale) m.normalScale = new THREE.Vector2(p.normalScale, p.normalScale);
    m.name = key;
    this.cache.set(key, m);
    return m;
  }

  /** Untextured but reused standard material (for small props, students, teacher). */
  solid(
    color: number,
    roughness = 0.75,
    metalness = 0.05,
    emissive = 0x000000,
  ): THREE.MeshStandardMaterial {
    const key = `${color}|${roughness}|${metalness}|${emissive}`;
    const hit = this.plain.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
    this.plain.set(key, m);
    return m;
  }

  setQuality(q: QualityTier): void {
    this.textures.setQuality(q);
    // rebuild texture channels of cached materials at the new resolution
    this.cache.forEach((m, key) => {
      const id = key.split(":")[0] as MaterialId;
      const p = PRESETS[id];
      if (!p.surface) return;
      const [rx, ry] = key.split(":")[1]!.split("x").map(Number) as [number, number];
      const set = this.textures.repeated(p.surface, rx, ry);
      m.map = set.map;
      m.normalMap = set.normalMap;
      m.roughnessMap = set.roughnessMap;
      m.aoMap = set.aoMap;
      m.needsUpdate = true;
    });
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.plain.forEach((m) => m.dispose());
    this.cache.clear();
    this.plain.clear();
    this.textures.dispose();
  }
}
