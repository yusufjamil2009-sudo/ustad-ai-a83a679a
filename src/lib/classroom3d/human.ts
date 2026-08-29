/**
 * Human avatar engine — loads a real rigged human GLTF (skinned mesh + skeleton),
 * plays its baked full-body animation clips through an AnimationMixer, and layers
 * procedural bone control on top: two-bone CCD hand IK (so the writing hand truly
 * reaches the live pen tip on the board), head look-at and torso lean.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TeacherAnimation } from "./types";

/** Maps our lesson animation states onto the clips shipped with the model. */
const CLIP_FOR: Record<TeacherAnimation, string[]> = {
  idle: ["idle"],
  stand: ["idle"],
  walk: ["walk", "run"],
  write: ["idle"],
  point: ["idle"],
  explain: ["agree", "idle"],
  wave: ["agree", "idle"],
  sit: ["idle"],
};

const BONE = {
  hips: ["mixamorigHips", "Hips"],
  spine: ["mixamorigSpine1", "mixamorigSpine", "Spine1", "Spine"],
  head: ["mixamorigHead", "Head"],
  upperArm: ["mixamorigRightArm", "RightArm"],
  foreArm: ["mixamorigRightForeArm", "RightForeArm"],
  hand: ["mixamorigRightHand", "RightHand"],
};

function findBone(root: THREE.Object3D, names: string[]): THREE.Bone | null {
  for (const n of names) {
    const b = root.getObjectByName(n);
    if (b) return b as THREE.Bone;
  }
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (found) return;
    const low = o.name.toLowerCase();
    if (names.some((n) => low.endsWith(n.toLowerCase()))) found = o as THREE.Bone;
  });
  return found;
}

export class HumanAvatar {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationAction>();
  private currentClip = "";
  private bones: {
    hips: THREE.Bone | null;
    spine: THREE.Bone | null;
    head: THREE.Bone | null;
    upperArm: THREE.Bone | null;
    foreArm: THREE.Bone | null;
    hand: THREE.Bone | null;
  };
  readonly marker = new THREE.Group();
  /** world height of the shoulder in the rest pose (used for reach maths) */
  shoulderY = 1.44;
  reachLen = 0.82;
  private ikWeight = 0;

  constructor(gltf: GLTF, targetHeight = 1.75) {
    const model = gltf.scene;
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const s = targetHeight / h;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as THREE.SkinnedMesh).isSkinnedMesh && !m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std || !std.isMaterial) continue;
        // dress the mannequin as a teacher: shirt-blue body, warm skin joints
        if (/joint/i.test(m.name)) std.color = new THREE.Color(0xe9c6a4);
        else std.color = new THREE.Color(0x35657f);
        std.roughness = 0.72;
        std.metalness = 0.03;
      }
    });

    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.clips.set(clip.name, action);
    }

    this.bones = {
      hips: findBone(model, BONE.hips),
      spine: findBone(model, BONE.spine),
      head: findBone(model, BONE.head),
      upperArm: findBone(model, BONE.upperArm),
      foreArm: findBone(model, BONE.foreArm),
      hand: findBone(model, BONE.hand),
    };

    if (this.bones.upperArm && this.bones.hand) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      this.bones.upperArm.getWorldPosition(a);
      this.bones.hand.getWorldPosition(b);
      this.shoulderY = a.y - this.root.position.y;
      this.reachLen = a.distanceTo(b) * 1.05;
    }

    // chalk marker parented to the real hand bone
    const chalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: 0xf6f3e8, roughness: 0.5 }),
    );
    chalk.rotation.z = Math.PI / 2;
    this.marker.add(chalk);
    this.marker.scale.setScalar(1 / Math.max(0.0001, s));
    this.bones.hand?.add(this.marker);

    this.playClip("idle", 0);
  }

  /** Cross-fade to the clip that represents a lesson animation state. */
  setState(state: TeacherAnimation): void {
    const names = CLIP_FOR[state] ?? ["idle"];
    const name = names.find((n) => this.clips.has(n)) ?? [...this.clips.keys()][0];
    if (name) this.playClip(name, 0.3);
  }

  private playClip(name: string, fade: number): void {
    const next = this.clips.get(name);
    if (!next || name === this.currentClip) return;
    const prev = this.clips.get(this.currentClip);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    prev?.fadeOut(fade);
    this.currentClip = name;
  }

  /**
   * Per-frame update. `handTarget` is the world point the writing hand must touch
   * (the live pen tip), `lookTarget` where the head should look.
   */
  update(
    dt: number,
    opts: {
      handTarget: THREE.Vector3 | null;
      lookTarget: THREE.Vector3 | null;
      lean: number;
      speaking: boolean;
    },
  ): void {
    this.mixer.update(dt);

    // torso lean (reach assist) on top of the baked clip
    if (this.bones.spine) this.bones.spine.rotateX(-opts.lean * 0.6);

    // head look-at, clamped, applied after the clip
    if (this.bones.head && opts.lookTarget) {
      const local = this.bones.head.worldToLocal(opts.lookTarget.clone());
      const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.001, -local.z)), -0.9, 0.9);
      const pitch = THREE.MathUtils.clamp(
        Math.atan2(local.y, Math.hypot(local.x, local.z)),
        -0.5,
        0.5,
      );
      this.bones.head.rotateY(yaw * 0.7);
      this.bones.head.rotateX(-pitch * 0.5);
    }

    // two-bone CCD IK so the hand physically lands on the pen tip
    const want = opts.handTarget ? 1 : 0;
    this.ikWeight = THREE.MathUtils.lerp(this.ikWeight, want, Math.min(1, dt * 6));
    if (opts.handTarget && this.ikWeight > 0.01) this.solveIK(opts.handTarget, this.ikWeight);
  }

  private solveIK(target: THREE.Vector3, weight: number): void {
    const { upperArm, foreArm, hand } = this.bones;
    if (!upperArm || !foreArm || !hand) return;
    const chain = [foreArm, upperArm];
    const bonePos = new THREE.Vector3();
    const handPos = new THREE.Vector3();
    const parentQ = new THREE.Quaternion();
    const worldQ = new THREE.Quaternion();
    for (let it = 0; it < 3; it++) {
      for (const bone of chain) {
        bone.updateWorldMatrix(true, true);
        bone.getWorldPosition(bonePos);
        hand.getWorldPosition(handPos);
        const cur = handPos.clone().sub(bonePos);
        const wanted = target.clone().sub(bonePos);
        if (cur.lengthSq() < 1e-8 || wanted.lengthSq() < 1e-8) continue;
        cur.normalize();
        wanted.normalize();
        const delta = new THREE.Quaternion().setFromUnitVectors(cur, wanted);
        if (weight < 1) delta.slerp(new THREE.Quaternion(), 1 - weight);
        bone.getWorldQuaternion(worldQ);
        const nextWorld = delta.multiply(worldQ);
        bone.parent?.getWorldQuaternion(parentQ);
        bone.quaternion.copy(parentQ.invert().multiply(nextWorld));
        bone.updateMatrixWorld(true);
      }
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
    });
    this.root.removeFromParent();
  }
}
