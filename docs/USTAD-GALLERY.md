# USTAD GALLERY — Multi-Image Upload + Optimization + Public Share URLs

A private, per-guest image gallery inside **Settings → USTAD Gallery** with
one-link public sharing. Built entirely on the existing USTAD AI architecture:
the browser Guest ID system, HMAC ownership (`requireGuest`), the Supabase
admin client, private storage buckets, TanStack server functions and the
Settings tab design — **no new auth, no new database, no second app**.

## Feature summary

- **Multi-image upload** from the native device picker (JPG/JPEG/PNG/WEBP/GIF,
  HEIC/HEIF/AVIF where the browser can decode, BMP). Non-images are rejected
  client-side (MIME + decodability) and re-validated server-side (MIME + magic
  bytes + 8 MB limit).
- **Real image optimization** in the browser before upload: oversized images
  are downscaled preserving aspect ratio (never upscaled, never stretched,
  never cropped) and re-encoded to WebP at q0.85 with metadata stripped. Small
  images pass through at original resolution. Animated GIFs are kept as-is so
  animation is never lost. No CSS/blur/sharpen fakery — the stored asset *is*
  the optimized image.
- **Progress, never a frozen UI**: `Uploading N images… x / N` with per-file
  status chips. One failed file never fails the batch; a duplicate batch can
  never start while one is running.
- **Original device images are never touched.** Delete removes only the
  Gallery storage object + DB row, after an explicit server-confirmed dialog.
- **Responsive lazy-loaded grid**: 2 columns on phones, 3 on tablets, 4 on
  desktop, rounded corners matching the app, no horizontal scrolling.
- **Multi-select + action bar**: Generate URL / Download / Delete / Cancel with
  a clear selected state (`aria-pressed`), keyboard operable.
- **One URL per selection** — never N URLs:
  - *Generate All Images URL* → one URL for every gallery image at that moment.
  - *Generate URL* → one URL for exactly the selected image IDs.
  - Same selection regenerated → **the same URL** (idempotent, signature-based).
- **Real working public page** at `/gallery/share/<token>` — no auth needed.
  Visitors can view, multi-select, download single images, download a real ZIP
  (`USTAD-Gallery.zip`, deflate via the browser's `CompressionStream`), and
  Share via Web Share API with Copy-Link fallback.
- **Shares reference live assets**: deleting a Gallery image removes it from
  every active share automatically (share items join live rows; no orphaned
  storage, no stale fake URLs).

## Security

- The gallery is private and owner-only: every owner operation goes through
  `requireGuest` (HMAC-verified token) and every query is filtered by the
  verified `guest_id`.
- Share tokens are unpredictable: 18 CSPRNG bytes → base64url `g_…` (144 bits).
  Never a sequential id, guest id, filename or timestamp.
- The public page resolves data **only** from the share token, server-side,
  and returns only that share's images — never the owner's private gallery,
  never guest ids, never storage refs, never secrets.
- There is **no arbitrary-path download endpoint**: the server returns only
  per-share signed URLs (TTL 1 h), refreshed on every list/public load.
- Gallery tables have owner-scoped RLS and the `ustad-gallery` storage bucket
  is private with owner-only object policies. The service-role key exists only
  server-side; nothing secret ships to the frontend.
- Invalid/expired/unknown share tokens render a clean **“Gallery not found”**
  page — no DB errors are exposed.

## Database / storage

Migration: [`supabase/gallery.sql`](../supabase/gallery.sql)

- `gallery_images` — id, guest_id, storage_path (`storage:<guest>/<id>`),
  mime, file_size, width, height, original_name, optimized, created_at.
- `gallery_shares` — id, guest_id, share_token (unique), signature
  (sorted-deduped image ids — enables idempotent URL reuse), title, created_at.
- `gallery_share_items` — share_id, image_id (join table; live assets).
- RLS: owner-only on gallery tables; private `ustad-gallery` bucket with
  owner-only object policies (mirrors the existing `ustad-attachments` pattern
  in `src/lib/data.server.ts`).

## Architecture (mirrors existing patterns)

| Concern | File |
| --- | --- |
| Shared pure helpers (validation, `fitWithin`, signature, tokens) | `src/lib/gallery-utils.ts` |
| Server ops (owner + public) | `src/lib/gallery.server.ts` |
| Browser helpers (optimize, ZIP, download, share/copy) | `src/lib/gallery-client.ts` |
| Server functions (createServerFn) | `src/lib/ustad.functions.ts` |
| Client wrappers (token recovery / public unwrapped) | `src/lib/ustad-api.ts` |
| Owner UI (Settings tab) | `src/components/GallerySection.tsx` |
| Public share page | `src/routes/gallery.share.$token.tsx` |
| Settings integration | `src/routes/settings.tsx` |
| Unit tests (12) | `tests/gallery.test.ts` |

The upload payload is a base64 data URL (the same transport the existing
attachment server functions use). The server decodes it, re-validates the real
bytes, uploads to the private bucket, inserts the row and returns a DTO with a
fresh signed URL.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` (`eslint .`) — clean (0 errors; 2 pre-existing
  react-refresh warnings in `ui/button.tsx` / `ui/toggle.tsx`).
- `npm test` — **213/213** (192 existing + 21 gallery unit tests).
- `npx vite build` — succeeds.
- **Runtime suite `scripts/runtime-gallery.mjs` — 82/82 checks (two consecutive
  full runs), 0 page errors** against the
  in-memory mock Supabase (`scripts/mock-supabase.mjs`), exercising the real
  production code path end-to-end in headless Chromium:

  1. Settings → USTAD Gallery opens with a clean empty state.
  2. Empty-gallery URL generation shows **“No images available.”**
  3. Non-image files are rejected client-side with a clear error.
  4. Real multi-upload shows `Uploading 5 images… x / 5` progress and the
     Upload button is locked while a batch runs.
  5. PNG/JPEG uploads are stored as WebP (real conversion); GIF passes
     through; small images keep their resolution; a 4000×2000 image is
     downscaled to 2048×1024 (2:1 preserved) and genuinely smaller.
  6. The browser ZIP builder emits a real deflate zip.
  7. Upload 5 → select 1/3/5 → **one URL** → open in an incognito browser →
     **exactly those 3** appear; no guest ids/secrets leak.
  8. On the public page select 1&3 → Download → ZIP contains **only those 2**;
     single download keeps the original filename; Download All zips the share.
  9. Generate All URL → delete image 2 (server-confirmed) → the All URL now
     **omits image 2** (live assets); originals were never stored/modified
     (no jpeg/png objects in storage).
  10. Invalid token → clean “Gallery not found”, no DB error exposed.
  11. Responsive: 360/375/390/412 mobile and 1366/1440/1920 desktop — no
      horizontal overflow; 2 columns mobile, 4 columns desktop.
  12. S1–S14 hardening checks: refresh persistence; delete-many; server-decoded
      BMP dimensions; >8 MB and corrupt/undecodable files rejected with clear
      messages; HEIC gets an honest browser-support message (never uploaded);
      arbitrary ftyp-branded ISO-BMFF files rejected; 13-entry ZIP CRC-verified;
      large ZIP (2 × ~535 KB real PNGs) built through the production streaming
      builder with CRC-verified entries and no UI freeze; fresh signed URLs on
      every public reload; Android (Pixel 7) public page with working ZIP
      download; public page creates **no guest session** and never calls the
      bootstrap; **0 dangling share items** after deletes (cascade enforced);
      oversized-selection guard returns a clear user error instead of crashing.

  Run (requires the dev server pointed at the mock):
  ```bash
  node scripts/mock-supabase.mjs                       # on :8787 — restart per run (in-memory DB)
  SUPABASE_URL=http://127.0.0.1:8787 APP_URL=http://localhost:8080 \
  USTAD_GUEST_SECRET=test-secret USTAD_KEY_ENCRYPTION_SECRET=test-secret \
  SUPABASE_SERVICE_ROLE_KEY=test-key SUPABASE_PUBLISHABLE_KEY=test-key \
  VITE_SUPABASE_URL=http://127.0.0.1:8787 VITE_SUPABASE_PUBLISHABLE_KEY=test-key \
  npm run dev
  node scripts/runtime-gallery.mjs
  ```

  > The mock implements the PostgREST + Storage wire contract faithfully so
  > the real server code runs unmodified. Final DB/storage verification
  > against the live Supabase project happens in the deployed environment
  > (the sandbox cannot hold real credentials); every other layer — UI,
  > optimization, ZIP, signing, share semantics — is exercised for real.

## Node 20 dev note

`@supabase/supabase-js` v2.112 needs a `WebSocket` global (Node 22 has it
natively). For Node 20 dev servers, `src/lib/guest.server.ts` installs the `ws`
implementation via `createRequire` at module load. Production on Node 22+
skips this. A minimal ambient type is in `src/lib/ws-shim.d.ts`.
