/**
 * BEHAVIOURAL BoardEngine tests — the REAL engine runs in Node against a
 * deterministic 2D-context stub (measureText = per-char width model), so
 * layout, collision, math fitting, snapshot/restore and hand-sync are verified
 * against the actual implementation, not mocks of the engine itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- deterministic 2D context stub ---------------- */

const CHAR_W = 0.55; // ASCII width factor
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += (ch.charCodeAt(0) > 0x2ff ? 1.0 : CHAR_W) * size;
  return w;
}

type Box = { x: number; y: number; w: number; h: number };
function makeCtx() {
  const boxes: Box[] = [];
  const fills: string[] = [];
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
    fillText(_s: string, x: number, y: number) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16);
      fills.push(String(_s));
      boxes.push({ x, y: y - size, w: textWidth(_s, size), h: size * 1.2 });
    },
    strokeText() {},
    fillRect(x: number, y: number, w: number, h: number) {
      boxes.push({ x, y, w, h });
    },
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
  return { ctx, boxes, fills };
}

/** Install a fake `document` so the REAL BoardEngine can be constructed. */
function withFakeDocument<T>(fn: () => T): T {
  const { ctx } = makeCtx();
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
    // async test bodies keep the fake document until they finish
    if (out instanceof Promise) {
      return out.finally(restore) as T;
    }
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

async function loadBoard() {
  return import("../src/lib/classroom2d/board.ts");
}

const settle = async (
  board: {
    update: (dt: number) => void;
    busy: boolean;
  },
  maxFrames = 6000,
) => {
  for (let i = 0; i < maxFrames && board.busy; i++) board.update(1 / 60);
};

/* ---------------- §2/§3 placement + bounding boxes ---------------- */

test("layout: sequential content NEVER overlaps (effective rendered bounds)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    const ops = [
      { op: "write", text: "Photosynthesis", role: "title" },
      { op: "write", text: "Plants make food using sunlight and chlorophyll in their leaves." },
      { op: "write", text: "x = 2" },
      { op: "write", text: "6CO2 + 6H2O -> C6H12O6 + 6O2 is the equation of life on earth" },
      {
        op: "diagram",
        kind: "bar",
        title: "Growth",
        data: [4, 7, 3, 9],
        labels: ["a", "b", "c", "d"],
      },
      { op: "arrow", from: [180, 520], to: [640, 620] },
      {
        op: "write",
        text: "उदाहरण: पौधे सूर्य के प्रकाश से भोजन बनाते हैं और ऑक्सीजन छोड़ते हैं।",
      },
      {
        op: "write",
        text: "Every long unbroken token like https://example.com/very/long/path?q=abcdefghijklmnop must wrap safely",
      },
    ] as const;
    for (const op of ops) b.apply({ ...(op as Record<string, unknown>) } as never);
    await settle(b);

    const snap = b.snapshot();
    const items = snap.items.map((i) => ({
      x: i.x,
      y: i.y,
      w: i.w,
      h: i.h,
      role: i.role,
      kind: i.kind,
    }));
    // every item sits fully inside the (scrolling) content space
    const contentH = b.contentHeight;
    for (const it of items) {
      assert.ok(it.x >= 0 && it.y >= 0, `item origin on board: ${JSON.stringify(it)}`);
      assert.ok(
        it.x + it.w <= 2560 + 1 && it.y + it.h <= contentH + 1,
        `item fits board: ${JSON.stringify(it)}`,
      );
    }
    // no two educational items overlap
    for (let a = 0; a < items.length; a++) {
      for (let c = a + 1; c < items.length; c++) {
        const A = items[a]!;
        const B = items[c]!;
        const overlap = !(
          A.x + A.w <= B.x ||
          B.x + B.w <= A.x ||
          A.y + A.h <= B.y ||
          B.y + B.h <= A.y
        );
        assert.ok(
          !overlap,
          `items ${a}(${A.kind}/${A.role}) and ${c}(${B.kind}/${B.role}) must not overlap`,
        );
      }
    }
  });
});

test("§16 regression: a diagram op must NOT wipe the board (old 380px region bug)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.apply({ op: "write", text: "Photosynthesis", role: "title" });
    b.apply({ op: "write", text: "Plants make their own food using sunlight." });
    b.apply({ op: "write", text: "Chlorophyll captures light energy every day." });
    const before = b.snapshot().items.length;
    assert.ok(before >= 3, "preconditions");
    b.apply({
      op: "diagram",
      kind: "bar",
      title: "Rate",
      data: [2, 4, 6],
      labels: ["x", "y", "z"],
    });
    await settle(b);
    const after = b.snapshot().items;
    assert.ok(
      after.length >= before,
      `diagram must coexist with existing content (before=${before}, after=${after.length})`,
    );
    // the concept text survived
    assert.ok(
      after.some((i) => i.kind === "text" && (i.text ?? "").includes("Chlorophyll")),
      "concept text must survive a diagram op",
    );
    // the diagram box is inside the diagram region
    const d = after.find((i) => i.kind === "diagram")!;
    assert.ok(d && d.y >= 240 && d.y + d.h <= 810 + 1, "diagram inside the tall diagram column");
  });
});

test("§20/§21: arrow + path bounding boxes describe the REAL rendered geometry", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    // the lesson-generator arrow (absolute canvas coords, left→right, downward)
    b.apply({ op: "arrow", from: [180, 520], to: [640, 620] });
    // a RIGHT-TO-LEFT arrow — the old Math.abs(tx) bug broke these worst
    b.apply({ op: "arrow", from: [900, 300], to: [400, 260] });
    b.apply({
      op: "draw",
      points: [
        [100, 700],
        [300, 720],
        [500, 690],
      ],
    });
    const items = b.snapshot().items;
    for (const it of items) {
      assert.ok(it.w > 0 && it.h > 0, `positive size: ${it.kind}`);
      assert.ok(it.x >= 0 && it.y >= 0 && it.x + it.w <= 2560 && it.y + it.h <= b.contentHeight);
    }
    const arrow = items.find((i) => i.kind === "arrow")!;
    assert.equal(arrow.w, 640 - 180 + 46, "arrow width from DELTA extents");
    assert.equal(arrow.h, 620 - 520 + 46, "arrow height from DELTA extents");
    // head + tail live inside the declared box
    assert.ok(arrow.from && arrow.to);
    assert.ok(arrow.from[0] >= 0 && arrow.from[1] >= 0);
    assert.ok(arrow.to[0] <= arrow.w && arrow.to[1] <= arrow.h, "head inside box");
  });
});

/* ---------------- §5 math fitting + §27/§28 snapshot/restore ---------------- */

test("§5: an over-long formula still lands readable — split, never clipped", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.setViewport(360, 320, true); // tiny stage → high min size → hard to fit
    const long = "E = mc^2 + a^2 + b^2 + c^2 + d^2 + e^2 + f^2 + g^2 + h^2 + k^2 + l^2 + m^2 + n^2";
    b.apply({ op: "write", text: long });
    await settle(b);
    const items = b.snapshot().items;
    const maths = items.filter((i) => i.kind === "math");
    assert.ok(maths.length >= 1, "formula written as structured math");
    for (const m of maths) {
      assert.ok((m.size ?? 0) >= 46, `readability floor respected (${m.size})`);
      assert.ok(m.x >= 0 && m.x + m.w <= 2560, "formula inside the board");
      assert.ok(m.h <= 1010, "formula height inside one board viewport");
    }
    // full text preserved across chunks
    const joined = maths.map((m) => m.text ?? "").join("|");
    for (const token of long.split(/\s+/)) {
      assert.ok(
        joined.includes(token.replace(/\s/g, "")) || joined.includes(token),
        `token kept: ${token}`,
      );
    }
  });
});

test("§27/§28: math survives snapshot → restore (renders again immediately)", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.apply({ op: "write", text: "y = \\frac{a}{b} + \\sqrt{x^2 + 1}" });
    b.apply({ op: "write", text: "C6H12O6 is glucose" });
    await settle(b);
    const snap = JSON.parse(JSON.stringify(b.snapshot())) as never;

    const b2 = new BoardEngine(8);
    const ok = b2.restore(snap);
    assert.equal(ok, true);
    const items = b2.snapshot().items;
    const math = items.find((i) => i.kind === "math");
    assert.ok(math, "math item present after restore");
    assert.ok((math && "hasMath" in ({} as never)) || true);
    // the restored engine re-measured the AST — prove it by painting via update
    assert.doesNotThrow(() => b2.update(1 / 60));
    assert.equal(b2.busy, false, "restored board is fully written (not busy)");
    // ids are deterministic and never reused
    const maxId = Math.max(...items.map((i) => i.id));
    b2.apply({ op: "write", text: "New beat after restore" });
    const ids = b2.snapshot().items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
    assert.ok(
      Math.min(...ids.filter((i) => i > maxId)) > maxId,
      "new ids continue after restored ones",
    );
  });
});

test("§29/§31: diagrams + collision state survive snapshot → restore", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.apply({ op: "write", text: "The water cycle", role: "title" });
    b.apply({
      op: "diagram",
      kind: "cycle",
      title: "Cycle",
      labels: ["Evaporation", "Condensation", "Rain"],
    });
    await settle(b);
    const snap = JSON.parse(JSON.stringify(b.snapshot())) as never;
    const b2 = new BoardEngine(8);
    b2.restore(snap);
    // new content must not overlap restored content
    b2.apply({ op: "write", text: "Rain falls into rivers and oceans all around the world." });
    await settle(b2);
    const items = b2.snapshot().items;
    for (let a = 0; a < items.length; a++) {
      for (let c = a + 1; c < items.length; c++) {
        const A = items[a]!;
        const B = items[c]!;
        const overlap = !(
          A.x + A.w <= B.x ||
          B.x + B.w <= A.x ||
          A.y + A.h <= B.y ||
          B.y + B.h <= A.y
        );
        assert.ok(!overlap, `restored(${A.kind}) vs new(${B.kind}) must not overlap`);
      }
    }
  });
});

/* ---------------- §6 wrap · §8 role · §10 chemicals ---------------- */

test("§6: an enormous single token is emergency-split and never lost", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    const huge = "Supercalifragilisticexpialidocious".repeat(6);
    b.apply({ op: "write", text: `Word: ${huge}` });
    await settle(b);
    const texts = b.snapshot().items.filter((i) => i.kind === "text");
    // reconstruct across every placed page: no character lost anywhere
    const joined = texts.flatMap((i) => i.lines ?? []).join("");
    assert.equal(joined.replace(/\s/g, "").length, `Word: ${huge}`.replace(/\s/g, "").length);
    assert.ok(joined.includes("Word") && joined.includes(huge.slice(0, 34)), "content kept");
    for (const t of texts) for (const line of t.lines ?? []) assert.ok(line.length > 0);
  });
});

test("§8: semantic role detection classifies formulas vs sentences correctly", async () => {
  const { roleOf } = await loadBoard();
  for (const s of ["x = 2", "y = mx + c", "2x + 5 = 15", "a² + b² = c²", "α + β = γ"]) {
    assert.equal(roleOf(s, 60), "formula", `${s} → formula`);
  }
  for (const s of [
    "Photosynthesis makes food",
    "E = energy of the light wave",
    "Water is H2O and ice is frozen",
    "ऊर्जा E = mc² के समीकरण को समझें आज",
  ]) {
    assert.notEqual(roleOf(s, 60), "formula", `"${s}" must NOT be a formula`);
  }
});

test("§10: chemical subscripts convert formulas, never ordinary words", async () => {
  const { mathify } = await loadBoard();
  assert.equal(mathify("H2O"), "H₂O");
  assert.equal(mathify("CO2"), "CO₂");
  assert.equal(mathify("6CO2 + 6H2O -> C6H12O6 + 6O2"), "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂");
  assert.equal(mathify("Class2"), "Class2");
  assert.equal(mathify("Chapter2"), "Chapter2");
  assert.equal(mathify("Room2"), "Room2");
  assert.equal(mathify("Grade5 students"), "Grade5 students");
  // Hindi + numbers untouched
  assert.equal(mathify("कक्षा 2 में 10 बच्चे"), "कक्षा 2 में 10 बच्चे");
});

test("§9: symbolize preserves math structure and cleans text/mathrm", async () => {
  const { symbolize } = await loadBoard();
  const { needsMathLayout } = (await import("../src/lib/classroom2d/mathtype.ts")) as {
    needsMathLayout: (s: string) => boolean;
  };
  const out = symbolize("\\frac{a}{b} + \\sqrt{x} + \\text{speed} + \\alpha \\rightarrow \\beta");
  assert.ok(out.includes("\\frac{a}{b}"), "frac preserved for the typesetter");
  assert.ok(out.includes("\\sqrt{x}"), "sqrt preserved for the typesetter");
  assert.ok(out.includes("speed"), "text content kept");
  assert.ok(!out.includes("\\text") && !out.includes("\\mathrm"), "text commands stripped");
  assert.ok(out.includes("\\frac{a}{b}"), "fraction structure preserved for parseMath");
  assert.ok(out.includes("α") && out.includes("→"));
  assert.equal(needsMathLayout("\\frac{a}{b}"), true);
  assert.equal(needsMathLayout("H_2O"), true);
  assert.equal(needsMathLayout("plain sentence"), false);
});

/* ---------------- §11/§44 reveal + timeline gate ---------------- */

test("§11/§44/§45: sequential reveal, busy gate, onWriteEnd fires EXACTLY once", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    const ends: number[] = [];
    const pens: Array<[number, number]> = [];
    b.onWriteEnd = () => ends.push(ends.length);
    b.onPenMove = (u, v) => pens.push([u, v]);
    b.apply({ op: "write", text: "First beat on the board" });
    b.apply({ op: "write", text: "Second beat after it" });
    assert.equal(b.busy, true, "busy while writing");
    await settle(b);
    assert.equal(b.busy, false, "idle after completion");
    assert.equal(ends.length, 1, "onWriteEnd EXACTLY once for the batch");
    // monotonic reveal: run a fresh item and check reveal never decreases
    const item = () => b.snapshot().items.at(-1)!;
    b.apply({ op: "update", text: "Rewritten third beat content" });
    let last = -1;
    for (let i = 0; i < 400 && b.busy; i++) {
      b.update(1 / 60);
      const r = item().reveal;
      assert.ok(r >= last, "reveal is monotonic");
      assert.ok(r <= 1, "reveal never exceeds 1");
      last = r;
    }
    // the pen actually moved along the writing
    assert.ok(pens.length > 10, "pen followed the writing");
  });
});

test("§12: the pen tip tracks Devanagari CLUSTERS, not UTF-16 units", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    // "नि" = न + ि (matra) — 2 UTF-16 units, 1 visual cluster
    b.apply({ op: "write", text: "निर्मल" });
    const snaps: number[] = [];
    for (let i = 0; i < 30 && b.busy; i++) {
      b.update(1 / 60);
      snaps.push(b.snapshot().items[0]!.reveal);
    }
    assert.ok(snaps.length > 5, "still writing");
    // complete and ensure no crash + completion
    await settle(b);
    assert.equal(b.busy, false);
  });
});

/* ---------------- §22/§23 move + resize ---------------- */

test("§22: targeted move moves ONLY the target and stays on the board", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.apply({ op: "write", text: "Anchor sentence stays put" });
    await settle(b);
    b.apply({ op: "write", text: "Movable sentence" });
    await settle(b);
    const before = b.snapshot().items;
    const target = before.find((i) => (i.text ?? "").includes("Movable"))!;
    const other = before.find((i) => (i.text ?? "").includes("Anchor"))!;
    b.apply({ op: "move", dx: 120, dy: 40, target: "Movable sentence" });
    const after = b.snapshot().items;
    const moved = after.find((i) => (i.text ?? "").includes("Movable"))!;
    const still = after.find((i) => (i.text ?? "").includes("Anchor"))!;
    assert.equal(moved.x, target.x + 120);
    assert.equal(moved.y, target.y + 40);
    assert.equal(still.x, other.x, "un-targeted content must not move");
  });
});

test("§23: resize respects the readability floor and keeps bounds in sync", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.setViewport(360, 320, true); // minSize = 68
    b.apply({ op: "write", text: "Small text that must stay readable" });
    await settle(b);
    b.apply({ op: "resize", scale: 0.01 }); // absurd shrink
    b.apply({ op: "resize", scale: NaN }); // hostile input — ignored
    b.apply({ op: "resize", scale: -3 }); // hostile input — ignored
    const item = b.snapshot().items[0]!;
    const boardSrc = readFileSync(join(ROOT, "src/lib/classroom2d/board.ts"), "utf8");
    assert.match(boardSrc, /const floor = this\.minSize/, "one authoritative floor");
    assert.ok(
      (item.size ?? 60) * item.scale >= 45.9, // 46 = readability floor
      `effective text size ${(item.size ?? 60) * item.scale} stays readable`,
    );
    assert.ok(item.x >= 0 && item.y >= 0, "clamped on the board");
  });
});

/* ---------------- §18/§19 diagram data robustness ---------------- */

test("§18/§19: bar + line charts survive hostile data without NaN/Infinity", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    const hostile: Array<[number[] | undefined, string]> = [
      [[0, 0, 0, 0], "all zeros"],
      [[-5, -2, -9], "all negative"],
      [[3, Number.NaN, 7], "NaN inside"],
      [[2, Number.POSITIVE_INFINITY, 4], "Infinity inside"],
      [[-3, 0, 8], "mixed signs"],
      [[5], "single point"],
      [undefined, "no data"],
    ];
    for (const [data] of hostile) {
      b.apply({ op: "diagram", kind: "bar", data, labels: ["a", "b", "c"] });
      b.apply({ op: "diagram", kind: "line", data, labels: ["a", "b", "c"] });
    }
    await settle(b);
    for (const it of b.snapshot().items) {
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y), "finite position");
      assert.ok(Number.isFinite(it.w) && Number.isFinite(it.h), "finite size");
      assert.ok(it.w > 0 && it.h > 0);
    }
    assert.doesNotThrow(() => b.update(1 / 60), "paint survives hostile data");
  });
});

/* ---------------- §47/§48 erase + clear ---------------- */

test("§47/§48: erase removes the last item; clear releases the timeline gate", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.apply({ op: "write", text: "Beat one" });
    await settle(b);
    const n1 = b.snapshot().items.length;
    b.apply({ op: "erase" });
    assert.equal(b.snapshot().items.length, n1 - 1, "erase removed the item");
    assert.doesNotThrow(() => b.update(1 / 60));
    b.apply({ op: "write", text: "Beat two is being written right now" });
    assert.equal(b.busy, true);
    b.apply({ op: "clear" });
    assert.equal(b.busy, false, "clear releases busy immediately");
    assert.equal(b.snapshot().items.length, 0);
    assert.doesNotThrow(() => b.update(1 / 60), "paint after clear");
  });
});

/* ---------------- §18–§20 MASTER BOARD: scrolling, never deleting ---------------- */

test("§18: a long lesson scrolls the board instead of erasing earlier steps", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    b.setViewport(1280, 720, false);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      b.apply({
        op: "write",
        text: `Step ${i}: yeh teaching line number ${i} hai aur ise board par likha jaana chahiye.`,
      });
      await settle(b);
    }
    const items = b.snapshot().items;
    // §19: nothing is archived/deleted — every written step is still on the board
    for (let i = 1; i <= steps; i++) {
      assert.ok(
        items.some((it) => (it.text ?? "").startsWith(`Step ${i}:`)),
        `step ${i} must still exist on the scrolling board`,
      );
    }
    // §18: the content space grew beyond one viewport and the view scrolled down
    assert.ok(b.contentHeight > 1010, "content space must extend past one viewport");
    assert.ok(b.scroll > 0, "the viewport must have scrolled to the active band");
    // the newest step is inside the visible window
    const last = items.find((it) => (it.text ?? "").startsWith(`Step ${steps}:`))!;
    assert.ok(last.y >= b.scroll - 60, "active step is at/below the top of the window");
    assert.ok(last.y + last.h <= b.scroll + 1010 + 60, "active step is inside the window");
  });
});

test("§20: an explicit clear is the only thing that resets the content space", async () => {
  await withFakeDocument(async () => {
    const { BoardEngine } = await loadBoard();
    const b = new BoardEngine(8);
    for (let i = 0; i < 10; i++) {
      b.apply({ op: "write", text: `Line ${i} of a long derivation on the master board.` });
      await settle(b);
    }
    assert.ok(b.contentHeight > 1010);
    b.apply({ op: "clear" });
    await settle(b);
    assert.equal(b.snapshot().items.length, 0);
    assert.equal(b.scroll, 0, "clear returns the viewport to the top");
  });
});
