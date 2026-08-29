/**
 * Interaction engine — teaching-safe pointer handling, tap picking, keyboard
 * shortcuts.
 *
 * TEACHING LOCK (default): the classroom camera is a fixed teaching camera, so
 * normal interaction must NEVER move it:
 *   • one-finger / mouse drag  → no orbit, no pan (tap still picks)
 *   • two-finger drag          → no pan
 *   • pinch / wheel            → no zoom (and the wheel scrolls the page)
 * The canvas therefore uses `touch-action: pan-y` while locked so the 3D stage
 * never hijacks normal page scrolling on mobile. Picking (tap) and the keyboard
 * shortcuts (Space, ←, →, R = Reset Teaching View) keep working.
 */
import * as THREE from "three";
import type { CameraEngine } from "./cameras";

export type InteractionHandlers = {
  onPick?: (object: THREE.Object3D | null, point: THREE.Vector3 | null) => void;
  onToggle?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
};

export class InteractionEngine {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragging = false;
  private moved = 0;
  private last = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private panning = false;
  private locked: boolean;
  private cleanup: (() => void)[] = [];
  targets: THREE.Object3D[] = [];

  constructor(
    private el: HTMLCanvasElement,
    private cameras: CameraEngine,
    private handlers: InteractionHandlers = {},
  ) {
    this.locked = cameras.isTeachingLocked();
    this.bind();
  }

  /** Mirror the camera's teaching lock; also fixes the canvas touch behaviour. */
  setTeachingLock(on: boolean): void {
    this.locked = on;
    this.applyTouchAction();
  }

  /**
   * Locked → `pan-y`: swipes over the classroom scroll the page normally and
   * taps still pick. Unlocked (explicit free-camera mode) → `none`, gestures
   * belong to the camera.
   */
  private applyTouchAction(): void {
    this.el.style.touchAction = this.locked ? "pan-y" : "none";
  }

  private bind(): void {
    const el = this.el;
    this.applyTouchAction();

    const down = (e: PointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.moved = 0;
      this.last = { x: e.clientX, y: e.clientY };
      this.panning = !this.locked && (e.button === 1 || e.shiftKey);
      el.setPointerCapture?.(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (this.pointers.has(e.pointerId))
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        // pinch zoom + two-finger pan only exist in explicit free-camera mode;
        // under the teaching lock pinch NEVER zooms and drag NEVER pans
        if (!this.locked && this.pinchDist) {
          this.cameras.zoomBy((this.pinchDist - d) * 1.6);
          this.cameras.panBy(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
        }
        this.pinchDist = d;
        this.pinchMid = mid;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.moved += Math.abs(dx) + Math.abs(dy);
      // TEACHING LOCK: a plain drag never orbits or pans the teaching camera.
      if (this.locked) return;
      // free-camera mode only: shift-drag or middle mouse pans, plain drag orbits
      if (this.panning) this.cameras.panBy(dx, dy);
      else this.cameras.orbitBy(-dx, -dy);
    };

    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      this.panning = false;
      if (this.dragging && this.moved < 6) this.pick(e);
      this.dragging = false;
    };

    // The browser may take over a pan-y gesture (page scroll) — release cleanly.
    const cancel = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      this.panning = false;
      this.dragging = false;
    };

    const wheel = (e: WheelEvent) => {
      // Teaching lock: the wheel must scroll the page, never zoom the camera.
      if (this.locked) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      this.cameras.zoomBy(dy);
    };

    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        this.handlers.onToggle?.();
      } else if (e.key === "ArrowRight") this.handlers.onNext?.();
      else if (e.key === "ArrowLeft") this.handlers.onPrev?.();
      // R = Reset Teaching View (works under the lock by design).
      else if (e.key.toLowerCase() === "r") this.cameras.resetOrbit();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);

    this.cleanup.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    });
  }

  private pick(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.cameras.camera);
    const hits = this.raycaster.intersectObjects(this.targets, true);
    const hit = hits[0];
    if (!hit) return this.handlers.onPick?.(null, null);
    let root: THREE.Object3D = hit.object;
    while (root.parent && !this.targets.includes(root)) root = root.parent;
    this.handlers.onPick?.(root, hit.point.clone());
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.pointers.clear();
  }
}
