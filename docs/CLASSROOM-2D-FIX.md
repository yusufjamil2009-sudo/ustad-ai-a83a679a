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

---

## Round 2 — Audio Engine + Lesson Engine: Deep Bug Fix & TRUE Runtime Sync

This round makes synchronization EVENT/STATE-driven instead of estimate-driven.
Nothing new was built: the existing timeline, board, teacher, lesson and voice
controllers were extended in place (no duplicate engines, no 3D, no arbitrary
`setTimeout` gates).

### Speech lifecycle (audio.ts — Bugs #1–#7, #22, #27–#30)
The voice controller now exposes a truthful lifecycle state machine —
`idle → starting → speaking → ended / failed / cancelled / unavailable /
skipped` — that the Master Timeline reads through `getSpeechState()`:

- A beat NEVER advances while speech is `starting`/`speaking` (Test A: voice
  longer than the estimate keeps the phase alive until the sentence really ends).
- `stopSpeak()` fires `onSpeakCancel`, NEVER `onSpeakEnd` (Bug #3/#23/#30):
  pause/mute/autoSpeak-off/new-beat/dispose are interruptions, not completions.
- Speech errors fire `onSpeechError`, never a fake `onSpeakEnd` (Bug #2).
- Monotonic speech request ids: every utterance/provider response/media event
  self-ignores when stale, so old callbacks can never touch a new beat (Bug #4/#26).
- No permanent `speechUnavailable` flag — state resets per request (Bug #5).
- Voices are cached and refreshed on `voiceschanged`; an empty voice list never
  blocks the lesson (Bug #6).
- Deterministic language: Devanagari → Hindi, ≥2 Roman-Hinglish markers →
  Hinglish, else English — never random between beats (Bug #7).
- Start/play stall detection: a request that never produces an audio event is
  reported as stalled (not "completed"); the timeline applies its explicit
  recovery policy (Bugs #27/#28; verified in a real browser: no TTS provider →
  honest `failed` → lesson keeps advancing).
- Mute/autoSpeak-off are the explicit `skipped` policy state — the timeline
  never waits (Bug #22/Test E). Audio readiness (`ready|blocked|unavailable`)
  is exposed for the UI (Bug #29).

### Board authority (Bugs #9/#10/#25/#31/#34)
- The beat never ends while handwriting is progressing: `written =
  !board.busy` unconditionally — the board renderer is the authority, and
  semantic visuals applied by the engine count too (Test B verified live:
  the phase never advanced mid-stroke).
- `board.writingProgress` (0..1) + `board.onOpError` give real board signals;
  ops are serialized through BoardEngine and one failing op can never erase
  previously written content.

### Content-driven doubt branches (lesson.ts — Bugs #12–#17, #19, #20, #33–#37)
- The fixed `duration: 5/6/7/8/4` values are gone — every doubt-branch step
  goes through the single `beat()` estimate factory (Bug #13; unit-tested that
  every duration equals the content estimate and longer content ⇒ longer beats).
- Doubt branches use a monotonic unique stamp — no two branches ever share an
  object id (Bug #15).
- Unknown topics get a clean board explanation and NO unrelated visual; only
  known subjects show their semantic object/diagram (Bug #16).
- Diagram detection is semantic (visual noun + intent), not bare-keyword
  (Bug #17). Math detection reuses the math renderer and covers unicode
  fractions/roots/chemistry (Bug #20).
- `sentences()` protects decimals and abbreviations and never discards content;
  `stripMd()` never destroys math syntax (Bugs #36/#37). `visualType` metadata
  annotates diagram beats without creating a second phase system (Bug #19).

### Natural math speech (speech-normalize.ts — Bug #21)
`1/2 × base × height` is spoken as "one half times base times height";
`H₂O` → "H 2 O"; `6CO2 + 6H2O -> C6H12O6` → "6 CO 2 plus 6 H 2 O gives C 6 H 12 O 6";
superscripts/unicode fractions/operators all become words. Raw LaTeX is never
spoken (existing test re-verified).

### Round-2 verification
- `tsc --noEmit` clean · `eslint` clean · **`npm test` 192/192** (23 new sync tests)
- `vite build` succeeds
- Live browser (`scripts/runtime-deep.mjs`, v3): timeline advances step by step,
  phase never advances mid-handwriting, speech reaches an honest terminal state
  with provider absent, board pixels change, teacher stays large and drawn —
  all PASS. `scripts/runtime-check.mjs` 16/16 PASS with the bigger layout
  (teacher strip now ≈ 666 px tall vs 240 px before; board 53% of frame).

### Real-device matrix (Bug #38) — to run manually where speech is available
Chrome Android / Chrome desktop / Edge / Firefox × English/Hindi/Hinglish ×
short/medium/long answers × simple formula / fraction / power / root /
chemistry × short/long board text × autoSpeak on/off × mute on/off × pause /
resume × doubt during speech / during writing / after speech × refresh/recovery.
