import { useState } from "react";
import { Smartphone, CheckCircle2, Download, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UstadLogo } from "@/components/UstadLogo";
import { usePwa } from "@/hooks/usePwa";
import { promptInstall } from "@/lib/pwa";

const STATUS: Record<string, string> = {
  installed: "Installed ✓",
  available: "Ready to install",
  manual: "Manual install (Add to Home Screen)",
  dismissed: "Installation dismissed",
  unsupported: "Browser installation unavailable",
  unknown: "Checking…",
};

/**
 * Permanent Settings section. Always visible; the state text is derived from
 * real browser capability — never from a click or localStorage.
 */
export function PwaInstallCard() {
  const { state, platform, standalone } = usePwa();
  const [busy, setBusy] = useState(false);

  async function onInstall() {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === "accepted") toast.success("Installing USTAD AI…");
    else if (outcome === "dismissed") toast("Installation dismissed. You can install any time.");
    else toast.error("Your browser did not offer an install prompt right now.");
  }

  return (
    <section className="panel space-y-4 p-4" aria-labelledby="pwa-install-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card ring-1 ring-border">
          <UstadLogo className="size-8" />
        </span>
        <div className="min-w-0">
          <h3 id="pwa-install-heading" className="flex items-center gap-2 font-semibold">
            <Smartphone className="size-4 text-primary" /> USTAD AI App
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "installed"
              ? "USTAD AI is installed on this device."
              : "Install USTAD AI on your device for a more app-like experience."}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Status:{" "}
        <span className={state === "installed" ? "font-medium text-primary" : "font-medium"}>
          {STATUS[state]}
        </span>
        {standalone ? " · running in standalone mode" : null}
      </p>

      {state === "installed" ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 text-primary" /> Launch USTAD AI from your home screen or
          app list.
        </div>
      ) : (
        <div className="space-y-3">
          <Button onClick={() => void onInstall()} disabled={state !== "available" || busy}>
            <Download className="mr-1 size-4" />
            {busy ? "Waiting for your browser…" : "Install USTAD AI"}
          </Button>

          {state !== "available" ? (
            <div className="flex gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              <div>
                {platform === "ios" ? (
                  <p>
                    Safari on iOS does not provide a one-click install. Tap the{" "}
                    <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.
                  </p>
                ) : state === "dismissed" ? (
                  <p>
                    You dismissed the browser prompt. Use your browser menu →{" "}
                    <strong>Install app</strong>, or reload this page to try again.
                  </p>
                ) : (
                  <p>
                    One-click install is not available in this browser or context (it is unavailable
                    inside embedded previews). Open the published USTAD AI site in Chrome, Edge or
                    Android Chrome and use <strong>Install app</strong> /{" "}
                    <strong>Add to Home Screen</strong>.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
