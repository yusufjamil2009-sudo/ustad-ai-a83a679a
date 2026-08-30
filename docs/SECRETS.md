# USTAD AI — server secrets: setup & safe rotation

Two server-only secrets drive identity and credential storage:

| Secret | Used by | What breaks if it's wrong |
| --- | --- | --- |
| `USTAD_GUEST_SECRET` | `src/lib/guest.server.ts` — HMAC-SHA256 signature of every guest token | Every guest session becomes invalid ("Invalid guest session. Please reload USTAD AI."); browsers bootstrap a **new** guest id and lose access to their old chats |
| `USTAD_KEY_ENCRYPTION_SECRET` | `src/lib/crypto.server.ts` — AES-GCM key for stored provider API keys | Saved provider credentials can no longer be decrypted and must be re-entered in Settings |

Both support a rotation companion, which is what makes rotation safe:

- `USTAD_GUEST_SECRET_PREVIOUS` — tokens signed with the old secret still verify; the next bootstrap re-issues a token signed with the new one.
- `USTAD_KEY_ENCRYPTION_SECRET_PREVIOUS` — ciphertext written before the rotation still decrypts; anything saved after the rotation uses the new secret.

## Format requirements (enforced at startup)

`src/lib/env-guard.ts` validates on server start and logs a single report:

- set and non-empty, no whitespace (a pasted trailing newline is an error),
- at least **32 characters** (64+ recommended for signing/encryption keys),
- not a placeholder (`changeme`, `secret`, `todo`, …),
- reasonable entropy (warning under 10 distinct characters),
- `*_PREVIOUS`, when present, must satisfy the same rules and differ from the current value.

It also verifies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present, and warns when `LOVABLE_API_KEY` is missing (USTAD Core chat/image/voice fallback disabled).

A failing check logs `USTAD env check FAILED …` to the server log at the first request — check this first when guest sessions or provider keys misbehave.

## Safe rotation procedure (same in dev, staging, production)

1. **Copy the current value into the `_PREVIOUS` slot.**
   `USTAD_GUEST_SECRET_PREVIOUS = <old USTAD_GUEST_SECRET>`
   `USTAD_KEY_ENCRYPTION_SECRET_PREVIOUS = <old USTAD_KEY_ENCRYPTION_SECRET>`
   Skip this only if you accept invalidating all guest sessions / stored provider keys.
2. **Generate the new values** (never invent them by hand):
   ```bash
   openssl rand -hex 32   # 64 characters
   ```
3. **Store the new values** in the environment for the target stage (see below).
4. **Restart / redeploy** so the server picks them up, then check the log for `USTAD env check`.
5. **Verify**: open the app — an existing browser keeps its chats (old token accepted, new token re-issued), and Settings still shows the configured providers.
6. **Close the rotation window** after all users have reconnected (guest tokens live 365 days; a week is normally enough for provider keys): delete both `_PREVIOUS` secrets and redeploy.

### Per stage

- **Local dev** — values live in `.env` (never committed; see `.env.example`). Edit, then restart `bun run dev`.
- **Staging / preview (Lovable Cloud)** — stored as project secrets for the preview environment. Update them in Project Settings → Secrets (or ask the assistant to open the secure form) and let the preview rebuild. Dev and prod each have their own secret store, so rotate them separately.
- **Production** — same flow on the production environment. Rotate staging first, verify guest sessions and Settings there, then production. Never reuse a staging secret in production.
- **Self-hosted** — inject via your platform's secret manager as plain env vars; do not bake them into an image.

## Rules

- These two secrets are **server-only**. Never prefix them with `VITE_`, never reference them in client code.
- Never commit real values; `.env` stays out of git, `.env.example` holds empty placeholders only.
- Rotate immediately if a value was ever printed in a log, pasted in chat, or committed.
- If you rotate `USTAD_KEY_ENCRYPTION_SECRET` **without** the `_PREVIOUS` value, stored provider keys are unreadable — users simply re-enter them in Settings; no other data is lost.
