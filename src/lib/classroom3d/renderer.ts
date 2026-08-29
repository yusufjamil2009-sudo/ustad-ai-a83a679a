/** Render engine — WebGLRenderer setup, tone mapping, resize, post-processing, render loop hook. */
import * as THREE from "three";
import { PostEngine } from "./post";
import type { QualityTier } from "./types";

export class RenderEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private quality: QualityTier = "high";
  private post: PostEngine | null = null;
  private size = { w: 1, h: 1 };
  postEnabled = true;

  constructor(canvas: HTMLCanvasElement, quality: QualityTier = "high") {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== "low",
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x0d1020);
    this.scene.fog = new THREE.Fog(0x0d1020, 18, 44);
    this.setQuality(quality);
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  /** Build the post chain once a camera exists (idempotent — never a dup chain). */
  initPost(camera: THREE.Camera): void {
    if (!this.postEnabled || this.post) return;
    this.post = new PostEngine(this.renderer, this.scene, camera, this.quality);
  }

  setQuality(q: QualityTier): void {
    this.quality = q;
    // Capped DPR strategy: effective DPR = min(devicePixelRatio, tier cap).
    // The cap is chosen so board handwriting stays readable on high-density
    // phones (a hard cap of 1 rendered blurry text on 2–3× mobile screens)
    // while never rendering an unnecessarily huge WebGL buffer.
    const cap = q === "low" ? 1.5 : q === "medium" ? 1.75 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (this.renderer.getPixelRatio() !== dpr) {
      this.renderer.setPixelRatio(dpr);
      // a DPR change re-allocates the drawing buffer at the current size
      this.renderer.setSize(this.size.w, this.size.h, false);
      this.post?.setSize(this.size.w, this.size.h);
    }
    this.renderer.shadowMap.enabled = q !== "low";
  }

  /** Re-evaluate the post chain for a new quality tier. */
  syncPost(camera: THREE.Camera): void {
    if (!this.postEnabled) {
      this.post?.dispose();
      this.post = null;
      return;
    }
    if (!this.post) this.post = new PostEngine(this.renderer, this.scene, camera, this.quality);
    else {
      this.post.setQuality(this.quality, camera);
      this.post.setSize(this.size.w, this.size.h);
    }
  }

  get postActive(): boolean {
    return this.post?.active ?? false;
  }

  get tier(): QualityTier {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.size = { w: width, h: height };
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    if (this.post?.render(camera)) return;
    this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.post?.dispose();
    this.post = null;
    this.renderer.dispose();
  }
}
