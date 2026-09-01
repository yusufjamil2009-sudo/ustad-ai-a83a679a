# 2D Classroom — Complete Fix + Upgrade (runtime verified)

This document maps every fix/upgrade to the 58-section specification. The existing
2D Classroom was **modified in place** — no duplicate classroom, timeline, lesson,
board, voice or teacher engine was created, and 3D was **not** reintroduced.

## What was wrong and what was fixed

### Composition (sections 1–4, 8, 46, 50)
- **Root cause:** the old stage put a small teacher overlapping the bottom-left of
  the board; board and teacher were both too small and the teacher covered content.
- **Fix:** `stage.ts` now composes a large board across the top (≈58–60% of the
  frame) and a full-width teaching strip below it with **zero overlap**. Portrait
  (9:16) gets a board in the upper/main area and a compact-but-visible teacher
  below. The stage itself got taller (`56vh→72vh→76vh`, `max-w-7xl`).
- The teacher figure is drawn at ≈94% of the strip height and slides along the
  full width to follow the pen, so it stays large and readable while writing.

### Realistic teacher writing (sections 5–7, 38, 43)
- **Root cause:** the old arm animation was disconnected from the board pen.
- **Fix:** `teacher2d.ts` now solves a 2-bone IK so the hand lands **exactly on
  the live pen tip** (stage rect → canvas-space IK), and the figure tracks the pen
  horizontally while writing. The hand visibly holds the correct tool per board:
  **chalk** (chalkboard/blackboard), **marker** (whiteboard), **stylus** (digital).
- Teacher states extended: idle, stand, walk, sit, point, write, explain, wave,
  **highlight, question, emphasize, answer** — all driven by the existing timeline.

### Step-by-step writing, board doc + scrolling (sections 9–11, 20, 23, 47)
- Board content is a persistent structured document; the viewport only shows a
  window of it. Content is never deleted by scrolling (§9/§10).
- `followItem` auto-follows new writing, but **respects manual scroll**: after the
  user drags/wheels/slides up, auto-follow backs off for 8 s unless the viewport is
  already near the bottom (§10).
- Timeline beats reveal text/diagrams progressively (verified: board pixels change
  as the lesson runs; steps advance 1 at a time).
- Board action pipeline now supports `scroll` and `clear_section` in addition to
  WRITE / DRAW / FORMULA / DIAGRAM / UNDERLINE / HIGHLIGHT / CIRCLE / ARROW /
  ERASE / MOVE / RESIZE / CLEAR (§23).

### Voice system (sections 13–18, 39–41, 52)
- **Root cause:** the classroom used browser TTS as the only voice and could cut
  off when beats advanced early (fixed duration gates).
- **Fix:** `audio.ts` is now a provider-first authoritative voice controller that
  uses the **existing API Manager config** through the existing server router:
  **ElevenLabs → Deepgram → OpenAI**, each tried in order with graceful fallback
  (`voice.server.ts`). Browser TTS is used **only** when no provider is configured
  or every provider failed — never as the primary voice.
- Speech is token-guarded: React rerenders, board updates, teacher animation,
  diagram rendering and scrolling can never start/duplicate/cut speech (§13/§14).
- Timeline gate: a beat never advances while the voice controller has a pending
  request (`isSpeechPending`), and the stuck-speech safety respects it — no
  mid-sentence cut-off, no premature step change (§21/§40). Pause→Play resumes the
  current sentence.
- All SFX are silent by design — no metallic/step-change sounds (§18), no
  ambience; the teacher voice is the only classroom audio (§17).

### Board types + writing tool (sections 42–43)
- Added a fourth theme: **digital board** (navy smart-board with grid + neon ink).
- Switching board type only repaints the surface — **content is never erased, the
  timeline is never restarted**; the teacher's writing tool follows the theme.

### Language (sections 28–33)
- English / Hindi / Hinglish propagate to **voice content, board text, diagram
  labels and explanations** (lesson content is built per-language; verified by
  unit tests). Language change does not reload the lesson.

### Diagrams, math, annotations (sections 24–27, 34–37)
- Real educational diagrams are drawn structurally (plant, cell, heart, DNA, atom,
  molecule, circuit, forces, triangle, cycle, bars, pyramid, earth, sun, lab,
  solid, number-line, photosynthesis, generic) — never text placeholders; labels
  point at the actual components and are language-aware; the layout engine places
  everything with bounding-box collision checks (no overlap).
- Fractions/roots/powers/subscripts are typeset and written progressively
  (`mathtype.ts`); raw LaTeX is never shown. Underline/highlight/circle are real
  visual annotations on the target item.

### Reliability & verification (sections 47–57)
- Board state survives rerenders/theme/scroll (items list + snapshot); one failing
  board op or animation never crashes the lesson (ops wrapped, content preserved).
- `tsc --noEmit` clean · `npm test` **169/169** (13 new tests) · `eslint` clean ·
  production `vite build` succeeds.
- Browser runtime verification (Playwright) — all pass:
  - stage mounts, board canvas + teacher canvas present
  - board = 58% of the frame; teacher strip 240 px; **no overlap**
  - lesson starts (21 steps), timeline advances 1 step at a time
  - chalk / white / black / digital theme switches
  - 16:9 / 9:16 / Auto — no overlap in any framing
  - board scroll slider responds; board pixels change over time (progressive
    writing); teacher figure is drawn throughout.

Run the checks yourself:
```sh
npm run dev            # then open http://localhost:8080/classroom
node scripts/runtime-check.mjs   # 16 browser checks (Playwright)
node scripts/runtime-deep.mjs    # deep pixel/behaviour checks
```
