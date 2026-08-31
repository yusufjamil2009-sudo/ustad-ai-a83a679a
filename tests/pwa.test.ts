import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

test("manifest declares a real installable USTAD AI app", () => {
  assert.equal(manifest.name, "USTAD AI");
  assert.equal(manifest.short_name, "USTAD AI");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test("manifest ships 192/512 any icons plus maskable icons", () => {
  const any = manifest.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
  const maskable = manifest.icons.filter((i) => i.purpose === "maskable").map((i) => i.sizes);
  assert.ok(any.includes("192x192") && any.includes("512x512"));
  assert.ok(maskable.includes("192x192") && maskable.includes("512x512"));
  for (const icon of manifest.icons) {
    assert.doesNotThrow(() => readFileSync(`public${icon.src}`));
  }
});

test("service worker never answers API, server function or OAuth routes", () => {
  const config = readFileSync("vite.config.ts", "utf8");
  assert.match(config, /navigateFallbackDenylist/);
  assert.match(config, /\/\^\\\/api\\\//);
  assert.match(config, /_serverFn/);
  assert.match(config, /~oauth/);
  assert.match(config, /injectRegister: null/);
  assert.match(config, /devOptions: \{ enabled: false \}/);
});

test("registration is refused in dev, iframes and Lovable preview hosts", () => {
  const pwa = readFileSync("src/lib/pwa.ts", "utf8");
  assert.match(pwa, /import\.meta\.env\.PROD/);
  assert.match(pwa, /window\.self !== window\.top/);
  assert.match(pwa, /id-preview--/);
  assert.match(pwa, /lovableproject\.com/);
  assert.match(pwa, /sw"\) === "off"/);
});

test("install state is never faked on click", () => {
  const pwa = readFileSync("src/lib/pwa.ts", "utf8");
  // "installed" may only come from standalone detection, appinstalled or related apps.
  assert.ok(!/outcome === "accepted"[\s\S]{0,120}state: "installed"/.test(pwa));
  assert.match(pwa, /appinstalled/);
  assert.match(pwa, /display-mode: standalone/);
});
