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
 * FRAMING SUBJECT — the real geometry the camera must keep on screen. The
 * camera no longer uses hardcoded rig positions: it solves the distance that
 * fits the ACTUAL board bounding box (plus the teacher) inside the current
 * viewport, for any aspect ratio.
 */
export type FramingSubject = {
  boardCenter: THREE.Vector3;
  boardWidth: number;
  boardHeight: number;
  teacherFootY: number;
  teacherHeadY: number;
};

const DEFAULT_SUBJECT: FramingSubject = {
  boardCenter: new THREE.Vector3(0, 1.75, -6.18),
  boardWidth: 6.9,
  boardHeight: 2.72,
  teacherFootY: 0,
  teacherHeadY: 2.02,
};

/** Vertical FOV per framing family (portrait needs more vertical room). */
const FOV_LANDSCAPE = 42;
const FOV_PORTRAIT = 58;

/** Safe area (§29): the board never touches the viewport edge. */
const SAFE_X_LANDSCAPE = 1.07;
const SAFE_X_PORTRAIT = 1.04;
const SAFE_TOP = 0.16;


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
  private subject: FramingSubject = { ...DEFAULT_SUBJECT, boardCenter: DEFAULT_SUBJECT.boardCenter.clone() };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_LANDSCAPE, aspect, 0.1, 200);
    this.camera.aspect = aspect > 0 ? aspect : 16 / 9;
    this.portrait = aspect < 1;
    this.containerPortrait = this.portrait;
    this.from = this.rig();
    this.to = this.rig();
    this.applyImmediate();
  }

  /**
   * RESPONSIVE FRAMING ENGINE (§4). Solves the camera distance from the REAL
   * board bounding box, the teacher's height and the live viewport aspect, so
   * the full board plus the teacher always fit inside the safe area — in 16:9
   * and in 9:16 alike. No hardcoded per-device rig, no scene scaling.
   */
  private rig(): Rig {
    const s = this.subject;
    const portrait = this.portrait;
    const fov = portrait ? FOV_PORTRAIT : FOV_LANDSCAPE;
    const boardTop = s.boardCenter.y + s.boardHeight / 2;
    const boardBottom = s.boardCenter.y - s.boardHeight / 2;
    // vertical safe area: the WHOLE board, plus the teacher (fully in portrait,
    // upper body in landscape where horizontal room is the binding constraint)
    const top = boardTop + SAFE_TOP;
    const bottom = portrait
      ? Math.min(boardBottom, s.teacherFootY) - 0.1
      : Math.min(boardBottom - 0.1, s.teacherFootY + 0.5);
    const halfH = Math.max(0.4, (top - bottom) / 2);
    const halfW = (s.boardWidth * (portrait ? SAFE_X_PORTRAIT : SAFE_X_LANDSCAPE)) / 2;
    const aspect = this.camera.aspect > 0 ? this.camera.aspect : portrait ? 9 / 16 : 16 / 9;
    const vt = Math.tan((fov * Math.PI) / 180 / 2);
    const dist = THREE.MathUtils.clamp(
      Math.max(halfH / vt, halfW / (vt * aspect)) + 0.3,
      2.2,
      18,
    );
    // Composition: in 9:16 the BOARD WIDTH is the binding constraint, so the
    // frame is much taller than the subject. Re-centre the surplus height so the
    // board sits in the middle of the portrait frame instead of leaving a large
    // empty floor beneath it (still no crop — the whole board stays inside).
    const contentMid = (top + bottom) / 2;
    const visibleHalfH = dist * vt;
    const surplus = Math.max(0, visibleHalfH - halfH);
    const centerY = portrait ? contentMid + surplus * 0.55 : contentMid;
    return {
      pos: new THREE.Vector3(s.boardCenter.x, centerY, s.boardCenter.z + dist),
      target: new THREE.Vector3(s.boardCenter.x, centerY, s.boardCenter.z),
      fov,
    };
  }


  /**
   * Publish the real classroom geometry (board bounds + teacher) to the camera.
   * Called when the board is built/resized and when the teacher is re-scaled —
   * the framing is then recomputed from actual bounds, never guessed.
   */
  setSubject(subject: Partial<FramingSubject>): void {
    const next: FramingSubject = {
      ...this.subject,
      ...subject,
      boardCenter: (subject.boardCenter ?? this.subject.boardCenter).clone(),
    };
    const same =
      next.boardWidth === this.subject.boardWidth &&
      next.boardHeight === this.subject.boardHeight &&
      next.teacherFootY === this.subject.teacherFootY &&
      next.teacherHeadY === this.subject.teacherHeadY &&
      next.boardCenter.equals(this.subject.boardCenter);
    this.subject = next;
    if (same) return;
    this.retarget(true);
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
    this.portrait = portrait;
    this.retarget(animate);
  }

  /**
   * Re-solve the teaching frame for the current subject/aspect/ratio. STABLE by
   * construction (§5): when the newly solved rig is materially identical to the
   * active one, nothing moves — the camera never drifts while teaching.
   */
  private retarget(animate: boolean): void {
    const next = this.rig();
    if (
      next.pos.distanceToSquared(this.to.pos) < 1e-6 &&
      next.target.distanceToSquared(this.to.target) < 1e-6 &&
      Math.abs(next.fov - this.to.fov) < 1e-4
    ) {
      return;
    }
    this.from = {
      pos: this.camera.position.clone(),
      target: this.targetNow.clone(),
      fov: this.camera.fov,
    };
    this.to = next;
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
