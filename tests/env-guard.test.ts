import test from "node:test";
import assert from "node:assert/strict";
import { validateEnv, validateSecretValue, formatEnvReport } from "../src/lib/env-guard";

const STRONG_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";
const STRONG_B = "f0e9d8c7b6a5948372615f4e3d2c1b0a99887766";

const base = {
  USTAD_GUEST_SECRET: STRONG_A,
  USTAD_KEY_ENCRYPTION_SECRET: STRONG_B,
  SUPABASE_URL: "https://abcdefghijklmno.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LOVABLE_API_KEY: "lovable-key",
};

test("a fully configured environment passes with no issues", () => {
  const report = validateEnv(base);
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.match(formatEnvReport(report), /all required secrets/);
});

test("missing USTAD secrets are startup errors", () => {
  const report = validateEnv({ ...base, USTAD_GUEST_SECRET: undefined });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.name === "USTAD_GUEST_SECRET" && i.level === "error"));
  assert.match(formatEnvReport(report), /FAILED/);
});

test("format rules: length, whitespace and placeholders", () => {
  assert.ok(validateSecretValue("X", "short").some((i) => /at least 32/.test(i.message)));
  assert.ok(validateSecretValue("X", `${STRONG_A}\n`).some((i) => /whitespace/.test(i.message)));
  assert.ok(validateSecretValue("X", "changeme").some((i) => /placeholder/.test(i.message)));
  assert.deepEqual(validateSecretValue("X", STRONG_A), []);
});

test("low entropy secrets warn but do not block startup", () => {
  const report = validateEnv({
    ...base,
    USTAD_GUEST_SECRET: "abababababababababababababababababab",
  });
  assert.equal(report.ok, true);
  assert.ok(report.issues.some((i) => i.level === "warning" && /entropy/.test(i.message)));
});

test("rotation slots are validated and must differ from the current value", () => {
  const same = validateEnv({ ...base, USTAD_GUEST_SECRET_PREVIOUS: STRONG_A });
  assert.ok(
    same.issues.some((i) => i.name === "USTAD_GUEST_SECRET_PREVIOUS" && i.level === "warning"),
  );
  const weak = validateEnv({ ...base, USTAD_KEY_ENCRYPTION_SECRET_PREVIOUS: "old" });
  assert.equal(weak.ok, false);
  const good = validateEnv({ ...base, USTAD_GUEST_SECRET_PREVIOUS: STRONG_B });
  assert.equal(good.ok, true);
  assert.deepEqual(good.issues, []);
});

test("backend env is checked too", () => {
  assert.equal(validateEnv({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" }).ok, false);
  assert.ok(
    validateEnv({ ...base, LOVABLE_API_KEY: "" }).issues.some(
      (i) => i.name === "LOVABLE_API_KEY" && i.level === "warning",
    ),
  );
  assert.ok(
    validateEnv({ ...base, SUPABASE_URL: "http://localhost" }).issues.some(
      (i) => i.name === "SUPABASE_URL" && i.level === "warning",
    ),
  );
});
