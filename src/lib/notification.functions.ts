/**
 * PART 9 — Notification Center server function boundary.
 *
 * The client may: read ITS OWN feed, read its own unread count, mark its own
 * notifications read, and list upcoming events.
 *
 * The client may never supply: a guest id, a user id, a title, a message, an
 * amount, a timestamp, a language, or a notification of any kind. There is no
 * "create notification" function exposed here at all — notifications are only
 * ever produced server-side by a real transaction or by the cron scheduler
 * (spec §37, §44).
 */
import { createServerFn } from "@tanstack/react-start";
import * as notifications from "./notification.server";

/** One page of this guest's own activity history. */
export const notificationFeedFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; filter?: string; cursor?: string | null }) => d)
  .handler(async ({ data: d }) =>
    notifications.listNotifications({
      token: d.token,
      filter: (d.filter ?? "all") as notifications.FeedFilter,
      cursor: d.cursor ?? null,
    }),
  );

/** Unread badge count, read from the database (spec §6). */
export const notificationUnreadFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => ({ unread: await notifications.getUnreadCount(d.token) }));

/** Mark a single notification read; ownership is checked server-side. */
export const notificationMarkReadFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; id: string }) => d)
  .handler(async ({ data: d }) => notifications.markRead({ token: d.token, id: d.id }));

export const notificationMarkAllReadFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => notifications.markAllRead(d.token));

/** Upcoming events from the existing Master Event Engine. */
export const upcomingEventsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => notifications.listUpcomingEvents(d.token));
