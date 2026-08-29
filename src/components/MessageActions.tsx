/**
 * Persistent per-response action bar: Copy, Save to Notes, Read Aloud
 * (play/pause/resume/stop), 3D Classroom and a More menu.
 * Rendered for every completed assistant message, including the first one.
 */
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings-store";
import {
  Copy,
  Check,
  NotebookPen,
  Volume2,
  Pause,
  Play,
  Square,
  Boxes,
  MoreHorizontal,
  Globe,
  Download,
  Share2,
  FileText,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DiagramNotesViewer, type ViewerMode } from "@/components/diagram/DiagramNotesViewer";
import { downloadAnswerPdf } from "@/lib/browser-pdf";
import {
  pauseSpeaking,
  resumeSpeaking,
  speakMessage,
  stopSpeaking,
  subscribeTts,
  ttsSupported,
  speakableText,
} from "@/lib/tts";

export type ActionMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  meta?: { sources?: Array<{ title: string; url: string }> | null } | null;
};

export function MessageActions({
  message,
  question,
  onSaveNote,
  onTeachIn3D,
  onShowSources,
  hasSources,
}: {
  message: ActionMessage;
  question: string;
  onSaveNote: () => Promise<void>;
  onTeachIn3D: () => void;
  onShowSources: () => void;
  hasSources: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [tts, setTts] = useState({
    messageId: null as string | null,
    speaking: false,
    paused: false,
  });
  const [viewer, setViewer] = useState<{ mode: ViewerMode; open: boolean }>({
    mode: "diagram",
    open: false,
  });
  const { settings } = useSettings();
  const lang = (settings?.language ?? "english") as "english" | "hindi" | "hinglish";

  useEffect(() => subscribeTts(setTts), []);

  const mine = tts.messageId === message.id && tts.speaking;

  const copy = async () => {
    const text = message.content;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed — your browser blocked clipboard access.");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveNote();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const read = () => {
    if (!ttsSupported()) {
      toast.error("Read aloud is not supported in this browser.");
      return;
    }
    if (mine) {
      if (tts.paused) resumeSpeaking();
      else pauseSpeaking();
      return;
    }
    speakMessage(message.id, message.content);
  };

  const download = () => {
    const blob = new Blob([`# ${question || "USTAD AI"}\n\n${message.content}\n`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ustad-answer-${message.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadAnswerPdf({
        title: question || "USTAD AI answer",
        subtitle: new Date(message.created_at).toLocaleString(),
        content: message.content,
        fileName: `ustad-answer-${message.id.slice(0, 8)}.pdf`,
      });
      toast.success("PDF downloaded.");
    } catch (e) {
      toast.error((e as Error).message || "Could not create the PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  const share = async () => {
    const text = speakableText(message.content).slice(0, 1500);
    if (navigator.share) {
      try {
        await navigator.share({ title: "USTAD AI", text });
        return;
      } catch {
        /* user cancelled */
      }
    }
    await copy();
    toast.success("Copied — paste it anywhere to share.");
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/70 pt-2">
      <ActionButton onClick={() => void copy()} label={copied ? "Copied" : "Copy"}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </ActionButton>

      <ActionButton
        onClick={() => void save()}
        label={saved ? "Saved" : "Save to Notes"}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : saved ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <NotebookPen className="size-3.5" />
        )}
      </ActionButton>

      <ActionButton onClick={read} label={mine ? (tts.paused ? "Resume" : "Pause") : "Read aloud"}>
        {mine ? (
          tts.paused ? (
            <Play className="size-3.5" />
          ) : (
            <Pause className="size-3.5" />
          )
        ) : (
          <Volume2 className="size-3.5" />
        )}
      </ActionButton>

      {mine ? (
        <ActionButton onClick={stopSpeaking} label="Stop">
          <Square className="size-3.5 text-destructive" />
        </ActionButton>
      ) : null}

      <ActionButton onClick={() => setViewer({ mode: "diagram", open: true })} label="Diagram">
        <ImageIcon className="size-3.5 text-primary" />
      </ActionButton>

      <ActionButton onClick={() => setViewer({ mode: "notes", open: true })} label="Notes">
        <FileText className="size-3.5 text-primary" />
      </ActionButton>

      <ActionButton onClick={onTeachIn3D} label="3D Classroom">
        <Boxes className="size-3.5 text-primary" />
      </ActionButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            aria-label="More actions"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void exportPdf()} disabled={pdfBusy}>
            {pdfBusy ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <FileText className="mr-2 size-3.5" />
            )}
            Download as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={download}>
            <Download className="mr-2 size-3.5" /> Download as markdown
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void share()}>
            <Share2 className="mr-2 size-3.5" /> Share
          </DropdownMenuItem>
          {hasSources ? (
            <DropdownMenuItem onClick={onShowSources}>
              <Globe className="mr-2 size-3.5" /> Show sources
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <DiagramNotesViewer
        open={viewer.open}
        onOpenChange={(v) => setViewer((s) => ({ ...s, open: v }))}
        mode={viewer.mode}
        question={question}
        answer={message.content}
        language={lang}
      />
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
