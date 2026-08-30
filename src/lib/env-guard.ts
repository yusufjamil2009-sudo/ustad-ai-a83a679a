/**
 * Environment validation (pure, unit-tested).
 *
 * USTAD AI cannot issue guest sessions without USTAD_GUEST_SECRET and cannot
 * read stored provider credentials without USTAD_KEY_ENCRYPTION_SECRET. When
 * one of them is missing, weak, or accidentally rotated to a placeholder, the
 * failure used to surface deep inside a request ("Guest signing secret is not
 * configured"). This module checks them once at startup instead.
 *
 * Both secrets support a `_PREVIOUS` companion used during rotation:
 *   USTAD_GUEST_SECRET_PREVIOUS           -> old guest tokens still verify
 *   USTAD_KEY_ENCRYPTION_SECRET_PREVIOUS  -> old ciphertext still decrypts
 */
export type EnvIssue = { name: string; level: "error" | "warning"; message: string };

export type EnvReport = { ok: boolean; issues: EnvIssue[] };

export type EnvLike = Record<string, string | undefined>;

const PLACEHOLDERS =
  /^(changeme|change_me|placeholder|secret|password|test|todo|xxx+|your[-_ ]?secret|replace[-_ ]?me|undefined|null)$/i;

const MIN_LENGTH = 32;

/** Format rules shared by both USTAD server secrets. */
export function validateSecretValue(name: string, value: string | undefined): EnvIssue[] {
  const issues: EnvIssue[] = [];
  if (value === undefined || value.trim() === "") {
    issues.push({ name, level: "error", message: `${name} is not set.` });
    return issues;
  }
  if (value !== value.trim()) {
    issues.push({
      name,
      level: "error",
      message: `${name} has leading/trailing whitespace — it was probably pasted with a newline.`,
    });
  }
  const v = value.trim();
  if (/\s/.test(v)) {
    issues.push({ name, level: "error", message: `${name} must not contain whitespace.` });
  }
  if (PLACEHOLDERS.test(v)) {
    issues.push({ name, level: "error", message: `${name} still holds a placeholder value.` });
  }
  if (v.length < MIN_LENGTH) {
    issues.push({
      name,
      level: "error",
      message: `${name} must be at least ${MIN_LENGTH} characters (got ${v.length}).`,
    });
  }
  if (v.length >= MIN_LENGTH && new Set(v).size < 10) {
    issues.push({
      name,
      level: "warning",
      message: `${name} looks low-entropy (fewer than 10 distinct characters).`,
    });
  }
  return issues;
}

const REQUIRED_SECRETS = ["USTAD_GUEST_SECRET", "USTAD_KEY_ENCRYPTION_SECRET"] as const;

const REQUIRED_BACKEND = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Full startup validation of the server environment. */
export function validateEnv(env: EnvLike): EnvReport {
  const issues: EnvIssue[] = [];

  for (const name of REQUIRED_SECRETS) {
    issues.push(...validateSecretValue(name, env[name]));
    const prevName = `${name}_PREVIOUS`;
    const prev = env[prevName];
    if (prev !== undefined && prev.trim() !== "") {
      issues.push(...validateSecretValue(prevName, prev));
      if (prev.trim() === (env[name] ?? "").trim()) {
        issues.push({
          name: prevName,
          level: "warning",
          message: `${prevName} is identical to ${name} — rotation did not actually change the value.`,
        });
      }
    }
  }

  for (const name of REQUIRED_BACKEND) {
    if (!env[name]?.trim()) {
      issues.push({ name, level: "error", message: `${name} is not set.` });
    }
  }
  if (env["SUPABASE_URL"] && !/^https:\/\/[\w-]+\.supabase\.(co|in|net)\/?$/.test(env["SUPABASE_URL"].trim())) {
    issues.push({
      name: "SUPABASE_URL",
      level: "warning",
      message: "SUPABASE_URL does not look like a project URL (https://<ref>.supabase.co).",
    });
  }
  if (!env["LOVABLE_API_KEY"]?.trim()) {
    issues.push({
      name: "LOVABLE_API_KEY",
      level: "warning",
      message:
        "LOVABLE_API_KEY is not set — built-in USTAD Core chat/image/voice fallback is disabled.",
    });
  }

  return { ok: !issues.some((i) => i.level === "error"), issues };
}

/** Human readable multi-line report used by the startup logger. */
export function formatEnvReport(report: EnvReport): string {
  if (report.issues.length === 0) return "USTAD env check: all required secrets are configured.";
  const lines = report.issues.map((i) => `  [${i.level}] ${i.message}`);
  return [
    report.ok
      ? "USTAD env check passed with warnings:"
      : "USTAD env check FAILED — the app cannot issue guest sessions or read stored provider keys:",
    ...lines,
    "  See docs/SECRETS.md for how to set/rotate these values safely.",
  ].join("\n");
}
