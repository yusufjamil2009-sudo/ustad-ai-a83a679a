import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BellRing, Plus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGuest } from "@/lib/ustad-client";
import { listRowsFn, insertRowFn, updateRowFn, deleteRowFn } from "@/lib/ustad-api";
import { parseWhen, formatWhen, detectRepeat } from "@/lib/chronos";

export const Route = createFileRoute("/reminders")({
  head: () => ({
    meta: [
      { title: "Reminders — Natural Language Scheduling | USTAD AI" },
      {
        name: "description",
        content:
          "Type “kal subah 7 baje padhai” and USTAD AI schedules it. Browser alerts keep you on track.",
      },
      { property: "og:title", content: "Reminders — USTAD AI" },
      {
        property: "og:description",
        content: "Hinglish and English natural-language reminders with repeat rules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RemindersPage,
});

type Reminder = {
  id: string;
  title: string;
  due_at: string;
  status: string;
  repeat_rule: string;
};

function RemindersPage() {
  const { token } = useGuest();
  const [items, setItems] = useState<Reminder[]>([]);
  const [text, setText] = useState("");

  const refresh = async () => {
    if (!token) return;
    setItems((await listRowsFn({ data: { token, table: "reminders" } })) as unknown as Reminder[]);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      items
        .filter((r) => r.status !== "done" && new Date(r.due_at).getTime() <= now)
        .forEach((r) => {
          toast(`⏰ ${r.title}`, { description: formatWhen(r.due_at) });
          void updateRowFn({
            data: { token, table: "reminders", id: r.id, patch: { status: "fired" } },
          });
        });
    }, 30000);
    return () => clearInterval(timer);
  }, [items, token]);

  const add = async () => {
    const when = parseWhen(text);
    if (!when) {
      toast.error("Time samajh nahi aaya. Try: “kal subah 7 baje revision”.");
      return;
    }
    const title = text.replace(when.matchedText, "").trim() || "Reminder";
    await insertRowFn({
      data: {
        token,
        table: "reminders",
        values: {
          title,
          due_at: when.date.toISOString(),
          repeat_rule: detectRepeat(text),
          kind: "reminder",
        },
      },
    });
    setText("");
    await refresh();
    toast.success(`Set for ${formatWhen(when.date)}`);
  };

  return (
    <AppShell>
      <PageHeader title="Reminders" subtitle="Natural language, Hinglish friendly." />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="kal subah 7 baje physics revision"
            />
            <Button onClick={() => void add()}>
              <Plus className="size-4" />
            </Button>
          </div>
          {items.map((r) => (
            <div key={r.id} className="panel flex items-center justify-between gap-3 p-3">
              <div>
                <p
                  className={`text-sm ${r.status === "done" ? "text-muted-foreground line-through" : ""}`}
                >
                  {r.title}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <BellRing className="size-3" /> {formatWhen(r.due_at)}
                  {r.repeat_rule && r.repeat_rule !== "none" ? ` · ${r.repeat_rule}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await updateRowFn({
                      data: {
                        token,
                        table: "reminders",
                        id: r.id,
                        patch: { status: r.status === "done" ? "pending" : "done" },
                      },
                    });
                    await refresh();
                  }}
                >
                  <Check
                    className={`size-4 ${r.status === "done" ? "text-success" : "text-muted-foreground"}`}
                  />
                </button>
                <button
                  onClick={async () => {
                    await deleteRowFn({ data: { token, table: "reminders", id: r.id } });
                    await refresh();
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No reminders yet.</p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
