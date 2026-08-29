/**
 * BEHAVIOURAL acceptance tests for the teaching camera (run in Node — the
 * CameraEngine is pure three.js math, no DOM/WebGL needed).
 *
 * Maps directly onto the camera acceptance tests:
 *   A — boots in the stable teaching composition
 *   B/C — one-finger swipes (orbit/pan calls) cannot rotate/tilt the camera
 *   D — two-finger pan calls cannot move the camera
 *   E — pinch/zoom calls cannot zoom the camera
 *   H/I — 16:9 ↔ 9:16 re-composes the teaching rig and resets framing state
 *   J — Reset Teaching View restores yaw 0 / pitch 0 / zoom 1 / pan 0
 *   + pan is applied EXACTLY ONCE (rig shift, verified numerically)
 *   + the matrix pipeline rests when the camera rests
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraEngine } from "../src/lib/classroom3d/cameras";

type V3 = { x: number; y: number; z: number };
const pos = (c: CameraEngine): V3 => c.camera.position;
const target = (c: CameraEngine): V3 => (c as unknown as { targetNow: V3 }).targetNow;
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

const updateUntilRest = (c: CameraEngine, frames = 240): void => {
  for (let i = 0; i < frames; i++) c.update(1 / 60);
};

test("A: the camera boots locked in the stable 16:9 teaching composition", () => {
  const c = new CameraEngine(16 / 9);
  assert.equal(c.isTeachingLocked(), true, "teaching lock must default ON");
  assert.ok(!c.isPortrait, "16:9 container → landscape rig");
  assert.ok(near(pos(c).x, 0) && near(pos(c).y, 1.85) && near(pos(c).z, -2.35));
  assert.ok(near(target(c).x, 0) && near(target(c).y, 1.5) && near(target(c).z, -4.2));
  assert.equal(c.camera.fov, 44);
});

test("B/C/D/E: orbit, pan and zoom calls cannot move the locked teaching camera", () => {
  const c = new CameraEngine(16 / 9);
  updateUntilRest(c);
  const before = { ...pos(c) };
  const beforeTarget = { ...target(c) };

  // the exact calls the old interaction engine made for swipes/pinch/wheel
  for (let i = 0; i < 60; i++) {
    c.orbitBy(-8, -5); // one-finger swipe
    c.panBy(6, 4); // two-finger drag
    c.zoomBy(-40); // pinch / wheel
  }
  for (let i = 0; i < 120; i++) c.update(1 / 60);

  assert.ok(near(pos(c).x, before.x, 1e-6), "camera position must not move");
  assert.ok(near(pos(c).y, before.y, 1e-6));
  assert.ok(near(pos(c).z, before.z, 1e-6));
  assert.ok(near(target(c).x, beforeTarget.x, 1e-6), "look target must not move");
  assert.ok(near(target(c).y, beforeTarget.y, 1e-6));
  assert.ok(near(target(c).z, beforeTarget.z, 1e-6));
});

test("pan is applied EXACTLY ONCE (rig translation, not doubled on the position)", () => {
  const c = new CameraEngine(16 / 9);
  c.setTeachingLock(false);
  updateUntilRest(c);
  c.panBy(30, 10); // one deliberate two-finger pan
  updateUntilRest(c);

  // rig constants (16:9)
  const rigPos = { x: 0, y: 1.85, z: -2.35 };
  const rigTarget = { x: 0, y: 1.5, z: -4.2 };
  // with yaw 0 / pitch 0 / zoom 1 the pan must shift position and target by the
  // SAME vector exactly once. The old bug produced 2× pan on the position.
  const posShift = { x: pos(c).x - rigPos.x, y: pos(c).y - rigPos.y, z: pos(c).z - rigPos.z };
  const tgtShift = {
    x: target(c).x - rigTarget.x,
    y: target(c).y - rigTarget.y,
    z: target(c).z - rigTarget.z,
  };
  assert.ok(near(posShift.x, tgtShift.x, 1e-3), "position shift must equal target shift");
  assert.ok(near(posShift.y, tgtShift.y, 1e-3));
  assert.ok(near(posShift.z, tgtShift.z, 1e-3));
  assert.ok(Math.abs(posShift.y) > 1e-3, "the pan must actually be applied");
});

test("H/I: ratio switch re-composes the rig and resets framing state", () => {
  const c = new CameraEngine(16 / 9);
  c.setTeachingLock(false);
  for (let i = 0; i < 30; i++) c.orbitBy(-10, 6);
  c.setRatioMode("9:16");
  assert.equal(c.isPortrait, true, "9:16 must select the portrait teaching rig");
  updateUntilRest(c);
  assert.ok(near(pos(c).y, 1.78) && near(pos(c).z, -3.05), "portrait rig position");
  assert.ok(near(target(c).y, 1.55) && near(target(c).z, -4.6), "portrait rig target");
  assert.equal(c.camera.fov, 62, "portrait FOV re-composition");

  c.setRatioMode("16:9");
  assert.equal(c.isPortrait, false);
  updateUntilRest(c);
  assert.ok(near(pos(c).y, 1.85) && near(pos(c).z, -2.35), "landscape rig restored");
});

test("J: Reset Teaching View restores the fixed teaching frame after drift", () => {
  const c = new CameraEngine(9 / 16);
  c.setTeachingLock(false);
  for (let i = 0; i < 40; i++) {
    c.orbitBy(-12, 7);
    c.panBy(9, -5);
    c.zoomBy(-30);
  }
  updateUntilRest(c);
  c.resetOrbit(); // the Reset Teaching View control
  updateUntilRest(c);
  assert.ok(near(pos(c).y, 1.78) && near(pos(c).z, -3.05), "back on the portrait rig");
  assert.ok(near(target(c).x, 0) && near(target(c).y, 1.55), "teaching look target");
});

test("the matrix pipeline rests once the camera is at rest", () => {
  const c = new CameraEngine(16 / 9);
  let projections = 0;
  let looks = 0;
  const cam = c.camera as unknown as Record<string, () => void>;
  const realProj = cam.updateProjectionMatrix.bind(c.camera);
  cam.updateProjectionMatrix = () => {
    projections++;
    realProj();
  };
  const realLook = cam.lookAt.bind(c.camera);
  cam.lookAt = () => {
    looks++;
    realLook();
  };
  updateUntilRest(c, 300);
  const projAtRest = projections;
  const lookAtRest = looks;
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  assert.equal(projections, projAtRest, "updateProjectionMatrix must stop at rest");
  assert.equal(looks, lookAtRest, "lookAt must stop at rest");
  assert.ok(lookAtRest < 300, "lookAt must be skipped for static frames");
});
