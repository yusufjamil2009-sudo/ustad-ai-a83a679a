/** Teacher engine — procedural avatar rig, animation states, IK-style pointing, gestures, walking. */
import * as THREE from "three";
import type { TeacherAnimation } from "./types";

function mat(color: number, rough = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

// Scratch vectors — update()/solveArmIK() run EVERY frame and must not allocate
// (per-frame garbage triggered GC pauses that stalled mobile input).
const _walkDelta = new THREE.Vector3();
const _walkStep = new THREE.Vector3();
const _headLocal = new THREE.Vector3();
const _boardDelta = new THREE.Vector3();
const _ikTarget = new THREE.Vector3();
const _ikShoulder = new THREE.Vector3();
const _ikToTarget = new THREE.Vector3();

export class TeacherEngine {
  readonly group = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private leftLeg: THREE.Group;
  private rightLeg: THREE.Group;
  private state: TeacherAnimation = "idle";
  private t = 0;
  private walkTarget: THREE.Vector3 | null = null;
  private lookTarget: THREE.Vector3 | null = null;
  private pointTarget: THREE.Vector3 | null = null;
  /** live pen tip on the board — the writing hand follows this exactly */
  private penTarget: THREE.Vector3 | null = null;
  private fingers: THREE.Group[] = [];
  private speaking = false;
  private mouth: THREE.Mesh;
  private lean = 0;
  private rise = 0;
  private shoulderY = 1.44;
  private reachLen = 0.82;
  onArrive?: () => void;

  /** Highest world point the hand can naturally touch (used to size the board). */
  get maxReachY(): number {
    return this.group.position.y + this.shoulderY + this.reachLen + 0.2;
  }

  constructor(scene: THREE.Scene, position = new THREE.Vector3(0, 0, -4.6)) {
    const skin = 0xf1cfae;
    const cloth = 0x2f6f8f;
    const cloth2 = 0x24586f;

    // ---- torso: chest + waist + hips, human proportions (~1.75 m tall) ----
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.215, 0.42, 8, 18), mat(cloth));
    this.torso.position.y = 1.24;
    this.torso.scale.set(1.16, 1, 0.78); // chest is wider than it is deep
    this.torso.castShadow = true;

    const waist = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.18, 6, 14), mat(cloth2));
    waist.position.y = 1.0;
    waist.scale.set(1.1, 1, 0.8);
    waist.castShadow = true;

    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.1, 6, 14), mat(0x25314a));
    hips.position.y = 0.9;
    hips.scale.set(1.15, 1, 0.85);

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.42, 6, 14), mat(cloth));
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = 1.47;
    shoulders.scale.set(1, 1, 0.85);
    shoulders.castShadow = true;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 18), mat(0xf3f6ff, 0.7));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.52;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.13, 14), mat(skin, 0.8));
    neck.position.y = 1.56;
    neck.castShadow = true;

    // ---- head: skull, jaw, hair, brows, nose, ears, eyes, mouth ----
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 28, 24), mat(skin, 0.78));
    skull.scale.set(1, 1.16, 1.02);
    skull.castShadow = true;
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.098, 20, 16), mat(skin, 0.8));
    jaw.position.set(0, -0.055, 0.012);
    jaw.scale.set(0.94, 0.72, 0.98);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.122, 26, 20, 0, Math.PI * 2, 0, 1.25),
      mat(0x2a2118, 0.9),
    );
    hair.position.y = 0.012;
    hair.scale.set(1, 1.12, 1.04);
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 20, 16, 0, Math.PI * 2, 1.5, 1.2),
      mat(0x2a2118, 0.95),
    );
    beard.position.set(0, -0.05, 0.008);
    beard.scale.set(0.96, 0.85, 1.0);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.055, 10), mat(skin, 0.8));
    nose.rotation.x = Math.PI / 2.1;
    nose.position.set(0, -0.012, 0.112);
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 12), mat(0x6b3030, 0.6));
    this.mouth.position.set(0, -0.062, 0.098);
    this.mouth.scale.set(1.25, 0.4, 0.55);
    const eyeGeo = new THREE.SphereGeometry(0.018, 14, 12);
    const eyeWhite = mat(0xf7f7fb, 0.35);
    const irisGeo = new THREE.SphereGeometry(0.009, 10, 8);
    const irisMat = mat(0x21160f, 0.35);
    const browGeo = new THREE.BoxGeometry(0.042, 0.008, 0.012);
    const browMat = mat(0x2a2118, 0.9);
    const earGeo = new THREE.SphereGeometry(0.026, 12, 10);
    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(eyeGeo, eyeWhite);
      eye.position.set(0.042 * side, 0.012, 0.098);
      eye.scale.set(1, 0.72, 0.6);
      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.set(0.042 * side, 0.012, 0.112);
      const brow = new THREE.Mesh(browGeo, browMat);
      brow.position.set(0.043 * side, 0.048, 0.104);
      brow.rotation.z = -0.12 * side;
      const ear = new THREE.Mesh(earGeo, mat(skin, 0.8));
      ear.position.set(0.112 * side, -0.005, 0.005);
      ear.scale.set(0.4, 1, 0.7);
      this.head.add(eye, iris, brow, ear);
    }
    this.head.add(skull, jaw, hair, beard, nose, this.mouth);
    this.head.position.y = 1.7;

    // ---- arms: upper arm, forearm, palm with five fingers ----
    const mkArm = (side: 1 | -1) => {
      const g = new THREE.Group();
      const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 12), mat(cloth));
      deltoid.castShadow = true;
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.3, 6, 12), mat(cloth));
      upper.position.y = -0.2;
      upper.castShadow = true;
      const fore = new THREE.Group();
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), mat(skin, 0.8));
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.28, 6, 12), mat(skin, 0.8));
      lower.position.y = -0.18;
      lower.castShadow = true;
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062, 0.062, 0.05, 12),
        mat(cloth, 0.8),
      );
      cuff.position.y = -0.03;

      const hand = new THREE.Group();
      hand.name = "hand";
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.095, 0.038), mat(skin, 0.8));
      palm.position.y = -0.045;
      palm.castShadow = true;
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const knuckle = new THREE.Group();
        const finger = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0105, 0.048, 4, 8),
          mat(skin, 0.8),
        );
        finger.position.y = -0.032;
        knuckle.add(finger);
        knuckle.position.set(-0.03 + f * 0.02, -0.092, 0);
        knuckle.name = `finger${f}`;
        hand.add(knuckle);
        this.fingers.push(knuckle);
      }
      const thumbJoint = new THREE.Group();
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.036, 4, 8), mat(skin, 0.8));
      thumb.position.y = -0.026;
      thumbJoint.add(thumb);
      thumbJoint.position.set(0.042 * side, -0.06, 0.012);
      thumbJoint.rotation.z = 0.7 * side;
      thumbJoint.name = "thumb";
      hand.add(thumbJoint);
      this.fingers.push(thumbJoint);
      hand.position.y = -0.34;

      fore.add(elbow, lower, cuff, hand);
      fore.position.y = -0.4;
      fore.name = "forearm";
      g.add(deltoid, upper, fore);
      g.position.set(0.215 * side, 1.44, 0);
      return g;
    };
    this.leftArm = mkArm(-1);
    this.rightArm = mkArm(1);

    // marker/chalk held in the writing hand
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.1, 10),
      mat(0xf6f3e8, 0.5),
    );
    marker.rotation.x = Math.PI / 2.2;
    marker.position.set(0, -0.09, 0.035);
    this.rightArm.getObjectByName("hand")?.add(marker);

    const mkLeg = (side: 1 | -1) => {
      const g = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.092, 0.3, 6, 12), mat(0x25314a));
      thigh.position.y = -0.22;
      thigh.castShadow = true;
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), mat(0x25314a));
      knee.position.y = -0.42;
      const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 6, 12), mat(0x25314a));
      calf.position.y = -0.6;
      calf.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.07, 0.24), mat(0x14161f, 0.5));
      shoe.position.set(0, -0.8, 0.04);
      shoe.castShadow = true;
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.08), mat(0x0f1118, 0.5));
      heel.position.set(0, -0.82, -0.06);
      g.add(thigh, knee, calf, shoe, heel);
      g.position.set(0.105 * side, 0.9, 0);
      return g;
    };
    this.leftLeg = mkLeg(-1);
    this.rightLeg = mkLeg(1);

    this.group.add(
      hips,
      waist,
      this.torso,
      shoulders,
      collar,
      neck,
      this.head,
      this.leftArm,
      this.rightArm,
      this.leftLeg,
      this.rightLeg,
    );
    this.group.position.copy(position);
    this.group.name = "teacher";
    scene.add(this.group);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get animation(): TeacherAnimation {
    return this.state;
  }

  snapshot(): { animation: TeacherAnimation; x: number; y: number; z: number; yaw: number } {
    return {
      animation: this.state,
      x: this.group.position.x,
      y: this.group.position.y,
      z: this.group.position.z,
      yaw: this.group.rotation.y,
    };
  }

  restore(s: { animation: TeacherAnimation; x: number; y: number; z: number; yaw: number }): void {
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.play(s.animation);
  }

  play(a: TeacherAnimation): void {
    if (this.state === a) return;
    this.state = a;
    this.t = 0;
  }

  walkTo(p: THREE.Vector3): void {
    this.walkTarget = p.clone();
    this.play("walk");
  }

  lookAt(p: THREE.Vector3 | null): void {
    this.lookTarget = p ? p.clone() : null;
  }

  pointAt(p: THREE.Vector3 | null): void {
    this.pointTarget = p ? p.clone() : null;
    if (p) this.play("point");
  }

  /** Board-writing hand target (world space). Called every frame by the board
   * engine's pen-tip callback so the hand physically follows the handwriting. */
  writeAt(p: THREE.Vector3 | null): void {
    if (!p) {
      this.penTarget = null;
      return;
    }
    // copy into the persistent target — no per-frame allocation
    if (this.penTarget) this.penTarget.copy(p);
    else this.penTarget = p.clone();
  }

  setSpeaking(on: boolean): void {
    this.speaking = on;
  }

  /** Physics-aware stepping: pass a resolver that applies collisions and returns the resolved position. */
  update(dt: number, resolve?: (delta: THREE.Vector3) => THREE.Vector3 | null): void {
    this.t += dt;
    const t = this.t;

    // locomotion
    if (this.walkTarget) {
      const to = _walkDelta.copy(this.walkTarget).sub(this.group.position);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.08) {
        this.walkTarget = null;
        this.play("stand");
        this.onArrive?.();
      } else {
        const step = _walkStep
          .copy(to)
          .normalize()
          .multiplyScalar(Math.min(dist, dt * 1.5));
        const resolved = resolve?.(step);
        if (resolved) this.group.position.set(resolved.x, this.group.position.y, resolved.z);
        else this.group.position.add(step);
        const yaw = Math.atan2(step.x, step.z);
        this.group.rotation.y = THREE.MathUtils.lerp(
          this.group.rotation.y,
          yaw,
          Math.min(1, dt * 6),
        );
      }
    }

    const swing = (amp: number, speed: number, off = 0) => Math.sin(t * speed + off) * amp;
    const lerpRot = (o: THREE.Object3D, x: number, z: number, k = 8) => {
      o.rotation.x = THREE.MathUtils.lerp(o.rotation.x, x, Math.min(1, dt * k));
      o.rotation.z = THREE.MathUtils.lerp(o.rotation.z, z, Math.min(1, dt * k));
    };

    switch (this.state) {
      case "walk":
        lerpRot(this.leftLeg, swing(0.6, 7), 0, 16);
        lerpRot(this.rightLeg, swing(0.6, 7, Math.PI), 0, 16);
        lerpRot(this.leftArm, swing(0.5, 7, Math.PI), 0.08, 16);
        lerpRot(this.rightArm, swing(0.5, 7), -0.08, 16);
        this.group.position.y = Math.abs(Math.sin(t * 7)) * 0.03;
        break;
      case "write":
        lerpRot(this.rightArm, -1.5 + swing(0.22, 6), -0.35, 10);
        lerpRot(this.leftArm, 0.05, 0.1);
        lerpRot(this.leftLeg, 0, 0);
        lerpRot(this.rightLeg, 0, 0);
        break;
      case "point": {
        lerpRot(this.rightArm, -1.35, -0.5, 8);
        lerpRot(this.leftArm, 0.05, 0.08);
        break;
      }
      case "explain":
        lerpRot(this.leftArm, -0.7 + swing(0.35, 3.2), 0.45, 6);
        lerpRot(this.rightArm, -0.7 + swing(0.35, 3.2, Math.PI), -0.45, 6);
        break;
      case "wave":
        lerpRot(this.rightArm, -2.4, -0.3 + swing(0.4, 8), 12);
        lerpRot(this.leftArm, 0.05, 0.08);
        break;
      case "sit":
        this.group.position.y = -0.35;
        lerpRot(this.leftLeg, -1.4, 0);
        lerpRot(this.rightLeg, -1.4, 0);
        lerpRot(this.leftArm, -0.3, 0.1);
        lerpRot(this.rightArm, -0.3, -0.1);
        break;
      case "stand":
      case "idle":
      default:
        this.group.position.y = 0;
        lerpRot(this.leftArm, swing(0.05, 1.6), 0.08, 4);
        lerpRot(this.rightArm, swing(0.05, 1.6, 1), -0.08, 4);
        lerpRot(this.leftLeg, 0, 0);
        lerpRot(this.rightLeg, 0, 0);
        break;
    }

    // breathing
    this.torso.scale.y = 1 + Math.sin(t * 2.1) * 0.012;

    // Reach assist — a real teacher rises onto the toes and leans in for the top
    // of the board instead of stretching the arm unnaturally.
    const target = this.penTarget ?? this.pointTarget;
    const need = target
      ? target.y - (this.group.position.y + this.shoulderY + this.reachLen * 0.86)
      : -1;
    const wantRise = THREE.MathUtils.clamp(need, 0, 0.12);
    const wantLean = target ? THREE.MathUtils.clamp(need * 1.6, -0.05, 0.16) : 0;
    this.rise = THREE.MathUtils.lerp(this.rise, wantRise, Math.min(1, dt * 4));
    this.lean = THREE.MathUtils.lerp(this.lean, wantLean, Math.min(1, dt * 4));
    if (this.state !== "walk" && this.state !== "sit") this.group.position.y = this.rise;
    this.torso.rotation.x = -this.lean;
    this.head.position.y = 1.7 + this.lean * 0.06;

    // head IK look
    const focus = this.penTarget ?? this.pointTarget ?? this.lookTarget;
    if (focus) {
      const local = this.group.worldToLocal(_headLocal.copy(focus));
      const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      const pitch = THREE.MathUtils.clamp(
        -Math.atan2(local.y - 1.7, Math.hypot(local.x, local.z)),
        -0.5,
        0.5,
      );
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, yaw, Math.min(1, dt * 5));
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, pitch, Math.min(1, dt * 5));
    } else {
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, 0, Math.min(1, dt * 3));
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0, Math.min(1, dt * 3));
    }

    // Writing: face the board and let the hand track the live pen tip.
    const writing = this.penTarget && (this.state === "write" || this.state === "point");
    if (writing) {
      const toBoard = _boardDelta.copy(this.penTarget!).sub(this.group.position);
      const yaw = Math.atan2(toBoard.x, toBoard.z);
      this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, yaw, Math.min(1, dt * 3));
    }

    // two-bone arm IK: shoulder + elbow solved so the hand reaches the target
    const reach =
      (writing ? this.penTarget : null) ??
      this.pointTarget ??
      (this.state === "write" ? this.lookTarget : null);
    if (reach) this.solveArmIK(this.rightArm, reach, dt);

    // grip: fingers curl around the marker while writing/pointing, relax otherwise
    const curl = writing ? 1.15 : this.state === "point" ? 0.15 : 0.35;
    for (const f of this.fingers) {
      f.rotation.x = THREE.MathUtils.lerp(f.rotation.x, -curl, Math.min(1, dt * 6));
    }

    // lip sync
    const talk = this.speaking ? 0.35 + Math.abs(Math.sin(t * 14)) * 0.85 : 0.4;
    this.mouth.scale.set(1, talk, 0.6);
  }

  /**
   * IK engine — analytic two-bone solver (law of cosines) for the teacher's arm.
   * Aims the shoulder at the world target and bends the elbow so the hand lands on it.
   */
  private solveArmIK(arm: THREE.Group, worldTarget: THREE.Vector3, dt: number): void {
    const upperLen = 0.4;
    const foreLen = 0.42;

    // target in the arm's parent (teacher) space — scratch vectors, no allocation
    const local = this.group.worldToLocal(_ikTarget.copy(worldTarget));
    const shoulderLocal = _ikShoulder.copy(arm.position);
    const toTarget = _ikToTarget.copy(local).sub(shoulderLocal);
    const dist = THREE.MathUtils.clamp(toTarget.length(), 0.15, upperLen + foreLen - 0.02);
    const dir = toTarget.normalize();

    // shoulder aim: pitch about X (arm hangs down at rest), yaw about Y
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.acos(THREE.MathUtils.clamp(-dir.y, -1, 1));

    // elbow angle from the law of cosines
    const cos = THREE.MathUtils.clamp(
      (upperLen * upperLen + foreLen * foreLen - dist * dist) / (2 * upperLen * foreLen),
      -1,
      1,
    );
    const elbow = Math.PI - Math.acos(cos);

    const k = Math.min(1, dt * 8);
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, pitch + Math.PI, k);
    arm.rotation.y = THREE.MathUtils.lerp(arm.rotation.y, yaw, k);
    arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, 0, k);
    const fore = arm.getObjectByName("forearm");
    if (fore) fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -elbow, k);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mm = m.material as THREE.Material | undefined;
      mm?.dispose();
    });
    this.group.removeFromParent();
  }
}
