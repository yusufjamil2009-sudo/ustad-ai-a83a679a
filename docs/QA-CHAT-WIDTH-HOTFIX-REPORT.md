# Hotfix — Chat Workspace width breaks after the first message

Bug fix only. Nothing was redesigned, rebuilt or replaced.

---

## 1. Exact root cause

Two separate defects, one hiding the other.

### Defect A (the reported layout bug) — the status line could not shrink

The chat header is a flex row:

```
<div class="flex items-center justify-between gap-2 …">   ← header row
  <div class="flex items-center gap-1"> History | New chat </div>
  <p class="truncate text-xs …"> {status} </p>            ← status line
</div>
```

`truncate` is Tailwind for `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`.
Ellipsis only works if the element is allowed to become narrower than its text —
but **a flex item defaults to `min-width: auto`**, which forbids shrinking below
its own content width. The nowrap text therefore acted as a hard minimum width.

This is why the bug is state-dependent, exactly as reported:

| State | Status text | Intrinsic width | Result |
| --- | --- | --- | --- |
| EMPTY CHAT | `USTAD AI is ready.` | small | fits — layout correct |
| AFTER MESSAGE | `openai · mock-quiz-model · chat` (real: `ustad-core · google/gemini-3.7-flash · chat`) | large | forces the header wider than the viewport |

Because the chat column and the workspace row were also flex items without
`min-width: 0`, that oversized minimum propagated straight up into the app
shell. The whole page grew to a fixed **406px** regardless of the viewport, and
`<main>` stopped ending at the right edge — the blank right-hand strip in the
screenshot.

Measured before the fix (real browser, real message, real AI reply):

```
 320px  before.overflow=8   after.overflow=86  BROKEN
 360px  before.overflow=0   after.overflow=46  BROKEN
 375px  before.overflow=0   after.overflow=31  BROKEN
 390px  before.overflow=0   after.overflow=16  BROKEN   main.right=386 (≠390)
 412px+ ok
```

The constant 406px "widest element" at every viewport is the signature of a
content-driven minimum width, not a percentage or `100vw` miscalculation.

### Defect B (blocker found while reproducing) — the conversation never loaded

While reproducing, the first message never rendered a reply at all. The server
call `listMessagesFn` failed with:

```
object is not iterable (cannot read property Symbol(Symbol.iterator))
```

`messages.attachments` is a `jsonb` column whose **DB default is `'{}'::jsonb`** —
an empty *object*, not an empty array. Every assistant row is written without
attachments and therefore stores `{}`. The code did:

```ts
for (const a of (row.attachments as Array<…>) ?? []) { … }
```

`?? []` only catches `null`/`undefined`; `{}` passes through and is not
iterable, so the entire message list failed to load after the first exchange.
This had to be fixed to reach the reported UI state at all.

---

## 2. Exact files / components responsible

| File | Component | Role |
| --- | --- | --- |
| `src/routes/index.tsx` | `ChatPage` | Header row, status line, chat column, workspace row |
| `src/lib/data.server.ts` | `listMessages()` | Defect B — attachments jsonb shape |

`src/components/AppShell.tsx` was **not** modified — the shell was already
correct (`min-w-0` on the nav, `w-full min-w-0` on `<main>`). The child was the
one violating the contract.

---

## 3. Exact CSS/class/state causing the width change

`class="truncate …"` (i.e. `white-space: nowrap`) on the status `<p>`, combined
with the implicit `min-width: auto` of a flex item, triggered only once
`status` changed from the short idle string to the long
`provider · model · intent` string after a successful send.

---

## 4. Minimal change made

Three Tailwind utility classes and one explanatory comment in `index.tsx`, plus
one defensive helper in `data.server.ts`. Total: **12 insertions, 4 deletions**.

```diff
-      <div className="flex min-h-0 flex-1">                        // workspace row
+      <div className="flex min-h-0 min-w-0 flex-1">

-        <div className="relative flex min-h-0 flex-1 flex-col">    // chat column
+        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">

-            <div className="flex items-center gap-1">              // History / New chat
+            <div className="flex shrink-0 items-center gap-1">

-            <p className="truncate text-xs text-muted-foreground">  // status line
+            <p className="min-w-0 truncate text-xs text-muted-foreground">
```

And in `listMessages()`:

```ts
function attachmentsOf(row: { attachments?: unknown }) {
  const value = row.attachments;
  return Array.isArray(value) ? value : [];   // '{}'::jsonb decodes to {}, not []
}
```

No global `overflow-x: hidden`, no hardcoded widths, no `691px`, no negative
margins, no transforms, no clipping band-aid.

---

## 5. Why the fix works

`min-w-0` removes the `min-width: auto` floor from the flex items, so the status
line may finally shrink below its text width — which is precisely what makes
`truncate` render an ellipsis instead of overflowing. `shrink-0` on the
History/New chat group states explicitly that the buttons keep their intrinsic
size, so the flexible status line absorbs the shrinking rather than the buttons
being squashed.

Applying `min-w-0` to the chat column and the workspace row enforces the
architectural rule requested: conversation content can no longer dictate the
width of the application shell. The shell sizes the row; the content fits inside
it. This is the existing responsive architecture used correctly, not a second
system — `AppShell` already relied on the same pattern.

---

## 6. Runtime tests performed

Real Chromium against the real running app, real guest, real AI replies. No mock
data, no stubbed responses.

**Width matrix — before vs after a real message + real AI reply**
(`scripts/repro-chat-width.mjs`):

```
 320px  before.overflow=0  after.overflow=0  ok
 360px  before.overflow=0  after.overflow=0  ok
 375px  before.overflow=0  after.overflow=0  ok
 390px  before.overflow=0  after.overflow=0  ok
 412px  before.overflow=0  after.overflow=0  ok
 430px  before.overflow=0  after.overflow=0  ok
 480px  before.overflow=0  after.overflow=0  ok
 540px  before.overflow=0  after.overflow=0  ok
 691px  before.overflow=0  after.overflow=0  ok
```

(The 320px case additionally fixed a pre-existing `overflow=8` in the empty state.)

**The exact 15-step acceptance scenario** (`scripts/check-chat-width-fix.mjs`) —
**22 passed, 0 failed**:

| Check | Result |
| --- | --- |
| C-01…03 empty chat: rail full width, main full width, no overflow | PASS |
| C-04 the AI reply actually arrives | PASS |
| C-05…08 after message: rail full width, main full width, main ends at the right edge, no overflow | PASS |
| C-09 layout identical before and after | PASS |
| C-10 provider/model status contained (right=378 of 390) | PASS |
| C-11 History / New chat row contained | PASS |
| C-12/13 user message and AI reply both render | PASS |
| C-14 composer contained | PASS |
| C-15 New chat returns to the empty layout | PASS |
| C-16 bug does not return on the second message | PASS |
| C-17 very long message does not break the width | PASS |
| C-18 very long provider/model name does not break the width | PASS |
| C-19 tablet 820 / desktop 1440 / wide 1920 unaffected | PASS |
| C-20 no uncaught page errors | PASS |

**Regression:** `npm test` 368/368 PASS · Part 7 browser 29/29 PASS ·
`tsc --noEmit` clean · ESLint clean on both changed files.

Two suites report one failure each — **both pre-existing**, verified by stashing
my changes and re-running against the original code, where they fail identically:

- `check-part8.mjs` — `P8-REG profile` (Trophy cabinet panel not rendered for
  that test guest): 58 passed, 1 failed, with and without my changes.
- `check-part9.mjs` — a `notification-bell` click timeout at a narrow viewport,
  the same flake noted in the Part 7 hotfix report: fails identically on the
  original code.

Neither touches the chat route.

---

## 7. Confirmation — nothing rebuilt or removed

Not created, not replaced, not redesigned: the Chat Workspace, the chat engine,
the conversation system, the header, Chat/Study navigation, History, New Chat,
the AI Router, model/provider selection, message cards, the composer,
attachment controls, the microphone button, the send button, the footer.

No colours, spacing, radii, shadows, icons or typography were changed. No
functionality was removed, no API replaced, no mock data introduced, no second
responsive system or mobile-only duplicate added. The visible design is
byte-for-byte the same; only three layout utility classes and one server-side
data-shape guard changed.
