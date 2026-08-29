import { test } from "node:test";
import assert from "node:assert/strict";
import { route, detectLanguage } from "../src/lib/router.server";

test("web_search=false disables needsWeb even for a latest-news question", () => {
  const d = route({
    text: "What is the latest news today?",
    hasImages: false,
    preferredLanguage: "english",
    dataSaver: false,
    webSearchEnabled: false,
  });
  assert.equal(d.needsWeb, false);
  assert.equal(d.webSearchEnabled, false);
  assert.deepEqual(d.urls, []);
});

test("web_search=true allows web for latest-news question", () => {
  const d = route({
    text: "What is the latest news today?",
    hasImages: false,
    preferredLanguage: "english",
    dataSaver: false,
    webSearchEnabled: true,
  });
  assert.equal(d.needsWeb, true);
  assert.equal(d.webSearchEnabled, true);
});

test("default webSearchEnabled is true when omitted", () => {
  const d = route({
    text: "latest news",
    hasImages: false,
    preferredLanguage: "english",
    dataSaver: false,
  });
  assert.equal(d.webSearchEnabled, true);
});

test("detectLanguage honours explicit Hinglish request", () => {
  assert.equal(detectLanguage("explain photosynthesis", "hinglish"), "hinglish");
  assert.equal(detectLanguage("हिंदी में समझाओ", "english"), "hindi");
});
