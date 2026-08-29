/**
 * Environment / room engine - a real 3D classroom: floor, four walls, ceiling, door,
 * framed windows, the teacher's desk, a cabinet, plants, ceiling light fixtures,
 * clock and posters. Students and student desks/chairs were removed so the teaching
 * area stays clean. Large surfaces use PBR materials from the shared material library.
 */
import * as THREE from "three";
import type { MaterialLibrary } from "./materials";

export type ClassroomRefs = {
  group: THREE.Group;
  anchors: Record<"board" | "center" | "left" | "right" | "desk", THREE.Vector3>;
  interactables: THREE.Object3D[];
  lightFixtures: THREE.Object3D[];
};

const ROOM = { w: 18, d: 14.4, h: 4.6, zBack: -6.4, zFront: 8, xLeft: -9, xRight: 9 };

/** aoMap requires a second UV channel. */
function uv2(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geo.getAttribute("uv");
  if (uv && !geo.getAttribute("uv2")) geo.setAttribute("uv2", uv.clone());
  return geo;
}

export function buildClassroom(scene: THREE.Scene, lib: MaterialLibrary): ClassroomRefs {
  const group = new THREE.Group();
  group.name = "classroom";
  const interactables: THREE.Object3D[] = [];
  const lightFixtures: THREE.Object3D[] = [];

  const metal = lib.get("METAL_PBR", [2, 2]);
  const deskWood = lib.get("WOOD_DESK_PBR", [2, 1]);
  const chairWood = lib.get("WOOD_CHAIR_PBR", [1.5, 1]);

  /* ---------- shell ---------- */

  const floor = new THREE.Mesh(
    uv2(new THREE.PlaneGeometry(ROOM.w, ROOM.d + 2)),
    lib.get("FLOOR_TILE_PBR", [8, 7]),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 0.8;
  floor.receiveShadow = true;
  floor.name = "floor";
  group.add(floor);

  const ceil = new THREE.Mesh(
    uv2(new THREE.PlaneGeometry(ROOM.w, ROOM.d + 2)),
    lib.get("CEILING_PBR", [5, 4]),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ROOM.h, 0.8);
  ceil.name = "ceiling";
  group.add(ceil);

  const wallMat = lib.get("WALL_PAINT_PBR", [5, 1.4]);
  const mkWall = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(uv2(new THREE.PlaneGeometry(w, ROOM.h)), wallMat);
    m.position.set(x, ROOM.h / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
  };
  mkWall(ROOM.w, 0, ROOM.zBack, 0);
  mkWall(ROOM.w, 0, ROOM.zFront, Math.PI);
  mkWall(ROOM.d, ROOM.xLeft, 0.8, Math.PI / 2);
  mkWall(ROOM.d, ROOM.xRight, 0.8, -Math.PI / 2);

  const skirts: [number, number, number, number][] = [
    [ROOM.w, 0, ROOM.zBack + 0.05, 0],
    [ROOM.d, ROOM.xLeft + 0.05, 0.8, Math.PI / 2],
    [ROOM.d, ROOM.xRight - 0.05, 0.8, Math.PI / 2],
  ];
  skirts.forEach(([len, x, z, ry]) => {
    const s = new THREE.Mesh(uv2(new THREE.BoxGeometry(len, 0.16, 0.06)), chairWood);
    s.position.set(x, 0.08, z);
    s.rotation.y = ry;
    group.add(s);
  });

  /* ---------- door ---------- */

  const door = new THREE.Group();
  door.name = "door";
  const doorFrame = new THREE.Mesh(uv2(new THREE.BoxGeometry(1.36, 2.36, 0.12)), chairWood);
  const doorPanel = new THREE.Mesh(
    uv2(new THREE.BoxGeometry(1.16, 2.2, 0.07)),
    lib.get("DOOR_PBR"),
  );
  doorPanel.position.z = 0.06;
  doorPanel.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), metal);
  knob.position.set(0.44, 0, 0.13);
  door.add(doorFrame, doorPanel, knob);
  door.position.set(-6.4, 1.2, ROOM.zFront - 0.1);
  door.rotation.y = Math.PI;
  group.add(door);
  interactables.push(door);

  /* ---------- framed windows (right wall) ---------- */

  const glassMat = lib.get("GLASS_PBR");
  for (let i = 0; i < 3; i++) {
    const z = -2.4 + i * 3.2;
    const win = new THREE.Mesh(uv2(new THREE.PlaneGeometry(2.4, 1.9)), glassMat);
    win.position.set(ROOM.xRight - 0.06, 2.6, z);
    win.rotation.y = -Math.PI / 2;
    win.name = `window-${i}`;
    group.add(win);
    interactables.push(win);

    const outerFrame = new THREE.Mesh(uv2(new THREE.BoxGeometry(0.09, 2.12, 2.62)), metal);
    outerFrame.position.set(ROOM.xRight - 0.07, 2.6, z);
    group.add(outerFrame);
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.9, 0.07), metal);
    mullion.position.set(ROOM.xRight - 0.1, 2.6, z);
    group.add(mullion);
    const sill = new THREE.Mesh(uv2(new THREE.BoxGeometry(0.34, 0.1, 2.7)), deskWood);
    sill.position.set(ROOM.xRight - 0.2, 1.52, z);
    sill.receiveShadow = true;
    group.add(sill);
  }

  /* ---------- board frame + chalk ledge ---------- */

  // Frame matches the MASTER writing surface (6.9 × 2.72 hung at y = 1.75) —
  // a wider, taller board whose top row the teacher can still reach.
  const boardFrame = new THREE.Mesh(
    uv2(new THREE.BoxGeometry(7.4, 3.14, 0.16)),
    lib.get("BOARD_FRAME_PBR", [4, 2]),
  );
  boardFrame.position.set(0, 1.75, -6.3);
  boardFrame.castShadow = true;
  boardFrame.receiveShadow = true;
  group.add(boardFrame);

  const ledge = new THREE.Mesh(uv2(new THREE.BoxGeometry(7.1, 0.09, 0.26)), metal);
  ledge.position.set(0, 0.24, -6.04);
  ledge.receiveShadow = true;
  group.add(ledge);


  /* ---------- teacher desk ---------- */

  const desk = new THREE.Group();
  desk.name = "teacher-desk";
  const deskTop = new THREE.Mesh(uv2(new THREE.BoxGeometry(2.4, 0.1, 1)), deskWood);
  deskTop.position.y = 0.78;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  desk.add(deskTop);
  const legGeo = uv2(new THREE.BoxGeometry(0.1, 0.78, 0.1));
  [-1.1, 1.1].forEach((x) =>
    [-0.4, 0.4].forEach((z) => {
      const leg = new THREE.Mesh(legGeo, chairWood);
      leg.position.set(x, 0.39, z);
      leg.castShadow = true;
      desk.add(leg);
    }),
  );
  const deskBook = new THREE.Mesh(uv2(new THREE.BoxGeometry(0.4, 0.07, 0.3)), lib.get("PAPER_PBR"));
  deskBook.position.set(0.6, 0.87, 0.1);
  desk.add(deskBook);
  desk.position.set(-2.6, 0, -4.4);
  group.add(desk);
  interactables.push(deskTop);

  /* ---------- cabinet ---------- */

  const cabinet = new THREE.Group();
  cabinet.name = "cabinet";
  const body = new THREE.Mesh(uv2(new THREE.BoxGeometry(1.5, 2, 0.6)), chairWood);
  body.position.y = 1;
  body.castShadow = true;
  body.receiveShadow = true;
  cabinet.add(body);
  for (let s = 0; s < 3; s++) {
    const shelfBooks = new THREE.Mesh(
      uv2(new THREE.BoxGeometry(1.3, 0.3, 0.4)),
      lib.get("PAPER_PBR"),
    );
    shelfBooks.position.set(0, 0.45 + s * 0.6, 0.12);
    cabinet.add(shelfBooks);
  }
  const cabHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), metal);
  cabHandle.position.set(0.6, 1.2, 0.32);
  cabinet.add(cabHandle);
  cabinet.position.set(-8.1, 0, -4.2);
  cabinet.rotation.y = Math.PI / 2;
  group.add(cabinet);
  interactables.push(cabinet);

  /* ---------- ceiling light fixtures ---------- */

  const fixtureMat = lib.get("METAL_PBR", [1, 1]);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xf6faff,
    emissive: new THREE.Color(0xdfeaff),
    emissiveIntensity: 0.85,
    roughness: 0.4,
  });
  for (let i = 0; i < 3; i++) {
    const z = -4 + i * 3.4;
    const housing = new THREE.Mesh(uv2(new THREE.BoxGeometry(3.2, 0.12, 0.5)), fixtureMat);
    housing.position.set(0, ROOM.h - 0.1, z);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 0.36), tubeMat);
    tube.position.set(0, ROOM.h - 0.18, z);
    tube.name = `light-fixture-${i}`;
    group.add(housing, tube);
    lightFixtures.push(tube);
  }

  /* ---------- props: clock, posters, plants ---------- */

  const clock = new THREE.Group();
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), lib.solid(0xf2f4ff, 0.4));
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 10, 32), metal);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.01), lib.solid(0x1a1a26, 0.5));
  hand.position.y = 0.1;
  hand.position.z = 0.02;
  clock.add(clockFace, clockRim, hand);
  clock.position.set(3.6, 3.5, -6.3);
  clock.name = "clock";
  group.add(clock);
  interactables.push(clock);

  const posterMat = lib.get("PAPER_PBR");
  [
    [-8.9, 2.6, 1.2, Math.PI / 2],
    [-8.9, 2.6, 4.2, Math.PI / 2],
  ].forEach(([x, y, z, ry]) => {
    const poster = new THREE.Mesh(uv2(new THREE.PlaneGeometry(1.5, 1)), posterMat);
    poster.position.set(x!, y!, z!);
    poster.rotation.y = ry!;
    group.add(poster);
  });

  const mkPlant = (x: number, z: number) => {
    const plant = new THREE.Group();
    const pot = new THREE.Mesh(
      uv2(new THREE.CylinderGeometry(0.24, 0.18, 0.36, 18)),
      lib.get("PLASTIC_PBR", [1, 1]),
    );
    pot.position.y = 0.18;
    pot.castShadow = true;
    plant.add(pot);
    const leafMat = lib.solid(0x4f9a45, 0.85);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), leafMat);
      leaf.scale.set(1, 0.4, 0.55);
      const a = (i / 7) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.16, 0.45 + (i % 3) * 0.1, Math.sin(a) * 0.16);
      leaf.rotation.z = 0.5;
      leaf.rotation.y = a;
      leaf.castShadow = true;
      plant.add(leaf);
    }
    plant.position.set(x, 0, z);
    plant.name = "plant";
    group.add(plant);
    interactables.push(plant);
  };
  mkPlant(7.6, -5.2);
  mkPlant(-7.8, 5.6);

  scene.add(group);

  return {
    group,
    anchors: {
      board: new THREE.Vector3(0, 0, -5.1),
      center: new THREE.Vector3(0, 0, -3.4),
      left: new THREE.Vector3(-3, 0, -3.8),
      right: new THREE.Vector3(3, 0, -3.8),
      desk: new THREE.Vector3(-2.6, 0, -3.5),
    },
    interactables,
    lightFixtures,
  };
}
