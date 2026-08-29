/**
 * User-safe AI / provider error mapping.
 * Never leak API keys, decrypted config, stack traces or internal URLs.
 */

export type AiErrorKind =
  "core_unavailable" | "no_provider" | "quota" | "unauthorized" | "network" | "failed";

export type UserFacingAiError = {
  kind: AiErrorKind;
  message: string;
};

const SECRET =
  /(?:sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+|Bearer\s+[A-Za-z0-9._-]{8,}|api[_-]?key\s*[:=]\s*\S+)/gi;

export function sanitizeErrorDetail(raw: string): string {
  return raw
    .replace(SECRET, "[redacted]")
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/(?:\n\s*at\s.*)+/g, "")
    .replace(process.env["LOVABLE_API_KEY"] ?? "___never___", "[redacted]")
    .slice(0, 240);
}

export function classifyAiFailure(
  err: unknown,
  ctx: { hadUserProvider: boolean; coreConfigured: boolean },
): UserFacingAiError {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/401|403|unauthor|invalid_credentials|invalid api key|invalid key/i.test(raw)) {
    return {
      kind: "unauthorized",
      message:
        "AI credentials were rejected. Check the API Manager, or try another configured provider.",
    };
  }
  if (/402|quota|credit|billing/i.test(raw)) {
    return {
      kind: "quota",
      message:
        "AI quota or credits are exhausted. Add credits or configure another provider in the API Manager.",
    };
  }
  if (/429|rate.?limit/i.test(raw)) {
    return {
      kind: "quota",
      message: "AI is rate limited right now. Please try again in a moment.",
    };
  }
  if (/network_error|network error|fetch failed|enotfound|econn|etimedout|timeout/i.test(raw)) {
    return {
      kind: "network",
      message: "Network problem while reaching the AI provider. Check your connection and retry.",
    };
  }
  if (!ctx.coreConfigured && !ctx.hadUserProvider) {
    return {
      kind: "no_provider",
      message:
        "No AI provider is configured. Add a provider in the API Manager, or enable USTAD Core.",
    };
  }
  if (!ctx.coreConfigured) {
    return {
      kind: "core_unavailable",
      message: "USTAD Core is unavailable and configured providers failed. Check the API Manager.",
    };
  }
  if (!ctx.hadUserProvider) {
    return {
      kind: "core_unavailable",
      message: "USTAD Core could not complete this request. Try again in a moment.",
    };
  }
  return {
    kind: "failed",
    message:
      "Every configured AI provider failed. Check the API Manager, or try again in a moment.",
  };
}

export function userFacingAiMessage(
  err: unknown,
  ctx: { hadUserProvider: boolean; coreConfigured: boolean },
): string {
  return classifyAiFailure(err, ctx).message;
}
