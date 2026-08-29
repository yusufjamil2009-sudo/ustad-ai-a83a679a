/** Asset management engine — GLTF/texture/audio loading with cache, progress and unload. */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export class AssetEngine {
  private gltfLoader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();
  private gltfCache = new Map<string, Promise<GLTF>>();
  private texCache = new Map<string, THREE.Texture>();
  private audioCache = new Map<string, Promise<AudioBuffer>>();
  onProgress?: (ratio: number) => void;
  private total = 0;
  private done = 0;

  constructor(manager = new THREE.LoadingManager()) {
    manager.onProgress = () => this.tick();
    this.gltfLoader = new GLTFLoader(manager);
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.gltfLoader.setDRACOLoader(draco);
  }

  private tick() {
    this.onProgress?.(this.total === 0 ? 1 : Math.min(1, this.done / this.total));
  }

  /** Load a GLB/GLTF model. Returns null (never throws) so the scene can use a fallback. */
  async loadModel(url: string): Promise<GLTF | null> {
    if (!this.gltfCache.has(url)) {
      this.total++;
      const p = this.gltfLoader.loadAsync(url);
      this.gltfCache.set(url, p);
      p.then(
        () => {
          this.done++;
          this.tick();
        },
        () => {
          this.done++;
          this.tick();
        },
      );
    }
    try {
      return await this.gltfCache.get(url)!;
    } catch {
      this.gltfCache.delete(url);
      return null;
    }
  }

  loadTexture(url: string): THREE.Texture {
    const cached = this.texCache.get(url);
    if (cached) return cached;
    const tex = this.texLoader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(url, tex);
    return tex;
  }

  async loadAudio(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    if (!this.audioCache.has(url)) {
      this.audioCache.set(
        url,
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b)),
      );
    }
    try {
      return await this.audioCache.get(url)!;
    } catch {
      this.audioCache.delete(url);
      return null;
    }
  }

  dispose(): void {
    this.texCache.forEach((t) => t.dispose());
    this.texCache.clear();
    this.gltfCache.clear();
    this.audioCache.clear();
  }
}

/** Recursively dispose geometries/materials of a subtree (unload). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
  root.removeFromParent();
}
