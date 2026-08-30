/** Startup environment check — runs once per server instance. */
import { formatEnvReport, validateEnv, type EnvReport } from "./env-guard";

let cached: EnvReport | undefined;

export function runStartupEnvCheck(): EnvReport {
  if (cached) return cached;
  const report = validateEnv(process.env as Record<string, string | undefined>);
  cached = report;
  const text = formatEnvReport(report);
  if (!report.ok) console.error(text);
  else if (report.issues.length) console.warn(text);
  else console.info(text);
  return report;
}
