import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGuest } from "@/lib/ustad-client";
import {
  listRowsFn,
  insertRowFn,
  updateRowFn,
  deleteRowFn,
  generateNotesFn,
} from "@/lib/ustad-api";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { title: "Smart Notes — Write & Auto-Summarise | USTAD AI" },
      {
        name: "description",
        content:
          "Keep study notes in one place and let USTAD AI turn any text into clean, exam-ready markdown notes.",
      },
      { property: "og:title", content: "Smart Notes — USTAD AI" },
      {
        property: "og:description",
        content: "Write notes or generate exam-ready notes from any content with AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotesPage,
});

type Note = { id: string; title: string; content: string; created_at: string };

function NotesPage() {
  const { token } = useGuest();
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);

  const refresh = async () => {
    if (!token) return;
    setNotes((await listRowsFn({ data: { token, table: "notes" } })) as unknown as Note[]);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const save = async () => {
    if (!title.trim() && !content.trim()) return;
    setLoading(true);
    try {
      if (active) {
        await updateRowFn({
          data: { token, table: "notes", id: active.id, patch: { title, content } },
        });
      } else {
        await insertRowFn({
          data: {
            token,
            table: "notes",
            values: { title: title || "Untitled", content, source: "manual" },
          },
        });
      }
      setActive(null);
      setTitle("");
      setContent("");
      await refresh();
      toast.success("Note saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const aiNotes = async () => {
    if (!source.trim()) {
      toast.error("Paste some content first.");
      return;
    }
    setLoading(true);
    try {
      const note = (await generateNotesFn({
        data: { token, source, language: "english" },
      })) as unknown as Note;
      setSource("");
      await refresh();
      setActive(note);
      setTitle(note.title);
      setContent(note.content);
      toast.success("AI notes created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Smart Notes"
        subtitle="Write yourself, or let USTAD turn any content into clean study notes."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setActive(null);
              setTitle("");
              setContent("");
            }}
          >
            <Plus className="size-4" /> New note
          </Button>
        }
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            <div className="panel space-y-2 p-4">
              <p className="text-xs tracking-widest text-muted-foreground uppercase">AI notes</p>
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Paste a chapter, transcript or article…"
                className="min-h-24"
              />
              <Button className="w-full" onClick={() => void aiNotes()} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-4" />
                )}
                Generate notes
              </Button>
            </div>
            <div className="hide-scrollbar max-h-[50vh] space-y-1 overflow-y-auto">
              {notes.map((n) => (
                <div
                  key={n.id}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    active?.id === n.id ? "bg-surface-2" : "hover:bg-surface"
                  }`}
                >
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => {
                      setActive(n);
                      setTitle(n.title);
                      setContent(n.content);
                    }}
                  >
                    {n.title}
                  </button>
                  <button
                    onClick={async () => {
                      await deleteRowFn({ data: { token, table: "notes", id: n.id } });
                      if (active?.id === n.id) setActive(null);
                      await refresh();
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive opacity-0 group-hover:opacity-100" />
                  </button>
                </div>
              ))}
              {notes.length === 0 ? (
                <p className="px-3 py-6 text-xs text-muted-foreground">No notes yet.</p>
              ) : null}
            </div>
          </div>

          <div className="panel space-y-3 p-5">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
            />
            {preview ? (
              <div className="min-h-72 rounded-lg bg-background/40 p-4">
                <Markdown content={content} />
              </div>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write markdown notes…"
                className="min-h-72"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={loading}>
                Save note
              </Button>
              <Button variant="secondary" onClick={() => setPreview((p) => !p)}>
                {preview ? "Edit" : "Preview"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${title || "note"}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="size-4" /> Export
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
