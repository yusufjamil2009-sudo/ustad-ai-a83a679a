/**
 * 3D diagram engine — builds real, labelled 3D diagrams that stand in the classroom.
 * Used when the AI's answer is better shown as a 3D object than written on the board.
 */
import * as THREE from "three";
import type { Diagram3DKind } from "./types";

function mat(color: number, rough = 0.55, metal = 0.15, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
}

/** Floating billboard label so a 3D diagram actually reads as a diagram. */
export function makeLabel(text: string, color = "#eaf2ff"): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 64px Inter, system-ui, sans-serif";
  const w = Math.min(496, ctx.measureText(text).width + 48);
  ctx.fillStyle = "rgba(8,12,24,0.6)";
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 24, w, 80, 22);
  ctx.fill();
  ctx.font = "600 64px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(0.5, 0.125, 1);
  sprite.userData["isLabel"] = true;
  return sprite;
}

function link(from: THREE.Vector3, to: THREE.Vector3, color = 0xcfd7ee, r = 0.013): THREE.Mesh {
  const dir = to.clone().sub(from);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, Math.max(0.001, dir.length()), 8),
    mat(color, 0.4, 0.25),
  );
  m.position.copy(from).add(dir.clone().multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return m;
}

function ring(radius: number, tube: number, color: number, tilt: THREE.Euler): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 48),
    mat(color, 0.35, 0.3, color),
  );
  (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
  m.rotation.copy(tilt);
  return m;
}

export function createDiagram3D(kind: Diagram3DKind, labels: string[] = []): THREE.Object3D {
  const g = new THREE.Group();
  const text = (i: number, fallback: string) => labels[i] ?? fallback;

  switch (kind) {
    case "atom3d": {
      const nucleus = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 24, 18),
        mat(0xff8a5c, 0.35, 0.25, 0xff5a2a),
      );
      (nucleus.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
      nucleus.position.y = 0.55;
      g.add(nucleus);
      const tilts: THREE.Euler[] = [
        new THREE.Euler(Math.PI / 2, 0, 0),
        new THREE.Euler(Math.PI / 2, 0, Math.PI / 3),
        new THREE.Euler(Math.PI / 2, Math.PI / 3, -Math.PI / 4),
      ];
      tilts.forEach((t, i) => {
        const shell = ring(0.24 + i * 0.09, 0.006, 0x7fb2ff, t);
        shell.position.y = 0.55;
        shell.name = `shell-${i}`;
        const e = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 16, 12),
          mat(0x9fd8ff, 0.3, 0.4, 0x2f6fd0),
        );
        e.name = `electron-${i}`;
        e.position.set(0.24 + i * 0.09, 0, 0);
        shell.add(e);
        g.add(shell);
      });
      const nl = makeLabel(text(0, "Nucleus"), "#ffd0b8");
      nl.position.set(0, 0.78, 0);
      const el = makeLabel(text(1, "Electron shells"), "#bcdcff");
      el.position.set(0, 0.16, 0);
      g.add(nl, el);
      break;
    }

    case "bars3d": {
      const values = [0.28, 0.46, 0.36, 0.6, 0.5];
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.36), mat(0x2a3050, 0.8, 0.1));
      base.position.y = 0.01;
      g.add(base);
      values.forEach((v, i) => {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, v, 0.12),
          mat(i % 2 ? 0x7fe3d4 : 0xffd489, 0.5, 0.2),
        );
        bar.position.set(-0.34 + i * 0.17, v / 2 + 0.02, 0);
        g.add(bar);
      });
      const t = makeLabel(text(0, "Comparison"), "#ffe6b8");
      t.position.set(0, 0.78, 0);
      const x = makeLabel(text(1, "Categories"), "#cfe2ff");
      x.position.set(0, -0.1, 0.2);
      g.add(t, x);
      break;
    }

    case "cycle3d": {
      const hub = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 20, 16),
        mat(0xffd489, 0.4, 0.2, 0xffa63c),
      );
      hub.position.y = 0.5;
      g.add(hub);
      // Bug 34: node count follows the real labels, not a hard cap of four.
      const n = Math.max(3, labels.length || 4);
      const nodes: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(a) * 0.34, 0.5, Math.sin(a) * 0.34);
        nodes.push(p);
        const node = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 18, 14),
          mat(0x7fe3d4, 0.4, 0.25),
        );
        node.position.copy(p);
        g.add(node);
        const l = makeLabel(text(i, `Stage ${i + 1}`), "#d6fff6");
        l.position.copy(p).add(new THREE.Vector3(0, 0.16, 0));
        l.scale.set(0.38, 0.095, 1);
        g.add(l);
      }
      for (let i = 0; i < n; i++) {
        g.add(link(nodes[i]!, nodes[(i + 1) % n]!, 0x9fb6ff));
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.03, 0.08, 12),
          mat(0x9fb6ff, 0.4, 0.3),
        );
        const from = nodes[i]!;
        const to = nodes[(i + 1) % n]!;
        arrow.position.copy(from).lerp(to, 0.72);
        arrow.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          to.clone().sub(from).normalize(),
        );
        g.add(arrow);
      }
      g.add(ring(0.34, 0.004, 0x5f7bd0, new THREE.Euler(Math.PI / 2, 0, 0)).translateY(0.5));
      break;
    }

    case "triangle3d": {
      const a = new THREE.Vector3(-0.3, 0.12, 0);
      const b = new THREE.Vector3(0.3, 0.12, 0);
      const c = new THREE.Vector3(0.02, 0.72, 0);
      const face = new THREE.Mesh(
        new THREE.BufferGeometry().setFromPoints([a, b, c]).setIndex([0, 1, 2]),
        new THREE.MeshStandardMaterial({
          color: 0x7fb2ff,
          transparent: true,
          opacity: 0.28,
          roughness: 0.4,
          side: THREE.DoubleSide,
        }),
      );
      face.geometry.computeVertexNormals();
      g.add(
        face,
        link(a, b, 0xffd489, 0.012),
        link(b, c, 0xffd489, 0.012),
        link(c, a, 0xffd489, 0.012),
      );
      const h = link(new THREE.Vector3(0.02, 0.12, 0), c, 0x7fe3d4, 0.007);
      g.add(h);
      const lb = makeLabel(text(0, "base"), "#ffe6b8");
      lb.position.set(0, 0.04, 0.02);
      lb.scale.set(0.3, 0.075, 1);
      const lh = makeLabel(text(1, "height"), "#d6fff6");
      lh.position.set(0.2, 0.42, 0);
      lh.scale.set(0.32, 0.08, 1);
      const lf = makeLabel(text(2, "Area = ½ × base × height"), "#eaf2ff");
      lf.position.set(0, 0.9, 0);
      g.add(lb, lh, lf);
      break;
    }

    case "pyramid3d": {
      const tiers = [
        { w: 0.62, y: 0.06, color: 0x4f7ad1 },
        { w: 0.44, y: 0.2, color: 0x7fb2ff },
        { w: 0.26, y: 0.34, color: 0x7fe3d4 },
      ];
      tiers.forEach((t, i) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(t.w, 0.11, t.w * 0.55),
          mat(t.color, 0.55, 0.2),
        );
        m.position.y = t.y;
        g.add(m);
        const l = makeLabel(text(i, `Level ${i + 1}`));
        l.position.set(0, t.y, t.w * 0.36);
        l.scale.set(0.34, 0.085, 1);
        g.add(l);
      });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 4), mat(0xffd489, 0.45, 0.25));
      cap.position.y = 0.5;
      cap.rotation.y = Math.PI / 4;
      g.add(cap);
      break;
    }

    case "dna3d": {
      const turns = 2.4;
      const steps = 44;
      const strandA: THREE.Vector3[] = [];
      const strandB: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * turns * Math.PI * 2;
        const y = 0.1 + t * 0.72;
        strandA.push(new THREE.Vector3(Math.cos(a) * 0.16, y, Math.sin(a) * 0.16));
        strandB.push(new THREE.Vector3(-Math.cos(a) * 0.16, y, -Math.sin(a) * 0.16));
      }
      for (let i = 0; i < steps; i++) {
        g.add(link(strandA[i]!, strandA[i + 1]!, 0x7fb2ff, 0.011));
        g.add(link(strandB[i]!, strandB[i + 1]!, 0xff9a7c, 0.011));
        if (i % 4 === 0) g.add(link(strandA[i]!, strandB[i]!, 0x7fe3d4, 0.007));
      }
      const l = makeLabel(text(0, "Double helix"), "#d6fff6");
      l.position.set(0, 0.94, 0);
      g.add(l);
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
  g.name = `diagram3d-${kind}`;
  g.userData["diagram3d"] = kind;
  return g;
}

/** Per-frame life: orbit electrons, drift cycle rings — keeps the diagram alive while the teacher explains. */
export function animateDiagram3D(obj: THREE.Object3D, clock: number): void {
  const kind = obj.userData["diagram3d"] as Diagram3DKind | undefined;
  if (kind === "atom3d") {
    for (let i = 0; i < 3; i++) {
      const shell = obj.getObjectByName(`shell-${i}`);
      if (shell) shell.rotation.z = clock * (0.9 + i * 0.5);
    }
  }
  obj.traverse((o) => {
    if (o.userData["isLabel"]) o.position.y += Math.sin(clock * 2 + o.position.x * 4) * 0.00035;
  });
}
