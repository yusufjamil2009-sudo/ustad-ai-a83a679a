/** Registers the local test model as a guest's provider, via the real crypto path. */
import pg from "pg";
const { encryptConfig } = await import("../src/lib/crypto.server.ts");
const db = new pg.Pool({ host: "/tmp", port: 55432, user: "postgres", database: "ustad" });
const guestId = process.argv[2];
if (!guestId) throw new Error("usage: provision-model.mjs <guestId>");
const cfg = await encryptConfig({ api_key: "local-test", base_url: "http://127.0.0.1:8788/v1" });
await db.query(
  `insert into api_configs (guest_id, provider, config, models, healthy, status)
   values ($1,'openai',$2,$3,true,'ok')
   on conflict (guest_id, provider) do update set config=excluded.config, models=excluded.models, healthy=true, status='ok'`,
  [guestId, JSON.stringify(cfg), JSON.stringify(["mock-quiz-model"])],
);
console.log("model provisioned for", guestId);
await db.end();
