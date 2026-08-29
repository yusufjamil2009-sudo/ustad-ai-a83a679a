import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, KeyRound, User, Sliders, ShieldAlert, Trash2, Plug } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ThemeSwitch } from "@/components/ThemeSwitch";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROVIDERS, CATEGORIES, STATUS_LABELS } from "@/lib/providers";
import { useGuest, shortId } from "@/lib/ustad-client";
import { useSettings, saveProfilePatch } from "@/lib/settings-store";
import {
  listApiConfigsFn,
  saveApiConfigFn,
  testApiConfigFn,
  deleteApiConfigFn,
  saveProfileFn,
  saveSettingsFn,
  clearCacheFn,
  clearDataFn,
} from "@/lib/ustad-api";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & API Manager | USTAD AI" },
      {
        name: "description",
        content:
          "Connect 27+ AI, search, voice and database providers, tune your profile, and control your guest data.",
      },
      { property: "og:title", content: "Settings & API Manager — USTAD AI" },
      {
        property: "og:description",
        content: "Bring your own keys, personalise USTAD, and manage your private data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type ConfigState = {
  provider: string;
  status: string;
  statusDetail: string | null;
  models: string[];
  latencyMs: number | null;
  filled: Record<string, unknown>;
};

function SettingsPage() {
  const { token, session, ready, status, error, retry } = useGuest();
  return (
    <AppShell>
      <PageHeader
        title="Settings"
        subtitle="Your keys, your profile, your data — all stored under your guest ID."
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {!ready ? (
          <div className="panel mx-auto mb-4 flex max-w-4xl items-center gap-2 p-4 text-sm text-muted-foreground">
            {status === "error" ? (
              <>
                <span>Your guest workspace could not be reached.</span>
                <Button size="sm" variant="secondary" onClick={retry}>
                  Retry
                </Button>
                {error ? <span className="text-xs">{error}</span> : null}
              </>
            ) : (
              <>
                <Loader2 className="size-4 animate-spin" /> Restoring your guest workspace…
              </>
            )}
          </div>
        ) : null}
        <Tabs defaultValue="apis" className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger value="apis">
              <KeyRound className="mr-1 size-4" /> API Manager
            </TabsTrigger>
            <TabsTrigger value="profile">
              <User className="mr-1 size-4" /> Profile
            </TabsTrigger>
            <TabsTrigger value="prefs">
              <Sliders className="mr-1 size-4" /> Preferences
            </TabsTrigger>
            <TabsTrigger value="data">
              <ShieldAlert className="mr-1 size-4" /> Data
            </TabsTrigger>
          </TabsList>

          <TabsContent value="apis" className="mt-4">
            {ready ? <ApiManager token={token} /> : null}
          </TabsContent>
          <TabsContent value="profile" className="mt-4">
            <ProfilePanel initial={(session?.profile ?? null) as Record<string, unknown> | null} />
          </TabsContent>
          <TabsContent value="prefs" className="mt-4">
            <PrefsPanel />
          </TabsContent>
          <TabsContent value="data" className="mt-4">
            <DataPanel token={token} guestId={session?.guestId ?? ""} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ApiManager({ token }: { token: string }) {
  const [configs, setConfigs] = useState<ConfigState[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("All");

  const refresh = async () => {
    if (!token) return;
    setConfigs((await listApiConfigsFn({ data: { token } })) as unknown as ConfigState[]);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const list = PROVIDERS.filter(
    (p) => category === "All" || p.categories.includes(category as never),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {["All", ...CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              category === c
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2 text-muted-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((def) => {
          const state = configs.find((c) => c.provider === def.id);
          const status = state?.status ?? "not_configured";
          const tone =
            status === "connected"
              ? "text-success"
              : status === "failed"
                ? "text-destructive"
                : status === "not_configured"
                  ? "text-muted-foreground"
                  : "text-warning";
          return (
            <div key={def.id} className="panel space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{def.name}</p>
                  <p className="text-xs text-muted-foreground">{def.categories.join(" · ")}</p>
                </div>
                <span className={`text-xs ${tone}`}>{STATUS_LABELS[status] ?? status}</span>
              </div>
              {state?.statusDetail ? (
                <p className="text-xs text-muted-foreground">{state.statusDetail}</p>
              ) : null}
              {state?.models?.length ? (
                <p className="text-[11px] text-muted-foreground">
                  {state.models.slice(0, 3).join(", ")}
                </p>
              ) : null}

              {open === def.id ? (
                <div className="space-y-2 pt-2">
                  {def.fields.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">
                        {f.label}
                        {f.required ? " *" : ""}
                      </Label>
                      <Input
                        type={f.secret ? "password" : "text"}
                        value={draft[f.key] ?? ""}
                        placeholder={(state?.filled?.[f.key] as string) || f.placeholder || ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={busy === def.id}
                      onClick={async () => {
                        setBusy(def.id);
                        try {
                          await saveApiConfigFn({
                            data: { token, provider: def.id, config: draft },
                          });
                          const res = await testApiConfigFn({ data: { token, provider: def.id } });
                          toast[res.status === "connected" ? "success" : "error"](res.detail);
                          setDraft({});
                          setOpen(null);
                          await refresh();
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === def.id ? (
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                      ) : (
                        <Plug className="mr-1 size-3.5" />
                      )}
                      Save & test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                      Cancel
                    </Button>
                    {status !== "not_configured" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await deleteApiConfigFn({ data: { token, provider: def.id } });
                          await refresh();
                        }}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setOpen(def.id);
                      setDraft({});
                    }}
                  >
                    {status === "not_configured" ? "Connect" : "Edit"}
                  </Button>
                  {status !== "not_configured" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === def.id}
                      onClick={async () => {
                        setBusy(def.id);
                        const res = await testApiConfigFn({ data: { token, provider: def.id } });
                        toast[res.status === "connected" ? "success" : "error"](res.detail);
                        setBusy(null);
                        await refresh();
                      }}
                    >
                      Test
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfilePanel({ initial }: { initial: Record<string, unknown> | null }) {
  const [form, setForm] = useState<{
    name: string;
    age: string;
    education: string;
    interests: string;
    language: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // persisted value → state (never default → overwrite persisted)
  useEffect(() => {
    if (!initial || form) return;
    setForm({
      name: String(initial["name"] ?? ""),
      age: initial["age"] == null ? "" : String(initial["age"]),
      education: String(initial["education"] ?? ""),
      interests: String(initial["interests"] ?? ""),
      language: String(initial["language"] ?? "english"),
    });
  }, [initial, form]);

  return (
    <>
      <div className="panel mb-4 space-y-2 p-5">
        <Label>Appearance</Label>
        <p className="text-xs text-muted-foreground">
          Choose light, dark or follow your system. Saved on this device.
        </p>
        <ThemeSwitch showLabels />
      </div>
      <div className="panel space-y-3 p-5">
        {!form ? (
          <p className="text-sm text-muted-foreground">Loading your profile…</p>
        ) : (
          <>
            {[
              ["name", "Your name"],
              ["age", "Age"],
              ["education", "Class / Education"],
              ["interests", "Interests"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label>{label}</Label>
                <Input
                  value={form[k as keyof typeof form]}
                  onChange={(e) => setForm((f) => (f ? { ...f, [String(k)]: e.target.value } : f))}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Preferred language</Label>
              <select
                value={form.language}
                onChange={(e) => setForm((f) => (f ? { ...f, language: e.target.value } : f))}
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {["english", "hindi", "hinglish"].map((l) => (
                  <option key={l} value={l} className="bg-surface">
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveProfilePatch({ ...form, age: form.age ? Number(form.age) : null });
                  toast.success("Profile saved");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save profile
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function PrefsPanel() {
  const { settings, ready, update } = useSettings();

  const change = async (patch: Record<string, unknown>) => {
    try {
      await update(patch as never);
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!ready || !settings) {
    return <div className="panel p-5 text-sm text-muted-foreground">Loading your preferences…</div>;
  }
  const prefs = settings;

  return (
    <div className="panel space-y-4 p-5">
      <div className="space-y-1">
        <Label>Reply language</Label>
        <select
          value={prefs.language}
          onChange={(e) => void change({ language: e.target.value })}
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {["english", "hindi", "hinglish"].map((l) => (
            <option key={l} value={l} className="bg-surface">
              {l}
            </option>
          ))}
        </select>
        {prefs.timezone ? (
          <p className="text-xs text-muted-foreground">Time zone: {prefs.timezone}</p>
        ) : null}
      </div>
      {[
        ["data_saver", "Data saver (shorter replies)"],
        ["auto_speak", "Auto read answers aloud"],
        ["web_search", "Allow live web search"],
      ].map(([k, label]) => (
        <div key={k} className="flex items-center justify-between">
          <Label>{label}</Label>
          <Switch
            checked={Boolean(prefs[k as keyof typeof prefs])}
            onCheckedChange={(v) => void change({ [String(k)]: v })}
          />
        </div>
      ))}
    </div>
  );
}

function DataPanel({ token, guestId }: { token: string; guestId: string }) {
  const scopes = [
    "conversations",
    "notes",
    "memories",
    "goals",
    "reminders",
    "lessons",
    "exams",
    "attachments",
  ];
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <div className="panel space-y-4 p-5">
      <div>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">Your guest ID</p>
        <p className="font-mono text-sm">{guestId ? shortId(guestId) : "…"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          All your data is isolated to this ID. No login, no signup, nothing shared with other
          guests.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => (
          <button
            key={s}
            onClick={() =>
              setSelected((sel) => (sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s]))
            }
            className={`rounded-full px-3 py-1 text-xs ${
              selected.includes(s)
                ? "bg-destructive text-destructive-foreground"
                : "bg-surface-2 text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await clearCacheFn({ data: { token } });
            toast.success("Cache cleared");
          }}
        >
          Clear cache
        </Button>
        <Button
          variant="destructive"
          disabled={selected.length === 0}
          onClick={async () => {
            await clearDataFn({ data: { token, scopes: selected } });
            setSelected([]);
            toast.success("Selected data deleted");
          }}
        >
          Delete selected
        </Button>
      </div>
    </div>
  );
}
