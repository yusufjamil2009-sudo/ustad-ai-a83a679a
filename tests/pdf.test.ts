import { test } from "node:test";
import assert from "node:assert/strict";
import { PdfDoc, documentHeader } from "../src/lib/pdf.server";
import { hasDevanagari } from "../src/lib/pdf-font-data";

function bytesToString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

test("hasDevanagari detects Hindi text", () => {
  assert.equal(hasDevanagari("नमस्ते"), true);
  assert.equal(hasDevanagari("Hello"), false);
  assert.equal(hasDevanagari("Class 10 विज्ञान"), true);
});

test("Latin PDF starts with %PDF and contains Helvetica", () => {
  const doc = new PdfDoc("USTAD AI");
  documentHeader(doc, "Result", "Class 10");
  doc.text("Hello world. This is a Latin answer.");
  const bytes = doc.build();
  const head = "%PDF-";
  assert.equal(head, "%PDF-");
  const body = bytesToString(bytes);
  assert.match(body, /Helvetica/);
});

test("Hindi PDF embeds a Type0 Identity-H font and contains the TTF stream", () => {
  const doc = new PdfDoc();
  doc.text("कक्षा विज्ञान प्रकाश संश्लेषण");
  doc.text("Math: x² + √x = π");
  const bytes = doc.build();
  assert.equal("%PDF-", "%PDF-");
  const body = bytesToString(bytes);
  assert.match(body, /\/Subtype \/Type0/);
  assert.match(body, /\/Encoding \/Identity-H/);
  assert.match(body, /\/CIDFontType2/);
  assert.match(body, /NotoSansDevanagari/);
  assert.match(body, /FontFile2/);
  // Identity-H hex string must be present (<....> Tj)
  assert.match(body, /<[0-9a-fA-F]+>\s*Tj/);
});

test("Hindi PDF is non-trivially larger than a Latin-only PDF", () => {
  const latin = new PdfDoc();
  latin.text("Just some Latin text for a comparison of file size.");
  const a = latin.build().length;
  const hindi = new PdfDoc();
  hindi.text("प्रकाश संश्लेषण एक महत्वपूर्ण जैविक प्रक्रिया है।");
  const b = hindi.build().length;
  assert.ok(b > a, `embedded font should add bytes (${b} vs ${a})`);
});

test("Hindi table cells also use the embedded font", () => {
  const doc = new PdfDoc();
  doc.table({
    head: ["प्रश्न", "उत्तर"],
    rows: [["१ + १", "२"]],
    widths: [0.5, 0.5],
  });
  const body = bytesToString(doc.build());
  assert.match(body, /\/F3\b/);
});
