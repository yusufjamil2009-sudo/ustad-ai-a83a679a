import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brain, Target, Plus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGuest } from "@/lib/ustad-client";
import { listRowsFn, insertRowFn, updateRowFn, deleteRowFn } from "@/lib/ustad-api";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory & Goals — What USTAD Remembers | USTAD AI" },
      {
        name: "description",
        content:
          "See, add and delete everything USTAD AI remembers about you, and track your active learning goals.",
      },
      { property: "og:title", content: "Memory & Goals — USTAD AI" },
      {
        property: "og:description",
        content: "Full control over your AI memory and personal learning goals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MemoryPage,
});

type Memory = { id: string; content: string; kind: string; created_at: string };
type Goal = { id: string; title: string; status: string; progress: number; created_at: string };

function MemoryPage() {
  const { token } = useGuest();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [memText, setMemText] = useState("");
  const [goalText, setGoalText] = useState("");

  const refresh = async () => {
    if (!token) return;
    const [m, g] = await Promise.all([
      listRowsFn({ data: { token, table: "memories" } }),
      listRowsFn({ data: { token, table: "goals" } }),
    ]);
    setMemories(m as unknown as Memory[]);
    setGoals(g as unknown as Goal[]);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AppShell>
      <PageHeader
        title="Memory & Goals"
        subtitle="USTAD uses these in every reply. You stay in full control."
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <Tabs defaultValue="memory" className="mx-auto max-w-3xl">
          <TabsList>
            <TabsTrigger value="memory">
              <Brain className="mr-1 size-4" /> Memory
            </TabsTrigger>
            <TabsTrigger value="goals">
              <Target className="mr-1 size-4" /> Goals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="memory" className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={memText}
                onChange={(e) => setMemText(e.target.value)}
                placeholder="e.g. I am preparing for NEET 2026"
              />
              <Button
                onClick={async () => {
                  if (!memText.trim()) return;
                  await insertRowFn({
                    data: {
                      token,
                      table: "memories",
                      values: { content: memText, kind: "fact", source: "manual" },
                    },
                  });
                  setMemText("");
                  await refresh();
                  toast.success("Memory added");
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {memories.map((m) => (
              <div key={m.id} className="panel flex items-start justify-between gap-3 p-3">
                <p className="text-sm">{m.content}</p>
                <button
                  onClick={async () => {
                    await deleteRowFn({ data: { token, table: "memories", id: m.id } });
                    await refresh();
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </button>
              </div>
            ))}
            {memories.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing remembered yet. Say “remember …” in chat and it will appear here.
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="goals" className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="e.g. Finish organic chemistry in 30 days"
              />
              <Button
                onClick={async () => {
                  if (!goalText.trim()) return;
                  await insertRowFn({
                    data: {
                      token,
                      table: "goals",
                      values: { title: goalText, status: "active", progress: 0 },
                    },
                  });
                  setGoalText("");
                  await refresh();
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {goals.map((g) => (
              <div key={g.id} className="panel space-y-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p
                    className={`text-sm ${g.status === "done" ? "text-muted-foreground line-through" : ""}`}
                  >
                    {g.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await updateRowFn({
                          data: {
                            token,
                            table: "goals",
                            id: g.id,
                            patch: {
                              status: g.status === "done" ? "active" : "done",
                              progress: g.status === "done" ? 0 : 100,
                            },
                          },
                        });
                        await refresh();
                      }}
                    >
                      <Check
                        className={`size-4 ${g.status === "done" ? "text-success" : "text-muted-foreground"}`}
                      />
                    </button>
                    <button
                      onClick={async () => {
                        await deleteRowFn({ data: { token, table: "goals", id: g.id } });
                        await refresh();
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={g.progress ?? 0}
                  onChange={async (e) => {
                    const progress = Number(e.target.value);
                    setGoals((list) => list.map((x) => (x.id === g.id ? { ...x, progress } : x)));
                    await updateRowFn({
                      data: { token, table: "goals", id: g.id, patch: { progress } },
                    });
                  }}
                  className="w-full accent-[var(--color-primary)]"
                />
              </div>
            ))}
            {goals.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No goals yet.</p>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
