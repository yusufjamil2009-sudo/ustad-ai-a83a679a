import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  MessageSquare,
  GraduationCap,
  NotebookPen,
  Brain,
  BellRing,
  Boxes,
  Settings,
  Sparkles,
  ClipboardList,
} from "lucide-react";
import { useGuest, shortId } from "@/lib/ustad-client";
import { ThemeSwitch } from "@/components/ThemeSwitch";

const NAV = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/study", label: "Study", icon: GraduationCap },
  { to: "/exams", label: "Exams", icon: ClipboardList },
  { to: "/notes", label: "Notes", icon: NotebookPen },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/reminders", label: "Reminders", icon: BellRing },
  { to: "/classroom", label: "Classroom", icon: Boxes },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useGuest();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-[100dvh] w-full flex-col md:flex-row">
      <aside className="sticky top-0 z-30 flex shrink-0 flex-row items-center gap-1 border-b border-sidebar-border bg-sidebar/95 px-2 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] backdrop-blur md:h-screen md:w-60 md:flex-col md:items-stretch md:gap-2 md:border-r md:border-b-0 md:px-4 md:py-5">
        <Link to="/" className="flex items-center gap-2 md:mb-6" aria-label="USTAD AI home">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card ring-1 ring-border">
            <UstadLogo className="size-7" priority />
          </span>
          <span className="hidden flex-col leading-tight md:flex">
            <span className="font-display text-base font-semibold gold-text">USTAD AI</span>
            <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
              Your personal ustad
            </span>
          </span>
        </Link>

        {/*
         * Mobile: horizontally scrollable icon+label rail. Labels are always
         * rendered below sm so the feature is never anonymous on a small
         * screen; hide-scrollbar keeps the rail clean while remaining
         * scrollable (touch). Desktop: vertical full-label sidebar.
         */}
        <nav
          aria-label="Primary"
          className="hide-scrollbar flex flex-1 flex-row items-stretch gap-1 overflow-x-auto overscroll-x-contain md:flex-col md:overflow-visible"
        >
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors md:justify-start ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0 md:size-4" />
                <span className="text-xs sm:text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="md:hidden">
          <ThemeSwitch />
        </div>

        <div className="hidden md:block">
          <ThemeSwitch />
          <div className="mt-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2">
            <p className="text-[10px] tracking-widest text-muted-foreground uppercase">Guest</p>
            <p className="font-mono text-xs text-foreground">
              {session ? shortId(session.guestId) : "……"}
            </p>
          </div>
          <p className="mt-3 text-center text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            Developer by Yusuf Ali
          </p>
        </div>
      </aside>

      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 md:px-8">
      <div>
        <h1 className="text-xl font-semibold md:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}
