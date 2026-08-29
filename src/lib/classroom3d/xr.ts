/** XR engine — optional WebXR (VR / AR) session support with graceful fallback. */
import type * as THREE from "three";

export class XREngine {
  supported = false;
  private session: XRSession | null = null;
  onChange?: (active: boolean) => void;

  constructor(private renderer: THREE.WebGLRenderer) {}

  async detect(): Promise<boolean> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr?.isSessionSupported) return (this.supported = false);
    try {
      this.supported = await xr.isSessionSupported("immersive-vr");
    } catch {
      this.supported = false;
    }
    return this.supported;
  }

  async enter(): Promise<boolean> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr || !this.supported) return false;
    try {
      const session = await xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);
      this.session = session;
      session.addEventListener("end", () => {
        this.session = null;
        this.renderer.xr.enabled = false;
        this.onChange?.(false);
      });
      this.onChange?.(true);
      return true;
    } catch {
      return false;
    }
  }

  async exit(): Promise<void> {
    await this.session?.end().catch(() => undefined);
    this.session = null;
  }

  get active(): boolean {
    return this.session !== null;
  }
}
