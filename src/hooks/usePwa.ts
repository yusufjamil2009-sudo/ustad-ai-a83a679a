import { useEffect, useState } from "react";
import { getPwaSnapshot, initPwa, subscribePwa, type PwaSnapshot } from "@/lib/pwa";

/** Live, honest PWA install state from real browser APIs. */
export function usePwa(): PwaSnapshot {
  const [snap, setSnap] = useState<PwaSnapshot>(getPwaSnapshot);

  useEffect(() => {
    initPwa();
    setSnap(getPwaSnapshot());
    return subscribePwa(setSnap);
  }, []);

  return snap;
}

/** Real network status — used to show an honest offline notice. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}
