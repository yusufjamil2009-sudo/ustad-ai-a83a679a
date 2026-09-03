/**
 * PART 9 — Cron entry point for event reminders (spec §27).
 *
 * Reuses the EXISTING scheduled-job convention in this repo: same shared-secret
 * header and same shape as `/api/public/exam-scheduler`, so deployments keep a
 * single cron mechanism rather than gaining a second one.
 *
 * Because it is driven by the platform cron, 3-day / 2-day / 1-day / LIVE
 * reminders are delivered whether or not anybody has the app open.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runNotificationSchedulerTick } from "@/lib/notification-scheduler.server";

export const Route = createFileRoute("/api/public/notification-scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["LOVABLE_CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");
        if (!secret || provided !== secret) return new Response("Unauthorized", { status: 401 });
        try {
          const report = await runNotificationSchedulerTick();
          return Response.json({ ok: true, ...report });
        } catch (error) {
          console.error(error);
          return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
        }
      },
    },
  },
});
