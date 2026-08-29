/** 3D physics engine — Rapier (WASM). Handles collisions, gravity, object drops and teacher body. */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";

type Rapier = typeof RAPIER;

export type PhysicsBody = {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
};

export class PhysicsEngine {
  private RAPIER: Rapier | null = null;
  private world: RAPIER.World | null = null;
  private bodies: PhysicsBody[] = [];
  private character: RAPIER.RigidBody | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  /** set by moveCharacter() — the only thing that makes the stepping necessary */
  private charMoved = false;
  /** shared result vector (consumed immediately by the teacher's resolver) */
  private readonly resolved = new THREE.Vector3();
  ready = false;

  async init(): Promise<void> {
    const mod = await import("@dimforge/rapier3d-compat");
    await mod.default.init();
    this.RAPIER = mod.default;
    this.world = new mod.default.World({ x: 0, y: -9.81, z: 0 });
    // Floor + walls of the classroom.
    const floor = this.world.createRigidBody(
      mod.default.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    );
    this.world.createCollider(mod.default.ColliderDesc.cuboid(9, 0.05, 9), floor);
    const wall = (x: number, z: number, hx: number, hz: number) => {
      const b = this.world!.createRigidBody(
        mod.default.RigidBodyDesc.fixed().setTranslation(x, 1.6, z),
      );
      this.world!.createCollider(mod.default.ColliderDesc.cuboid(hx, 1.8, hz), b);
    };
    wall(0, -9, 9, 0.2);
    wall(0, 9, 9, 0.2);
    wall(-9, 0, 0.2, 9);
    wall(9, 0, 0.2, 9);

    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.3, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.ready = true;
  }

  /** Kinematic capsule used by the teacher for collision-aware walking. */
  createCharacter(position: THREE.Vector3): void {
    if (!this.RAPIER || !this.world) return;
    const desc = this.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y + 0.9,
      position.z,
    );
    this.character = this.world.createRigidBody(desc);
    this.world.createCollider(this.RAPIER.ColliderDesc.capsule(0.6, 0.3), this.character);
  }

  /** Move the character with collision resolution; returns the resolved world position. */
  moveCharacter(delta: THREE.Vector3): THREE.Vector3 | null {
    if (!this.character || !this.controller || !this.world) return null;
    const collider = this.character.collider(0);
    this.controller.computeColliderMovement(collider, { x: delta.x, y: delta.y, z: delta.z });
    const c = this.controller.computedMovement();
    const t = this.character.translation();
    const next = { x: t.x + c.x, y: t.y + c.y, z: t.z + c.z };
    this.character.setNextKinematicTranslation(next);
    this.charMoved = true;
    // shared temp — the caller reads it synchronously, never retains it
    return this.resolved.set(next.x, next.y - 0.9, next.z);
  }

  /** Dynamic rigid body attached to a mesh (science objects that can be dropped/inspected). */
  addDynamicBox(mesh: THREE.Object3D, size = 0.3, mass = 1): void {
    if (!this.RAPIER || !this.world) return;
    const p = mesh.position;
    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinearDamping(0.4),
    );
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(size, size, size).setMass(mass),
      body,
    );
    this.bodies.push({ body, mesh });
  }

  removeMesh(mesh: THREE.Object3D): void {
    const i = this.bodies.findIndex((b) => b.mesh === mesh);
    if (i >= 0 && this.world) {
      this.world.removeRigidBody(this.bodies[i]!.body);
      this.bodies.splice(i, 1);
    }
  }

  step(dt: number): void {
    if (!this.world) return;
    // PERF: skip the WASM world step entirely when nothing can move — no
    // dynamic bodies and the teacher character has not been asked to move
    // since the previous step. Teaching is mostly static physics-wise.
    if (this.bodies.length === 0 && !this.charMoved) return;
    this.charMoved = false;
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
    for (const { body, mesh } of this.bodies) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.bodies = [];
    this.ready = false;
  }
}
