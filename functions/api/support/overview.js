import { json, requireSession } from "./_session.js";
import { supabase } from "./_supabase.js";

/**
 * GET /api/support/overview?staff=<discordId>
 * Returns dashboard headline stats + recent tickets/activity for the Overview
 * page. All reads are scoped to the service-role key (server-side).
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const staffId = session.discordId;
  const open = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER"];

  // Counts by status/priority. (Headcount via separate lightweight queries below.)
  const [openRes] = await db.select("support_tickets", "status=in.(OPEN,IN_PROGRESS,WAITING_FOR_USER)&select=id");
  const openCount = Array.isArray(openRes.body) ? openRes.body.length : 0;

  const [unassignedRes] = await db.select(
    "support_tickets",
    "status=in.(OPEN,IN_PROGRESS,WAITING_FOR_USER)&assigned_to=is.null&select=id",
  );
  const unassignedCount = Array.isArray(unassignedRes.body) ? unassignedRes.body.length : 0;

  const [myRes] = await db.select(
    "support_tickets",
    `status=in.(OPEN,IN_PROGRESS,WAITING_FOR_USER)&assigned_to=eq.${staffId}&select=id`,
  );
  const myCount = Array.isArray(myRes.body) ? myRes.body.length : 0;

  const [waitingRes] = await db.select(
    "support_tickets",
    "status=eq.WAITING_FOR_USER&select=id",
  );
  const waitingCount = Array.isArray(waitingRes.body) ? waitingRes.body.length : 0;

  const [highRes] = await db.select(
    "support_tickets",
    "status=in.(OPEN,IN_PROGRESS,WAITING_FOR_USER)&priority=eq.HIGH&select=id",
  );
  const [urgentRes] = await db.select(
    "support_tickets",
    "status=in.(OPEN,IN_PROGRESS,WAITING_FOR_USER)&priority=eq.URGENT&select=id",
  );

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [resolvedTodayRes] = await db.select(
    "support_tickets",
    `status=eq.RESOLVED&resolved_at=gte.${todayStart.toISOString()}&select=id`,
  );

  // Average first-response time: the gap between opened_at and first_response_at
  // for tickets that have received a first response.
  let avgResponseSeconds = null;
  const [firstResRes] = await db.select(
    "support_tickets",
    "first_response_at=not.is.null&select=opened_at,first_response_at",
  );
  if (Array.isArray(firstResRes.body) && firstResRes.body.length) {
    let total = 0;
    let count = 0;
    for (const row of firstResRes.body) {
      const t0 = Date.parse(row.opened_at);
      const t1 = Date.parse(row.first_response_at);
      if (!Number.isNaN(t0) && !Number.isNaN(t1) && t1 >= t0) {
        total += (t1 - t0) / 1000;
        count++;
      }
    }
    if (count) avgResponseSeconds = Math.round(total / count);
  }

  // Recent tickets (most recently created).
  const [recentRes] = await db.select(
    "support_tickets",
    "select=*,assigned:support_staff!support_tickets_assigned_to_fkey(discord_id,display_name,discord_username)&order=created_at.desc&limit=8",
  );

  // Recent activity (audit log).
  const [activityRes] = await db.select(
    "support_audit_log",
    "select=id,action,actor_name,metadata,created_at,ticket_id&order=created_at.desc&limit=10",
  );
  const activity = Array.isArray(activityRes.body)
    ? activityRes.body
    : [];
  // Attach each ticket's public number for readable activity entries.
  const withNumbers = await Promise.all(
    activity.map(async (entry) => {
      if (!entry.ticket_id) return { ...entry, ticketNumber: null };
      const [t] = await db.select("support_tickets", `id=eq.${entry.ticket_id}&select=public_number,subject`);
      const ticket = Array.isArray(t.body) ? t.body[0] : null;
      return { ...entry, ticketNumber: ticket?.public_number ?? null, ticketSubject: ticket?.subject ?? null };
    }),
  );

  return json({
    counts: {
      open: openCount,
      unassigned: unassignedCount,
      mine: myCount,
      waitingForUser: waitingCount,
      highPriority: Array.isArray(highRes.body) ? highRes.body.length : 0,
      urgent: Array.isArray(urgentRes.body) ? urgentRes.body.length : 0,
      resolvedToday: Array.isArray(resolvedTodayRes.body) ? resolvedTodayRes.body.length : 0,
    },
    avgResponseSeconds,
    recentTickets: recentRes.body ?? [],
    activity: withNumbers,
  });
}
