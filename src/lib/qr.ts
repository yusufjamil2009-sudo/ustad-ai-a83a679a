/**
 * Dependency-free QR Code encoder (Part 5).
 *
 * Byte mode, error-correction level M, versions 1–10 (auto-selected).
 * Written from the ISO/IEC 18004 specification so USTAD AI does not take on a
 * new runtime dependency just to draw a verification code. Output is a boolean
 * matrix; `qrSvgPath` turns it into an SVG path that renders identically in the
 * browser, in print and inside a downloaded certificate.
 *
 * Pure and isomorphic: safe to import from server engines and from React.
 */

/* ------------------------------------------------------------------ */
/* GF(256) arithmetic for Reed–Solomon                                  */
/* ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Reed–Solomon generator polynomial of the given degree. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    // poly[0] is the leading coefficient: multiply by (x - alpha^i).
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ poly[j]!) & 0xff;
      next[j + 1] = (next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!)) & 0xff;
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const res = new Uint8Array(degree);
  for (const byte of data) {
    const factor = (byte ^ res[0]!) & 0xff;
    res.copyWithin(0, 1);
    res[degree - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < degree; i++) res[i] = (res[i]! ^ gfMul(gen[i + 1]!, factor)) & 0xff;
    }
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Version tables — error-correction level M only                       */
/* ------------------------------------------------------------------ */

type VersionSpec = {
  /** error-correction codewords per block */
  ec: number;
  /** [blockCount, dataCodewordsPerBlock] groups */
  groups: Array<[number, number]>;
};

const SPEC_M: Record<number, VersionSpec> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: {
    ec: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  9: {
    ec: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  10: {
    ec: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
};

const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function dataCapacity(version: number): number {
  const spec = SPEC_M[version]!;
  return spec.groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

/* ------------------------------------------------------------------ */
/* Bit buffer                                                           */
/* ------------------------------------------------------------------ */

class Bits {
  private bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  padTo(bitLength: number) {
    while (this.bits.length < bitLength && this.bits.length % 8 !== 0) this.bits.push(0);
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3] = (out[i >> 3]! | (0x80 >> (i % 8))) & 0xff;
    });
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Matrix construction                                                  */
/* ------------------------------------------------------------------ */

type Grid = { size: number; modules: boolean[][]; reserved: boolean[][] };

function newGrid(version: number): Grid {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  };
}

function setModule(g: Grid, r: number, c: number, dark: boolean, reserve = true) {
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return;
  g.modules[r]![c] = dark;
  if (reserve) g.reserved[r]![c] = true;
}

function placeFinder(g: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= g.size || cc >= g.size) continue;
      const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        inRing &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setModule(g, rr, cc, dark);
    }
  }
}

function placeFunctionPatterns(g: Grid, version: number) {
  placeFinder(g, 0, 0);
  placeFinder(g, 0, g.size - 7);
  placeFinder(g, g.size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < g.size - 8; i++) {
    setModule(g, 6, i, i % 2 === 0);
    setModule(g, i, 6, i % 2 === 0);
  }

  // Alignment patterns (never on top of a finder).
  const centers = ALIGN[version]!;
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= g.size - 9) || (r >= g.size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          setModule(g, r + dr, c + dc, ring !== 1);
        }
      }
    }
  }

  // Dark module + reserved format areas.
  setModule(g, g.size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!g.reserved[8]![i]) setModule(g, 8, i, false);
    if (!g.reserved[i]![8]) setModule(g, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setModule(g, 8, g.size - 1 - i, false);
    setModule(g, g.size - 1 - i, 8, false);
  }

  // Version information blocks (versions 7+).
  if (version >= 7) {
    // BCH(18,6): reduce bits 17 down to 12 against generator 0x1f25.
    let rem = version << 12;
    for (let shift = 17; shift >= 12; shift--) {
      if ((rem >>> shift) & 1) rem ^= 0x1f25 << (shift - 12);
    }
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + g.size - 11;
      setModule(g, a, b, bit);
      setModule(g, b, a, bit);
    }
  }
}

function placeFormatInfo(g: Grid, mask: number) {
  // ECC level M = 0b00.
  const data = (0b00 << 3) | mask;
  // BCH(15,5): reduce bits 14 down to 10 against generator 0x537.
  let rem = data << 10;
  for (let shift = 14; shift >= 10; shift--) {
    if ((rem >>> shift) & 1) rem ^= 0x537 << (shift - 10);
  }
  const bits = (((data << 10) | rem) ^ 0x5412) >>> 0;
  /*
   * fmt[0] is the MSB (bit 14). Copy 1 runs (8,0)…(8,5), (8,7), (8,8), (7,8),
   * then (5,8)…(0,8). Copy 2 runs (size-1,8)…(size-7,8) then (8,size-8)…(8,size-1).
   * Verified module-for-module against a reference encoder.
   */
  const fmt: boolean[] = [];
  for (let i = 14; i >= 0; i--) fmt.push(((bits >>> i) & 1) === 1);

  let k = 0;
  for (let i = 0; i <= 5; i++) setModule(g, 8, i, fmt[k++]!);
  setModule(g, 8, 7, fmt[k++]!);
  setModule(g, 8, 8, fmt[k++]!);
  setModule(g, 7, 8, fmt[k++]!);
  for (let i = 5; i >= 0; i--) setModule(g, i, 8, fmt[k++]!);

  k = 0;
  for (let i = 0; i < 7; i++) setModule(g, g.size - 1 - i, 8, fmt[k++]!);
  for (let i = 7; i < 15; i++) setModule(g, 8, g.size - 15 + i, fmt[k++]!);

  setModule(g, g.size - 8, 8, true);
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

/** ISO 18004 penalty score — lower is a more scannable symbol. */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;

  const runScore = (line: boolean[]) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (line[i] === line[i - 1]) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s += 1;
      } else run = 1;
    }
    return s;
  };
  for (let i = 0; i < n; i++) {
    score += runScore(m[i]!);
    score += runScore(m.map((row) => row[i]!));
  }

  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = m[r]![c];
      if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) score += 3;
    }

  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const rev = [...pattern].reverse();
  const matches = (line: boolean[], at: number, pat: boolean[]) =>
    pat.every((p, i) => line[at + i] === p);
  for (let i = 0; i < n; i++) {
    const row = m[i]!;
    const col = m.map((r) => r[i]!);
    for (let j = 0; j + 11 <= n; j++) {
      if (matches(row, j, pattern) || matches(row, j, rev)) score += 40;
      if (matches(col, j, pattern) || matches(col, j, rev)) score += 40;
    }
  }

  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Encode `text` (UTF-8, so Hindi/Hinglish URLs work) as a QR matrix.
 * Throws only when the payload exceeds version-10 capacity, which the
 * certificate URLs never approach.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + bytes.length * 8;
    if (needed <= dataCapacity(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR payload too long");

  const spec = SPEC_M[version]!;
  const totalData = dataCapacity(version);
  const bits = new Bits();
  bits.push(0b0100, 4); // byte mode
  bits.push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) bits.push(b, 8);
  // terminator + byte alignment
  const cap = totalData * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0, 1);
  bits.padTo(cap);

  const data = new Uint8Array(totalData);
  data.set(bits.toBytes().subarray(0, totalData));
  for (let i = bits.toBytes().length, pad = 0; i < totalData; i++, pad++) {
    data[i] = pad % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks, compute EC, interleave.
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, spec.ec));
    }
  }
  const interleaved: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++)
    for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]!);
  for (let i = 0; i < spec.ec; i++) for (const b of ecBlocks) interleaved.push(b[i]!);

  // Place the codeword stream in the standard zigzag order.
  const g = newGrid(version);
  placeFunctionPatterns(g, version);

  /*
   * Canonical zigzag placement. Note the loop variable itself is decremented
   * when it reaches the vertical timing column (6), which shifts every column
   * pair to its left — emulating that exactly is what makes the symbol
   * decodable by real scanners.
   */
  let bitIndex = 0;
  const totalBits = interleaved.length * 8;
  let upward = true;
  for (let right = g.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < g.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const row = upward ? g.size - 1 - vert : vert;
        if (g.reserved[row]![c]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((interleaved[bitIndex >> 3]! >>> (7 - (bitIndex % 8))) & 1) === 1;
          bitIndex++;
        }
        g.modules[row]![c] = dark;
      }
    }
    upward = !upward;
  }

  // Choose the lowest-penalty mask.
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const test: Grid = {
      size: g.size,
      modules: g.modules.map((r) => [...r]),
      reserved: g.reserved.map((r) => [...r]),
    };
    for (let r = 0; r < g.size; r++)
      for (let c = 0; c < g.size; c++)
        if (!test.reserved[r]![c] && maskFn(mask, r, c)) test.modules[r]![c] = !test.modules[r]![c];
    placeFormatInfo(test, mask);
    const score = penalty(test.modules);
    if (!best || score < best.score) best = { mask, modules: test.modules, score };
  }
  return best!.modules;
}

/**
 * SVG path data for a QR matrix, drawn inside a `size × size` viewBox with a
 * quiet zone. Rendering as one path keeps the certificate DOM tiny and the code
 * crisp at any print resolution.
 */
export function qrSvgPath(matrix: boolean[][], size = 100, quiet = 2): string {
  const n = matrix.length;
  const unit = size / (n + quiet * 2);
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]![c]) continue;
      const x = (c + quiet) * unit;
      const y = (r + quiet) * unit;
      parts.push(
        `M${x.toFixed(3)} ${y.toFixed(3)}h${unit.toFixed(3)}v${unit.toFixed(3)}h-${unit.toFixed(3)}z`,
      );
    }
  }
  return parts.join("");
}
