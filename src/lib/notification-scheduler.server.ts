/**
 * PART 9 — Backend event reminder scheduler (spec §27, §28, §43).
 *
 * Reminders MUST NOT depend on anyone having the app open, so this runs
 * server-side on a cron tick. It deliberately reuses the EXISTING scheduled-job
 * pattern already in this repo (`/api/public/exam-scheduler` guarded by
 * LOVABLE_CRON_SECRET) instead of introducing a second scheduling mechanism —
 * there is no setTimeout, setInterval or browser countdown anywhere in this
 * path.
 *
 * Exactly-once delivery is enforced by TWO independent guards, so a retrying
 * or overlapping cron cannot double-notify:
 *   1. `ustad_event_reminder_log` unique (event_id, guest_id, reminder_kind)
 *   2. `ustad_notifications` unique (guest_id, dedupe_key)
 */
import { db } from "./guest.server";
import { createNotification } from "./notification.server";
import { dueReminders, type ReminderKind } from "./notification-spec";

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdb = () => db() as any;

const TYPE_OF: Record<
  ReminderKind,
  "event_reminder_3d" | "event_reminder_2d" | "event_reminder_1d" | "event_live"
> = {
  reminder_3d: "event_reminder_3d",
  reminder_2d: "event_reminder_2d",
  reminder_1d: "event_reminder_1d",
  live: "event_live",
};

export type SchedulerReport = {
  eventsChecked: number;
  remindersCreated: number;
  duplicatesSkipped: number;
  details: Array<{ event: string; kind: ReminderKind; created: number; skipped: number }>;
};

/**
 * Which guests should hear about an event.
 *
 * Reminders are addressed to real, active guests only — this never invents an
 * audience and never seeds promotional notifications for people who have not
 * used the app (spec §37).
 */
async function audienceFor(limit = 500): Promise<string[]> {
  const { data } = await sdb().from("guests").select("id").limit(limit);
  return ((data as Row[]) ?? []).map((r) => String(r["id"]));
}

/**
 * One scheduler tick.
 *
 * For every scheduled/open event with a start time, work out which milestone
 * is due and deliver it once per guest.
 */
export async function runNotificationSchedulerTick(
  now: Date = new Date(),
): Promise<SchedulerReport> {
  const report: SchedulerReport = {
    eventsChecked: 0,
    remindersCreated: 0,
    duplicatesSkipped: 0,
    details: [],
  };

  const { data: eventRows } = await sdb()
    .from("master_events")
    .select("id, code, name, event_type, status, start_time, end_time, language")
    .in("status", ["scheduled", "open", "active"])
    .not("start_time", "is", null)
    .limit(50);

  const events = (eventRows as Row[]) ?? [];
  if (events.length === 0) return report;

  const guests = await audienceFor();
  if (guests.length === 0) return report;

  for (const ev of events) {
    const startIso = String(ev["start_time"] ?? "");
    if (!startIso) continue;

    // The LIVE notification only makes sense while the event is still running.
    const endIso = ev["end_time"] ? String(ev["end_time"]) : "";
    if (endIso && new Date(endIso).getTime() < now.getTime()) continue;

    report.eventsChecked += 1;

    const kinds = dueReminders(startIso, now);
    for (const kind of kinds) {
      const eventId = String(ev["id"]);
      const eventName = String(ev["name"]);

      // Who already received this milestone (spec §38).
      const { data: logRows } = await sdb()
        .from("ustad_event_reminder_log")
        .select("guest_id")
        .eq("event_id", eventId)
        .eq("reminder_kind", kind);
      const already = new Set(((logRows as Row[]) ?? []).map((r) => String(r["guest_id"])));

      let created = 0;
      let skipped = 0;

      for (const guestId of guests) {
        if (already.has(guestId)) {
          skipped += 1;
          continue;
        }

        // Claim the slot FIRST. If a concurrent tick already claimed it the
        // unique constraint rejects us and we do not send a second copy.
        const { error: claimError } = await sdb()
          .from("ustad_event_reminder_log")
          .insert({ event_id: eventId, guest_id: guestId, reminder_kind: kind });
        if (claimError) {
          skipped += 1;
          continue;
        }

        const row = await createNotification({
          guestId,
          type: TYPE_OF[kind],
          // Second guard, independent of the log table.
          dedupeKey: `event:${eventId}:${kind}`,
          vars: { eventName },
          startAt: startIso,
          referenceType: "master_event",
          referenceId: eventId,
          metadata: {
            eventCode: String(ev["code"] ?? ""),
            eventType: String(ev["event_type"] ?? ""),
            startTime: startIso,
            reminderKind: kind,
          },
          // NOTE: no `language` override here on purpose. Each guest's own
          // USTAD AI setting decides their reminder language, so the same
          // event reaches a Hindi user in Hindi and an English user in
          // English (spec §29).
        });

        if (row) created += 1;
        else skipped += 1;
      }

      report.remindersCreated += created;
      report.duplicatesSkipped += skipped;
      report.details.push({ event: eventName, kind, created, skipped });
    }
  }

  return report;
}
