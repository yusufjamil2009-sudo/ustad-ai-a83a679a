/** AES-GCM encryption for stored provider credentials. */
const enc = new TextEncoder();
const dec = new TextDecoder();

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env["USTAD_KEY_ENCRYPTION_SECRET"];
  if (!secret) throw new Error("Encryption secret is not configured");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptString(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    enc.encode(plain),
  );
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptString(payload: string): Promise<string> {
  if (!payload.startsWith("v1:")) return payload;
  const [, ivB64, ctB64] = payload.split(":");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64!) },
    await aesKey(),
    fromB64(ctB64!),
  );
  return dec.decode(pt);
}

export async function encryptConfig(
  config: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = v ? await encryptString(v) : "";
  }
  return out;
}

export async function decryptConfig(
  config: Record<string, unknown>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (typeof v !== "string" || !v) continue;
    out[k] = await decryptString(v);
  }
  return out;
}

/** Never send raw credentials back to the browser. */
export function maskConfig(
  config: Record<string, unknown>,
  secretKeys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (typeof v !== "string" || !v) continue;
    out[k] = secretKeys.includes(k) ? "••••••••" : "set";
  }
  return out;
}
