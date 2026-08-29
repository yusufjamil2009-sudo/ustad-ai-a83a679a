/** 3D object engine — spawn, focus, spin, drop and remove educational props. */
import * as THREE from "three";
import { animateDiagram3D, createDiagram3D } from "./diagrams3d";
import { isDiagram3D, type Object3DKind } from "./types";

function mat(color: number, rough = 0.6, metal = 0.1, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
}

export function createObject(kind: Object3DKind, labels: string[] = []): THREE.Object3D {
  if (isDiagram3D(kind)) return createDiagram3D(kind, labels);
  const g = new THREE.Group();
  switch (kind) {
    case "plant": {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.12, 0.2, 16),
        mat(0xb4623c, 0.9),
      );
      pot.position.y = 0.1;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.4, 8), mat(0x4f8a3a));
      stem.position.y = 0.4;
      g.add(pot, stem);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0x63b455, 0.8));
        leaf.scale.set(1, 0.35, 0.6);
        leaf.position.set(
          Math.cos((i / 5) * 6.28) * 0.13,
          0.5 + i * 0.03,
          Math.sin((i / 5) * 6.28) * 0.13,
        );
        leaf.rotation.z = 0.4;
        g.add(leaf);
      }
      break;
    }
    case "sun": {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 24, 20),
        mat(0xffd489, 0.4, 0, 0xffb347),
      );
      (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
      const glow = new THREE.PointLight(0xffc46b, 12, 4, 2);
      g.add(core, glow);
      break;
    }
    case "molecule": {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), mat(0x2b2f45, 0.4, 0.3));
      g.add(c);
      const pos = [
        [0.28, 0.16, 0],
        [-0.28, 0.16, 0],
        [0, -0.2, 0.22],
        [0, -0.2, -0.22],
      ];
      pos.forEach((p) => {
        const a = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat(0x7fe3d4, 0.35, 0.2));
        a.position.set(p[0]!, p[1]!, p[2]!);
        const bond = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.018, a.position.length(), 8),
          mat(0xcfd7ee),
        );
        bond.position.copy(a.position).multiplyScalar(0.5);
        bond.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          a.position.clone().normalize(),
        );
        g.add(a, bond);
      });
      break;
    }
    case "globe": {
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), mat(0x3b7ad1, 0.55));
      globe.position.y = 0.42;
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.12, 0.3, 12),
        mat(0x8a6a3c, 0.8),
      );
      stand.position.y = 0.15;
      g.add(globe, stand);
      break;
    }
    case "cube": {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat(0xffd489, 0.5, 0.2));
      cube.position.y = 0.17;
      g.add(cube);
      break;
    }
    case "book": {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.46), mat(0xa2413f, 0.85));
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.43), mat(0xf3ecd8, 0.95));
      pages.position.y = 0.005;
      cover.position.y = 0.05;
      pages.position.y = 0.055;
      g.add(cover, pages);
      break;
    }
    case "monument": {
      // Educational Taj-like tomb: platform, cube chamber, onion dome, 4 minarets.
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), mat(0xe8e4dc, 0.85));
      base.position.y = 0.04;
      const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), mat(0xf2efe6, 0.7));
      chamber.position.y = 0.24;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.08, 16), mat(0xeeeae0));
      drum.position.y = 0.44;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), mat(0xf7f4ec, 0.45));
      dome.position.y = 0.56;
      g.add(base, chamber, drum, dome);
      [
        [0.38, 0.38],
        [0.38, -0.38],
        [-0.38, 0.38],
        [-0.38, -0.38],
      ].forEach(([x, z]) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.48, 10), mat(0xf2efe6));
        m.position.set(x!, 0.28, z!);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xe8e0d0));
        cap.position.set(x!, 0.54, z!);
        g.add(m, cap);
      });
      break;
    }
    case "heart": {
      // Four chamber blobs + aorta — educational, not a medical scan.
      const chamber = (x: number, y: number, z: number, color: number) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 16, 12),
          mat(color, 0.55, 0.05, 0x4a1020),
        );
        m.position.set(x, y, z);
        g.add(m);
      };
      chamber(-0.12, 0.28, 0.04, 0xc0392b); // RA
      chamber(-0.12, 0.1, 0.04, 0xa93226); // RV
      chamber(0.12, 0.28, 0.04, 0xe74c3c); // LA
      chamber(0.14, 0.08, 0.02, 0x922b21); // LV (larger wall feel)
      const aorta = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.035, 10, 18, Math.PI),
        mat(0x7b241c, 0.4),
      );
      aorta.position.set(0.12, 0.42, 0);
      aorta.rotation.z = Math.PI / 2;
      g.add(aorta);
      break;
    }
    case "flask": {
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.32, 20, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xcfe9ff,
          transparent: true,
          opacity: 0.4,
          roughness: 0.1,
        }),
      );
      body.position.y = 0.16;
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.18, 12),
        mat(0xcfe9ff, 0.1),
      );
      neck.position.y = 0.41;
      const liquid = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.14, 20),
        mat(0x7fe3d4, 0.3, 0, 0x1c6b62),
      );
      liquid.position.y = 0.09;
      g.add(body, neck, liquid);
      break;
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  g.name = `object-${kind}`;
  return g;
}

type Entry = {
  obj: THREE.Object3D;
  spin: number;
  target: THREE.Vector3;
  scale: number;
  kind: Object3DKind;
  labels: string[];
};

export type ObjectSnapshot = {
  id: string;
  kind: Object3DKind;
  x: number;
  y: number;
  z: number;
  spin: number;
  scale: number;
  labels: string[];
};

export class ObjectEngine {
  private items = new Map<string, Entry>();
  constructor(
    private scene: THREE.Scene,
    private onSpawn?: (obj: THREE.Object3D) => void,
    private onRemove?: (obj: THREE.Object3D) => void,
  ) {}

  show(id: string, kind: Object3DKind, at: THREE.Vector3, labels: string[] = []): THREE.Object3D {
    const existing = this.items.get(id);
    if (existing) return existing.obj;
    const obj = createObject(kind, labels);
    obj.position.copy(at);
    obj.scale.setScalar(0.001);
    obj.userData["objectId"] = id;
    this.scene.add(obj);
    this.items.set(id, { obj, spin: 0, target: at.clone(), scale: 1, kind, labels: [...labels] });
    this.onSpawn?.(obj);
    return obj;
  }

  hide(id: string): void {
    const e = this.items.get(id);
    if (!e) return;
    this.onRemove?.(e.obj);
    e.obj.removeFromParent();
    // Dispose geometries/materials created by createObject for this visual so
    // they don't leak across lessons (§15). Shared scene assets (room, board,
    // teacher) are not owned here and are never disposed.
    disposeObject3D(e.obj);
    this.items.delete(id);
  }

  spin(id: string, speed = 1.4): void {
    const e = this.items.get(id);
    if (e) e.spin = speed;
  }

  focus(id: string): THREE.Vector3 | null {
    const e = this.items.get(id);
    if (!e) return null;
    e.scale = isDiagram3D(e.kind) ? 2.3 : 1.5;
    return e.obj.position.clone();
  }

  get(id: string): THREE.Object3D | undefined {
    return this.items.get(id)?.obj;
  }

  all(): THREE.Object3D[] {
    return [...this.items.values()].map((e) => e.obj);
  }

  update(dt: number, clock = 0): void {
    this.items.forEach((e) => {
      e.obj.rotation.y += e.spin * dt;
      if (isDiagram3D(e.kind)) animateDiagram3D(e.obj, clock);
      const s = e.obj.scale.x;
      e.obj.scale.setScalar(THREE.MathUtils.lerp(s, e.scale, Math.min(1, dt * 4)));
    });
  }

  clear(): void {
    [...this.items.keys()].forEach((k) => this.hide(k));
  }

  /** Serialise live 3D objects so a refresh can restore them (Bugs 11, 35). */
  snapshot(): ObjectSnapshot[] {
    return [...this.items.entries()].map(([id, e]) => ({
      id,
      kind: e.kind,
      x: e.obj.position.x,
      y: e.obj.position.y,
      z: e.obj.position.z,
      spin: e.spin,
      scale: e.scale,
      labels: [...e.labels],
    }));
  }

  /** Rebuild objects from a snapshot. Existing objects are cleared first. */
  restore(list: ObjectSnapshot[]): void {
    this.clear();
    for (const o of list) {
      this.show(o.id, o.kind, new THREE.Vector3(o.x, o.y, o.z), o.labels);
      const e = this.items.get(o.id);
      if (!e) continue;
      e.spin = o.spin;
      e.scale = o.scale;
      e.obj.scale.setScalar(o.scale);
    }
  }
}

/** Dispose geometries/materials of a subtree created by this engine. */
function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
  root.removeFromParent();
}
