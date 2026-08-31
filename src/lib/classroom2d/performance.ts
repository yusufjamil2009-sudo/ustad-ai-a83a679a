/** Performance engine — FPS sampling, adaptive quality, device detection, memory hints. */
import type { QualityTier } from "./types";

export class PerformanceEngine {
  private samples: number[] = [];
  private last = performance.now();
  private cooldown = 0;
  fps = 60;
  tier: QualityTier;
  onQualityChange?: (q: QualityTier) => void;
  adaptive = true;

  constructor() {
    this.tier = PerformanceEngine.detectTier();
  }

  static detectTier(): QualityTier {
    if (typeof navigator === "undefined") return "medium";
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (mobile || mem <= 2 || cores <= 2) return "low";
    if (mem <= 4 || cores <= 4) return "medium";
    return "high";
  }

  static isMobile(): boolean {
    return (
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    );
  }

  /** Call once per frame. Returns delta seconds. */
  tick(): number {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (dt > 0) {
      this.samples.push(1 / dt);
      if (this.samples.length > 60) this.samples.shift();
      this.fps = Math.round(this.samples.reduce((a, b) => a + b, 0) / this.samples.length);
    }
    this.cooldown -= dt;
    if (this.adaptive && this.samples.length >= 60 && this.cooldown <= 0) {
      if (this.fps < 26 && this.tier !== "low") {
        this.tier = this.tier === "high" ? "medium" : "low";
        this.cooldown = 6;
        this.onQualityChange?.(this.tier);
      } else if (this.fps > 56 && this.tier !== "high") {
        this.tier = this.tier === "low" ? "medium" : "high";
        this.cooldown = 10;
        this.onQualityChange?.(this.tier);
      }
    }
    return dt;
  }
}
