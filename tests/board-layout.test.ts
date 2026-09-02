/**
 * CONTENT-AWARE BOARD LAYOUT tests (§1/§2/§25/§26 of the board-write fix).
 *
 * Runs the REAL BoardEngine in Node against the deterministic 2D-context stub
 * (same harness as board-engine.behavior.test.ts) and verifies:
 *  1. Text-only phases use the FULL board width (the old half-board bug: the
 *     concept region was locked to x:120..1360 while the right column stayed
 *     permanently empty).
 *  2. Diagram space is reserved ONLY when a diagram actually exists — the
 *     current band's text re-flows into the left column and the diagram sits
 *     beside it (CASE B), with zero overlap.
 *  3. After a diagram phase (clear + new text), the board returns to full
 *     width — no permanent right-side reservation (CASE D).
 *  4. Highlight is a POST-WRITE action: hlReveal stays 0 until the target is
 *     fully written (reveal >= 1), then sweeps to 1 — the final highlighted
 *     state is never revealed prematurely (§12/§15).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const CHAR_W = 0.55;
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += (ch.charCodeAt(0) > 0x2ff ? 1.0 : CHAR_W) * size;
  return w;
}

function makeCtx() {
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    textBaseline: "",
    textAlign: "",
    measureText(s: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16);
      return { width: textWidth(s, size) };
    },
    fillText() {},
    strokeText() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    ellipse() {},
    closePath() {},
    clip() {},
    stroke() {},
    fill() {},
    setLineDash() {},
    drawImage() {},
  };
  return ctx;
}

function withFakeDocument<T>(fn: () => T): T {
  const ctx = makeCtx();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: () => canvas };
  const restore = () => {
    g.document = prev;
  };
  try {
    const out = fn() as unknown;
    if (out instanceof Promise) return out.finally(restore) as T;
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

async function loadBoard() {
  return import("../src/lib/classroom2d/board.ts");
}

type SnapItem = {
  kind: string;
  role: string;
  region: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  highlight?: boolean;
  hlReveal?: number;
  reveal: number;
};

const settle = async (
  board: { update: (dt: number) => void; busy: boolean },
  maxFrames = 12000,
) => {
  for (let i = 0; i < maxFrames && board.busy; i++) board.update(1 / 60);
};

test("text-only lesson uses the FULL board width (no half-board lock)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine();
    b.apply({ op: "write", text: "Photosynthesis", size: 84, role: "title" });
    b.apply({
      op: "write",
      text: "Photosynthesis is the process by which plants make food using sunlight and chlorophyll.",
    });
    b.apply({
      op: "write",
      text: "Plants take carbon dioxide and water from the environment to prepare glucose.",
    });
    b.apply({
      op: "write",
      text: "Oxygen is released into the atmosphere as a by-product of this process.",
    });
    await settle(b);
    const items = (b.snapshot().items as unknown as SnapItem[]).filter(
      (i) => i.kind === "text" && i.role === "concept",
    );
    assert.ok(items.length >= 3, `concept text items present (${items.length})`);
    // THE FIX: text must extend well past the old 1360px half-board boundary
    // (the diagram column was x:1440..2420 and stayed empty in text-only phases).
    for (const it of items) {
      assert.ok(
        it.x + it.w > 1440,
        `concept text reaches the right half of the board: x=${it.x} w=${it.w} (right=${it.x + it.w})`,
      );
    }
    // and it must still stay inside the safe board width (no overflow)
    for (const it of items) {
      assert.ok(it.x + it.w <= 2560 + 1, `no horizontal overflow: right=${it.x + it.w}`);
    }
  });
});

test("diagram reserves the right column ONLY when present; text re-flows beside it", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine();
    b.apply({ op: "write", text: "Photosynthesis", size: 84, role: "title" });
    b.apply({ op: "write", text: "Plants make their own food using sunlight." });
    // diagram arrives → the band's text must re-flow to the left column and the
    // diagram sits in the right column, side by side, never overlapping.
    b.apply({
      op: "diagram",
      kind: "plant",
      title: "Photosynthesis",
      labels: ["sunlight", "food"],
    });
    await settle(b);
    const items = b.snapshot().items as unknown as SnapItem[];
    const diagram = items.find((i) => i.kind === "diagram");
    const bandText = items.filter(
      (i) =>
        i.kind === "text" &&
        i.role === "concept" &&
        i.y >= diagram!.y - 700 &&
        i.y < diagram!.y + 1,
    );
    assert.ok(diagram, "diagram placed");
    assert.ok(diagram.x >= 1440 - 1, `diagram in the right column: x=${diagram.x}`);
    for (const t of bandText) {
      assert.ok(
        t.x + t.w <= 1440 - 26 + 1,
        `band text re-flowed left of the diagram: right=${t.x + t.w}`,
      );
    }
    // zero overlap between the diagram and every other item
    for (const a of items) {
      for (const c of items) {
        if (a === c) continue;
        const overlap = !(
          a.x + a.w <= c.x ||
          c.x + c.w <= a.x ||
          a.y + a.h <= c.y ||
          c.y + c.h <= a.y
        );
        assert.ok(!overlap, `no overlap: ${a.kind}/${a.role} vs ${c.kind}/${c.role}`);
      }
    }
  });
});

test("after a diagram phase, new text returns to FULL width (no permanent reservation)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine();
    b.apply({ op: "write", text: "Growth of Plants", size: 84, role: "title" });
    b.apply({ op: "write", text: "Plants grow towards sunlight and absorb water through roots." });
    b.apply({ op: "diagram", kind: "plant", title: "Growth", labels: ["root", "leaf"] });
    await settle(b);
    // diagram phase over → fresh board, text-only phase again
    b.apply({ op: "clear" });
    b.apply({ op: "write", text: "Growth of Plants", size: 84, role: "title" });
    b.apply({
      op: "write",
      text: "Plants use chlorophyll to convert light energy into chemical energy.",
    });
    await settle(b);
    const items = (b.snapshot().items as unknown as SnapItem[]).filter(
      (i) => i.kind === "text" && i.role === "concept",
    );
    assert.ok(items.length >= 1);
    // no diagram on this band → full width again (no wasted right side)
    const last = items[items.length - 1]!;
    assert.ok(
      last.x + last.w > 1440,
      `post-diagram text uses full width: right=${last.x + last.w}`,
    );
  });
});

test("heading highlight is a POST-WRITE action (never before the writing completes)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine();
    // the same beat writes AND highlights (like the 'ask the class' step)
    b.apply({ op: "write", text: "Why do plants need sunlight?", size: 46 });
    b.apply({ op: "highlight", text: "Why do plants need sunlight?" });
    const items = () => b.snapshot().items as unknown as SnapItem[];
    const t = () => items().find((i) => i.kind === "text")!;
    assert.ok(t().highlight === true, "highlight flag set");
    assert.equal(t().hlReveal, 0, "highlight sweep starts at 0");
    assert.ok(t().reveal < 1, "text not yet written");

    // step the handwriting: hlReveal must stay 0 while reveal < 1
    let wrote = false;
    for (let i = 0; i < 600; i++) {
      b.update(1 / 60);
      if (t().reveal >= 1) {
        wrote = true;
        break;
      }
      assert.equal(t().hlReveal, 0, "no highlight before writing completes");
    }
    assert.ok(wrote, "writing completes within the frame budget");
    // now the highlight sweeps to completion
    for (let i = 0; i < 200 && b.busy; i++) b.update(1 / 60);
    assert.ok(t().hlReveal >= 1, "highlight sweep completes after writing");
  });
});
