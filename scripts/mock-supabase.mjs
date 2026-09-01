/**
 * MOCK SUPABASE — in-memory PostgREST + Storage double for the runtime
 * verification suite. Implements the exact wire contract that
 * @supabase/supabase-js (postgrest-js + storage-js) speaks, so the REAL
 * production server code (gallery.server.ts, data.server.ts, guest.server.ts)
 * runs unmodified against it. No app code is changed for testing.
 *
 * Supports:
 *  - /rest/v1/{table}: select (eq/neq/gt/gte/lt/lte/in/is), order, limit,
 *    insert/upsert (merge/ignore, on_conflict), patch, delete,
 *    Prefer: return=representation, count=exact, Accept vnd.pgrst.object+json
 *  - /storage/v1/bucket, /object/{bucket}/{path} (upload, signed url,
 *    signed-url GET serving, remove)
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env["MOCK_SUPABASE_PORT"] ?? 8787);

/* ------------------------------- tables ------------------------------- */
/** @type {Record<string, any[]>} */
const tables = {};
function rows(table) {
  if (!(table in tables)) tables[table] = [];
  return tables[table];
}

/** @type {Record<string, {bytes: Uint8Array, contentType: string}>} */
const objects = {};
/** @type {Record<string, string>} token -> storage path (signed URL tokens) */
const signTokens = {};
const buckets = new Set();

/* --------------------------- query parsing ---------------------------- */
function parseFilters(url) {
  const filters = [];
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    // PostgREST: ?column=op.value  or  ?column=op.(v1,v2,...)  or  ?column=is.null
    // The COLUMN is the query key; the value is "<op>.<rest>".
    const v = value ?? "";
    const paren = /^([a-z]+)\.\((.*)\)$/.exec(v);
    if (paren) {
      filters.push({ col: key, op: paren[1], val: paren[2] });
      continue;
    }
    const dot = /^([a-z]+)\.(.*)$/.exec(v);
    if (dot) {
      filters.push({ col: key, op: dot[1], val: dot[2] });
    }
  }
  return filters;
}

function matchesFilter(row, { col, op, val }) {
  const v = row[col];
  switch (op) {
    case "eq":
      return String(v) === val;
    case "neq":
      return String(v) !== val;
    case "gt":
      return v != null && v > val;
    case "gte":
      return v != null && v >= val;
    case "lt":
      return v != null && v < val;
    case "lte":
      return v != null && v <= val;
    case "in": {
      const list = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return list.includes(String(v));
    }
    case "is":
      if (val === "null") return v == null;
      if (val === "true") return v === true;
      if (val === "false") return v === false;
      return true;
    default:
      return true;
  }
}

function applyQuery(rows, url) {
  let out = rows.slice();
  for (const f of parseFilters(url)) out = out.filter((r) => matchesFilter(r, f));
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const limit = url.searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  const offset = url.searchParams.get("offset");
  if (offset) out = out.slice(Number(offset));
  return out;
}

function project(row, select) {
  if (!select || select === "*") return { ...row };
  const cols = select
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const out = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

const objectAccept = (req) =>
  (req.headers["accept"] ?? "").includes("application/vnd.pgrst.object+json");

function prefer(req) {
  return req.headers["prefer"] ?? "";
}
const preferHas = (req, token) =>
  prefer(req)
    .split(",")
    .map((s) => s.trim())
    .includes(token);

function sendJson(res, status, body, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": buf.length,
    ...headers,
  });
  res.end(buf);
}

const PGRST116 = {
  code: "PGRST116",
  details: "The result contains 0 rows",
  hint: null,
  message: "JSON object requested, multiple (or no) rows returned",
};

/* ------------------------------ REST core ------------------------------ */
async function handleRest(req, res, pathname, url) {
  const table = decodeURIComponent(pathname.slice("/rest/v1/".length).replace(/\/$/, ""));
  if (!table) return sendJson(res, 404, { message: "Not found" });
  const r = rows(table);

  if (req.method === "GET") {
    let out = applyQuery(r, url).map((row) => project(row, url.searchParams.get("select")));
    const countExact = prefer(req).includes("count=exact");
    if (objectAccept(req)) {
      if (out.length === 1) return sendJson(res, 200, out[0]);
      return sendJson(res, 406, PGRST116);
    }
    const headers = countExact
      ? { "content-range": `0-${Math.max(out.length - 1, 0)}/${r.length}` }
      : {};
    return sendJson(res, 200, out, headers);
  }

  const body = await readJson(req);
  const withRepresentation = preferHas(req, "return=representation");

  if (req.method === "POST") {
    const isUpsert = prefer(req).includes("resolution=");
    const onConflictRaw =
      url.searchParams.get("on_conflict") ??
      prefer(req)
        .split(",")
        .map((s) => s.trim())
        .find((s) => s.startsWith("on_conflict="))
        ?.split("=")[1];
    const onConflict = onConflictRaw
      ? onConflictRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["id"];
    const merge = prefer(req).includes("resolution=merge-duplicates");
    const incoming = Array.isArray(body) ? body : [body];
    const inserted = [];
    for (const row of incoming) {
      // Postgres-style: tables with an `id` column default it to a uuid.
      const fresh = { ...row };
      if (fresh.id === undefined) fresh.id = randomUUID();
      // Conflict detection: a MISSING on-conflict value never matches an
      // existing row (Postgres semantics — a NULL key is not equal to NULL).
      const dup = onConflict.length
        ? r.find((x) =>
            onConflict.every((c) => {
              const a = x[c];
              const b = fresh[c];
              if (a === undefined || b === undefined) return false;
              return String(a) === String(b);
            }),
          )
        : undefined;
      if (dup) {
        if (merge) Object.assign(dup, fresh);
        inserted.push(dup);
      } else {
        if (fresh.created_at === undefined) fresh.created_at = new Date().toISOString();
        if (fresh.updated_at === undefined) fresh.updated_at = fresh.created_at;
        r.push(fresh);
        inserted.push(fresh);
      }
    }
    if (objectAccept(req)) {
      if (inserted.length !== 1) return sendJson(res, 406, PGRST116);
      return sendJson(res, 201, inserted[0]);
    }
    if (withRepresentation) return sendJson(res, 201, inserted);
    return sendJson(res, 201, []);
  }

  if (req.method === "PATCH") {
    const target = r.filter((x) => parseFilters(url).every((f) => matchesFilter(x, f)));
    for (const x of target) {
      Object.assign(x, body);
      x.updated_at = new Date().toISOString();
    }
    if (objectAccept(req)) {
      if (target.length !== 1) return sendJson(res, 406, PGRST116);
      return sendJson(res, 200, target[0]);
    }
    if (withRepresentation) return sendJson(res, 200, target);
    return sendJson(res, 200, []);
  }

  if (req.method === "DELETE") {
    const target = r.filter((x) => parseFilters(url).every((f) => matchesFilter(x, f)));
    const deleted = target.slice();
    for (const x of target) {
      const i = r.indexOf(x);
      if (i >= 0) r.splice(i, 1);
    }
    // Mirror the real DB: gallery_share_items.image_id → gallery_images(id)
    // ON DELETE CASCADE. Deleting a gallery image removes its share links,
    // so a deleted image can never stay reachable through an active share.
    if (table === "gallery_images" && deleted.length > 0) {
      const gone = new Set(deleted.map((x) => x.id));
      const items = tables["gallery_share_items"] ?? [];
      for (let i = items.length - 1; i >= 0; i--) {
        if (gone.has(items[i].image_id)) items.splice(i, 1);
      }
    }
    if (objectAccept(req)) {
      if (deleted.length !== 1) return sendJson(res, 406, PGRST116);
      return sendJson(res, 200, deleted[0]);
    }
    if (withRepresentation) return sendJson(res, 200, deleted);
    return sendJson(res, 200, []);
  }

  return sendJson(res, 405, { message: "Method not allowed" });
}

/* ----------------------------- storage API ----------------------------- */
function parseBoundary(contentType = "") {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/** Parse a multipart/form-data body; returns { fields, file, fileName, contentType }. */
function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buf.indexOf(delim);
  while (start >= 0) {
    const next = buf.indexOf(delim, start + delim.length);
    if (next < 0) break;
    parts.push(buf.subarray(start + delim.length, next));
    start = next;
  }
  const result = { fields: {}, file: null, fileName: "", contentType: "" };
  for (const part of parts) {
    // strip leading CRLF
    let p = part;
    if (p[0] === 13) p = p.subarray(2);
    const headerEnd = p.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = p.subarray(0, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;
    // strip trailing CRLF before boundary
    let body = p.subarray(bodyStart);
    if (body[body.length - 1] === 10) body = body.subarray(0, body.length - 1);
    if (body[body.length - 1] === 13) body = body.subarray(0, body.length - 1);
    const disp = /name="([^"]*)"/.exec(headerText);
    const name = disp?.[1] ?? "";
    const filename = /filename="([^"]*)"/.exec(headerText)?.[1] ?? "";
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? "";
    if (filename) {
      result.file = body;
      result.fileName = filename;
      result.contentType = ctype;
    } else {
      result.fields[name] = body.toString("utf8");
    }
  }
  return result;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

async function handleStorage(req, res, pathname, url) {
  const base = "/storage/v1";
  const rel = pathname.slice(base.length);
  const segs = rel.split("/").filter(Boolean);

  // bucket admin
  if (segs[0] === "bucket" && req.method === "GET") {
    return sendJson(
      res,
      200,
      [...buckets].map((name) => ({ name, public: false, file_size_limit: 8 * 1024 * 1024 })),
    );
  }
  if (segs[0] === "bucket" && req.method === "POST") {
    const body = await readJson(req);
    if (buckets.has(body.name)) {
      return sendJson(res, 400, { error: `Bucket already exists: ${body.name}` });
    }
    buckets.add(body.name);
    return sendJson(res, 200, { name: body.name, public: !!body.public });
  }

  // signed-url creation: POST /object/sign/{bucket}/{path...}
  if (segs[0] === "object" && segs[1] === "sign" && req.method === "POST") {
    const bucket = segs[2];
    const path = segs.slice(3).join("/");
    const token = randomUUID().replace(/-/g, "");
    signTokens[token] = `${bucket}/${path}`;
    // storage-js prepends its base URL (…/storage/v1), so the path must be
    // relative to that base — exactly like the real Storage API returns.
    const signed = `/object/sign/${bucket}/${path}?token=${token}`;
    return sendJson(res, 200, { signedURL: signed });
  }

  // signed-url GET serving: GET /object/sign/{bucket}/{path}?token=
  if (segs[0] === "object" && segs[1] === "sign" && req.method === "GET") {
    const bucket = segs[2];
    const path = segs.slice(3).join("/");
    const token = url.searchParams.get("token");
    const key = `${bucket}/${path}`;
    const obj = objects[key];
    if (!token || signTokens[token] !== key || !obj) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Object not found" }));
    }
    res.writeHead(200, {
      "content-type": obj.contentType,
      "content-length": obj.bytes.length,
      "content-disposition": "inline",
    });
    return res.end(Buffer.from(obj.bytes));
  }

  // upload: POST /object/{bucket}/{path...} (multipart) or raw bytes
  if (segs[0] === "object" && req.method === "POST" && segs[1] !== "sign") {
    const bucket = segs[1];
    const path = segs.slice(2).join("/");
    const raw = await readRaw(req);
    const ct = req.headers["content-type"] ?? "";
    let bytes = raw;
    let contentType = "application/octet-stream";
    if (ct.includes("multipart/form-data")) {
      const parsed = parseMultipart(raw, parseBoundary(ct));
      bytes = parsed.file ?? raw;
      contentType = parsed.contentType || "application/octet-stream";
    } else {
      contentType = req.headers["content-type"] ?? "application/octet-stream";
    }
    objects[`${bucket}/${path}`] = { bytes: new Uint8Array(bytes), contentType };
    return sendJson(res, 200, {
      Id: randomUUID(),
      Key: path,
      id: randomUUID(),
      path,
      fullPath: `${bucket}/${path}`,
    });
  }

  // remove: DELETE /object/{bucket}  body { prefixes: [...] }
  if (segs[0] === "object" && req.method === "DELETE" && segs.length >= 2) {
    const bucket = segs[1];
    const body = await readJson(req);
    const prefixes = body.prefixes ?? [];
    for (const p of prefixes) delete objects[`${bucket}/${p}`];
    return sendJson(res, 200, { message: "Successfully deleted" });
  }

  // list objects (not needed, but harmless)
  if (segs[0] === "object" && req.method === "GET" && segs[1] && !segs[2]) {
    const bucket = segs[1];
    const prefix = url.searchParams.get("prefix") ?? "";
    const items = Object.entries(objects)
      .filter(([k]) => k.startsWith(`${bucket}/${prefix}`))
      .map(([k, v]) => ({
        name: k.slice(bucket.length + 1),
        metadata: { mimetype: v.contentType, size: v.bytes.length },
      }));
    return sendJson(res, 200, items);
  }

  return sendJson(res, 404, { error: "Not found" });
}

/* -------------------------------- server ------------------------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(u.pathname);
  // CORS — the real Storage/PostgREST APIs allow cross-origin reads
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, apikey, content-type, prefer, accept, range",
  );
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (pathname.startsWith("/rest/v1/")) return await handleRest(req, res, pathname, u);
    if (pathname.startsWith("/storage/v1")) return await handleStorage(req, res, pathname, u);
    sendJson(res, 404, { message: "Not found" });
  } catch (e) {
    sendJson(res, 500, { message: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-supabase] listening on http://127.0.0.1:${PORT}`);
});
