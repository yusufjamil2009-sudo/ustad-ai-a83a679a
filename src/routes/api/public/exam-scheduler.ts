/**
 * Scheduled paper delivery. Called by the platform cron (or any scheduler)
 * with the shared secret; publishes papers whose window has opened and
 * auto-submits attempts whose time expired.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runSchedulerTick } from "@/lib/exam-engine.server";

export const Route = createFileRoute("/api/public/exam-scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["LOVABLE_CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");
        if (!secret || provided !== secret) return new Response("Unauthorized", { status: 401 });
        try {
          const report = await runSchedulerTick();
          return Response.json({ ok: true, ...report });
        } catch (error) {
          console.error(error);
          return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
        }
      },
    },
  },
});
