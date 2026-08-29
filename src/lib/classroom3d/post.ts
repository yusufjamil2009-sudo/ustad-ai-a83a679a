/**
 * Post-processing engine — EffectComposer chain (render → bloom → tone-mapped output).
 * Enabled only on quality tiers that can afford it; falls back to direct rendering otherwise.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityTier } from "./types";

export class PostEngine {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;
  private enabled = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
    quality: QualityTier,
  ) {
    this.setQuality(quality, camera);
  }

  get active(): boolean {
    return this.enabled && this.composer !== null;
  }

  setQuality(q: QualityTier, camera: THREE.Camera): void {
    const want = q === "high";
    if (want === this.enabled && this.composer) return;
    this.enabled = want;
    if (!want) {
      this.dispose();
      return;
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(this.scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.55, 0.95);
    this.output = new OutputPass();
    composer.addPass(this.renderPass);
    composer.addPass(this.bloom);
    composer.addPass(this.output);
    this.composer = composer;
  }

  setSize(w: number, h: number): void {
    if (!this.composer) return;
    // §36–38 DPR race: EffectComposer snapshots renderer.getPixelRatio() at
    // construction. Re-sync it on every resize so the post buffers can never
    // run at a stale DPR after setQuality()/DPR changes.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  render(camera: THREE.Camera): boolean {
    if (!this.composer || !this.renderPass) return false;
    this.renderPass.camera = camera;
    this.composer.render();
    return true;
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom?.dispose();
    this.bloom = null;
    this.output?.dispose();
    this.output = null;
  }
}
