/** Real device-camera capture that feeds the shared attachment pipeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CameraCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);
  const [starting, setStarting] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    setError("");
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("This browser does not support camera capture.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      const msg =
        (e as Error).name === "NotAllowedError"
          ? "Camera permission denied. You can still attach a photo from your device."
          : (e as Error).message || "Camera could not be opened.";
      setError(msg);
      stopStream();
    } finally {
      setStarting(false);
    }
  }, [stopStream]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setShot((s) => {
        if (s) URL.revokeObjectURL(s.url);
        return null;
      });
      setError("");
      return;
    }
    void start();
    return stopStream;
  }, [open, start, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Capture failed. Please try again.");
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        setShot({ url: URL.createObjectURL(blob), file });
        stopStream();
      },
      "image/jpeg",
      0.9,
    );
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    void start();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Camera</p>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close camera">
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-black">
        {error ? (
          <p className="px-6 text-center text-sm text-destructive">{error}</p>
        ) : shot ? (
          <img
            src={shot.url}
            alt="Captured preview"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {shot ? (
          <>
            <Button variant="secondary" onClick={retake}>
              <RotateCcw className="mr-1 size-4" /> Retake
            </Button>
            <Button
              onClick={() => {
                onCapture(shot.file);
                URL.revokeObjectURL(shot.url);
                setShot(null);
                onClose();
              }}
            >
              <Check className="mr-1 size-4" /> Use photo
            </Button>
          </>
        ) : error ? (
          <Button variant="secondary" onClick={() => void start()}>
            Try again
          </Button>
        ) : (
          <Button onClick={take} disabled={starting}>
            {starting ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Camera className="mr-1 size-4" />
            )}{" "}
            Capture
          </Button>
        )}
      </div>
    </div>
  );
}
