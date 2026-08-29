/** Lighting + shadow engines — classroom illumination, sunlight, board light, object highlight. */
import * as THREE from "three";
import type { QualityTier } from "./types";

export class LightingEngine {
  readonly group = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private boardLight: THREE.SpotLight;
  private highlight: THREE.PointLight;
  private ambient: THREE.HemisphereLight;

  constructor(scene: THREE.Scene, quality: QualityTier = "high") {
    this.ambient = new THREE.HemisphereLight(0xdfe8ff, 0x2b2f45, 1.1);

    this.sun = new THREE.DirectionalLight(0xfff2d5, 2.1);
    this.sun.position.set(6, 8, 4);
    this.sun.castShadow = true;
    const size = quality === "low" ? 512 : quality === "medium" ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -12;
    this.sun.shadow.camera.right = 12;
    this.sun.shadow.camera.top = 12;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;

    this.boardLight = new THREE.SpotLight(0xffffff, 26, 14, Math.PI / 5, 0.5, 1.4);
    this.boardLight.position.set(0, 4.2, -3.2);
    this.boardLight.target.position.set(0, 1.9, -6.2);
    this.boardLight.castShadow = quality !== "low";
    this.boardLight.shadow.mapSize.set(size / 2, size / 2);

    this.highlight = new THREE.PointLight(0x8ad7ff, 0, 6, 2);
    this.highlight.visible = false;

    const roomFill = new THREE.PointLight(0xffe9c4, 12, 22, 2);
    roomFill.position.set(0, 4.4, 1.5);

    this.group.add(
      this.ambient,
      this.sun,
      this.sun.target,
      this.boardLight,
      this.boardLight.target,
      this.highlight,
      roomFill,
    );
    scene.add(this.group);
  }

  /** Time-of-day sunlight simulation (0 = morning, 1 = evening). */
  setDaylight(t: number): void {
    const a = Math.PI * (0.15 + 0.7 * t);
    this.sun.position.set(Math.cos(a) * 9, Math.max(2, Math.sin(a) * 10), 4);
    this.sun.color.setHSL(0.09 + 0.03 * Math.sin(a), 0.5, 0.62);
  }

  setBoardFocus(on: boolean): void {
    this.boardLight.intensity = on ? 42 : 26;
  }

  /** Mood shift for field-trip mode — same lights, no second lighting engine. */
  setFieldTripMood(on: boolean): void {
    this.ambient.intensity = on ? 0.85 : 1.1;
    this.sun.intensity = on ? 1.6 : 2.1;
    this.boardLight.intensity = on ? 18 : 26;
  }

  highlightAt(pos: THREE.Vector3 | null): void {
    if (!pos) {
      this.highlight.visible = false;
      this.highlight.intensity = 0;
      return;
    }
    this.highlight.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0.6));
    this.highlight.visible = true;
    this.highlight.intensity = 14;
  }

  setQuality(q: QualityTier): void {
    const size = q === "low" ? 512 : q === "medium" ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.boardLight.castShadow = q !== "low";
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
