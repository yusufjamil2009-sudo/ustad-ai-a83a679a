/**
 * Camera engine — ONE teaching camera.
 *
 * Students, student desks and the cinematic/multi-camera system were removed, so
 * the classroom now has a single teaching camera that always keeps the board and
 * the teacher in one useful composition. There are no camera-angle presets, no
 * student/desk/wide shots and no auto-director switching anymore.
 *
 * The camera is still responsive: the viewport ratio (16:9 vs 9:16) re-composes
 * the SINGLE rig so board + teacher stay framed on desktop and mobile portrait.
 *
 * TEACHING LOCK (default ON): the camera is a FIXED teaching camera. Pointer
 * drags, two-finger pans, pinch and wheel must never orbit/pan/zoom it during
 * teaching — only an explicit, deliberate change (ratio re-compose, Reset
 * Teaching View, the focus feature) may move it. The lesson timeline never
 * orbits the camera, and teacher animation is completely independent from it.
 */
import * as THREE from "three";

type Rig = { pos: THREE.Vector3; target: THREE.Vector3; fov: number };

/** Aspect-ratio engine modes. 9:16 is a re-composed framing, never a crop of 16:9. */
export type RatioMode = "auto" | "16:9" | "9:16";

/**
 * 16:9 framing — desktop, laptop, tablet landscape. Board + teacher centred, with
 * enough of the writing surface in view to read what is being taught.
 */
const RIG_LANDSCAPE: Rig = {
  pos: new THREE.Vector3(0, 1.85, -2.35),
  target: new THREE.Vector3(0, 1.5, -4.2),
  fov: 44,
};

/**
 * 9:16 framing — mobile portrait. Not a crop of 16:9: the single teaching rig is
 * re-composed (closer, taller vertical FOV, subject centred lower) so the board
 * and the teacher still read on a narrow screen.
 */
const RIG_PORTRAIT: Rig = {
  pos: new THREE.Vector3(0, 1.78, -3.05),
  target: new THREE.Vector3(0, 1.55, -4.6),
  fov: 62,
};

/** Below this (metres²) the camera counts as "at rest" — matrix work is skipped. */
const REST_EPSILON_SQ = 1e-8;

export class CameraEngine {
  readonly camera: THREE.PerspectiveCamera;
  private from: Rig;
  private to: Rig;
  private t = 1;
  private duration = 1.2;
  private orbit = { yaw: 0, pitch: 0, zoom: 1 };
  private pan = new THREE.Vector3();
  private targetNow = new THREE.Vector3();
  private portrait = false;
  private ratioMode: RatioMode = "auto";
  private containerPortrait = false;
  private focus: THREE.Vector3 | null = null;

  /**
   * TEACHING LOCK. The camera boots locked: one fixed teaching composition,
   * yaw 0 / pitch 0 / pan (0,0,0) / zoom 1. User gestures are ignored while
   * locked; ratio changes and Reset Teaching View still re-compose the rig.
   */
  private locked = true;

  // ---- scratch objects (update() runs every frame and must not allocate) ----
  private tmpPos = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpOffset = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private tmpSph = new THREE.Spherical();
  private tmpRight = new THREE.Vector3();

  // ---- last transform values actually pushed to the camera ----
  // update() skips lookAt()/updateProjectionMatrix() when nothing has changed,
  // so the GPU-side matrix pipeline stays idle while the camera rests.
  private appliedPos = new THREE.Vector3();
  private appliedTarget = new THREE.Vector3();
  private appliedFov = -1;
  private projectionDirty = true;
  private lastSetAspect = -1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(RIG_LANDSCAPE.fov, aspect, 0.1, 200);
    this.portrait = aspect < 1;
    this.from = this.rig();
    this.to = this.rig();
    this.applyImmediate();
  }

  private rig(): Rig {
    return this.portrait ? RIG_PORTRAIT : RIG_LANDSCAPE;
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  /* ---------------- teaching lock ---------------- */

  /** Enable/disable the fixed teaching camera. Locking re-frames to the rig. */
  setTeachingLock(on: boolean): void {
    if (this.locked === on) return;
    this.locked = on;
    if (on) this.enforceTeachingLock();
  }

  isTeachingLocked(): boolean {
    return this.locked;
  }

  /** yaw 0 · pitch 0 · zoom 1 · pan (0,0,0) — the locked teaching composition. */
  private enforceTeachingLock(): void {
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
    this.orbit.zoom = 1;
    this.pan.set(0, 0, 0);
  }

  /* ---------------- focus (explicit feature only) ---------------- */

  /**
   * Focus target override (teacher focus / board focus / object focus). Only the
   * explicit focus feature and the orchestrator phase mapping call this — never
   * accidental pointer interaction. clearFocus()/resetOrbit() return the camera
   * to the teaching frame.
   */
  focusOn(point: THREE.Vector3 | null): void {
    this.focus = point ? point.clone() : null;
  }

  private applyImmediate() {
    this.camera.position.copy(this.to.pos);
    this.targetNow.copy(this.to.target);
    this.camera.fov = this.to.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.targetNow);
    this.appliedPos.copy(this.camera.position);
    this.appliedTarget.copy(this.targetNow);
    this.appliedFov = this.camera.fov;
    this.projectionDirty = false;
  }

  /**
   * Camera-ratio engine: recompute framing for the current viewport ratio.
   * Switching between landscape and portrait re-selects the matching single rig.
   * No-op when the aspect has not actually changed (prevents resize loops and
   * redundant projection recomputes).
   */
  setAspect(aspect: number, mobile = false): void {
    if (aspect === this.lastSetAspect) return;
    this.lastSetAspect = aspect;
    this.camera.aspect = aspect;
    this.containerPortrait = aspect < 1;
    this.applyRatioMode(true);
    // narrow screens need a touch more vertical FOV headroom
    const gauge = mobile || this.portrait ? 30 : 35;
    if (this.camera.filmGauge !== gauge) {
      this.camera.filmGauge = gauge;
      this.projectionDirty = true;
    }
  }

  /**
   * Force a framing family. "9:16" re-composes the single teaching rig for
   * portrait; "16:9" always uses the landscape rig; "auto" follows the container.
   * Switching ratio resets user framing state (yaw/pitch/pan/zoom) — a ratio
   * change must never activate orbit/pan/zoom state.
   */
  setRatioMode(mode: RatioMode): void {
    this.ratioMode = mode;
    this.enforceTeachingLock();
    this.applyRatioMode(true);
  }

  get ratio(): RatioMode {
    return this.ratioMode;
  }

  snapshot(): {
    yaw: number;
    pitch: number;
    zoom: number;
    pan: [number, number, number];
    ratio: RatioMode;
  } {
    return {
      yaw: this.orbit.yaw,
      pitch: this.orbit.pitch,
      zoom: this.orbit.zoom,
      pan: [this.pan.x, this.pan.y, this.pan.z],
      ratio: this.ratioMode,
    };
  }

  restore(s: {
    yaw: number;
    pitch: number;
    zoom: number;
    pan: [number, number, number];
    ratio: RatioMode;
  }): void {
    this.ratioMode = s.ratio;
    this.applyRatioMode(true);
    this.orbit.yaw = s.yaw;
    this.orbit.pitch = s.pitch;
    this.orbit.zoom = s.zoom;
    this.pan.set(s.pan[0], s.pan[1], s.pan[2]);
    if (this.locked) this.enforceTeachingLock();
  }

  private applyRatioMode(animate: boolean): void {
    const portrait =
      this.ratioMode === "9:16" ? true : this.ratioMode === "16:9" ? false : this.containerPortrait;
    if (portrait === this.portrait) return;
    this.portrait = portrait;
    this.from = {
      pos: this.camera.position.clone(),
      target: this.targetNow.clone(),
      fov: this.camera.fov,
    };
    this.to = this.rig();
    this.duration = animate ? 0.6 : 0.05;
    this.t = 0;
    this.projectionDirty = true;
  }

  /** Pointer orbit — IGNORED while the teaching lock is on. */
  orbitBy(dx: number, dy: number): void {
    if (this.locked) return;
    const limit = 0.7;
    const pitchLo = -0.35;
    const pitchHi = 0.45;
    this.orbit.yaw = THREE.MathUtils.clamp(this.orbit.yaw + dx * 0.005, -limit, limit);
    this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.004, pitchLo, pitchHi);
  }

  /** Wheel/pinch zoom — IGNORED while the teaching lock is on. */
  zoomBy(deltaY: number): void {
    if (this.locked) return;
    const min = 0.55;
    const max = 1.8;
    this.orbit.zoom = THREE.MathUtils.clamp(this.orbit.zoom * Math.exp(deltaY * 0.0015), min, max);
  }

  /** Two-finger panning — IGNORED while the teaching lock is on. */
  panBy(dx: number, dy: number): void {
    if (this.locked) return;
    const right = this.tmpRight;
    this.camera.getWorldDirection(right);
    right.cross(this.camera.up).normalize();
    const scale = 0.006 * this.orbit.zoom * 3;
    this.pan.addScaledVector(right, -dx * scale);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y + dy * scale, -1.0, 2.2);
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -5, 5);
    this.pan.z = THREE.MathUtils.clamp(this.pan.z, -4, 4);
  }

  /**
   * RESET TEACHING VIEW. Restores yaw 0, pitch 0, zoom 1, pan (0,0,0), releases
   * any focus override and smoothly re-composes the current 16:9 / 9:16 teaching
   * rig — without creating a second camera.
   */
  resetOrbit(): void {
    this.enforceTeachingLock();
    this.focus = null;
    this.from = {
      pos: this.camera.position.clone(),
      target: this.targetNow.clone(),
      fov: this.camera.fov,
    };
    this.to = this.rig();
    this.duration = 0.6;
    this.t = 0;
  }

  /**
   * Per-frame update. Allocation-free (scratch objects only), and it skips
   * lookAt()/updateProjectionMatrix() entirely while the camera is at rest.
   *
   * Pan is applied EXACTLY ONCE: the whole rig (base position AND target) is
   * shifted by the same pan vector, so the orbit offset — computed between
   * position and target — is pan-independent. The camera position therefore
   * receives the pan exactly once, never doubled.
   */
  update(dt: number): void {
    if (this.t < 1) this.t = Math.min(1, this.t + dt / this.duration);
    const e = easeInOutCubic(this.t);

    const basePos = this.tmpPos.lerpVectors(this.from.pos, this.to.pos, e);
    const target = this.tmpTarget.lerpVectors(this.from.target, this.to.target, e);
    if (this.focus) target.lerp(this.focus, 0.55);
    // pan shifts the rig ONCE — the SAME vector on both the position base and
    // the look target, so the camera and its aim translate together exactly once
    // (the orbit offset below is pan-independent by construction).
    basePos.add(this.pan);
    target.add(this.pan);
    const fov = THREE.MathUtils.lerp(this.from.fov, this.to.fov, e);

    // orbit + zoom applied around the rig; offset is pan-independent
    const offset = this.tmpOffset.copy(basePos).sub(target);
    const sph = this.tmpSph.setFromVector3(offset);
    sph.theta += this.orbit.yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi - this.orbit.pitch, 0.2, Math.PI / 2 + 0.25);
    sph.radius *= this.orbit.zoom;
    basePos.copy(target).add(this.tmpDir.setFromSpherical(sph));
    // never let the user drop through the floor
    basePos.y = Math.max(0.45, basePos.y);

    const smoothing = this.t < 1 ? 1 : Math.min(1, dt * 6);
    if (smoothing >= 1) this.camera.position.copy(basePos);
    else this.camera.position.lerp(basePos, smoothing);

    this.targetNow.copy(target);
    this.camera.fov = fov;

    // Skip the matrix pipeline while the camera rests (nothing moved).
    const fovChanged = Math.abs(fov - this.appliedFov) > 1e-5;
    if (fovChanged) this.projectionDirty = true;
    if (
      !this.projectionDirty &&
      !fovChanged &&
      this.camera.position.distanceToSquared(this.appliedPos) < REST_EPSILON_SQ &&
      this.targetNow.distanceToSquared(this.appliedTarget) < REST_EPSILON_SQ
    ) {
      return;
    }
    this.appliedPos.copy(this.camera.position);
    this.appliedTarget.copy(this.targetNow);
    this.appliedFov = fov;
    if (this.projectionDirty) {
      this.camera.updateProjectionMatrix();
      this.projectionDirty = false;
    }
    this.camera.lookAt(this.targetNow);
  }
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
