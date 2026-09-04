import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";

/**
 * POST /api/support/ticket/:id/assign
 * { assigneeDiscordId: string | null }
 *
 * Assigns (or unassigns) a staff member to the ticket. If the target assignee
 * isn't already a known staff member, we record a lightweight row so the name
 * can be shown.
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const assigneeDiscordId = body.assigneeDiscordId ?? null;
  if (assigneeDiscordId !== null && typeof assigneeDiscordId !== "string") {
    return json({ message: "Invalid assignee." }, 400);
  }

  const [ticketRes] = await db.select("support_tickets", `id=eq.${ticketId}&select=id,assigned_to`);
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  await db.update("support_tickets", "id", ticketId, {
    assigned_to: assigneeDiscordId,
    assigned_at: assigneeDiscordId ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  });

  // Ensure the assignee exists in support_staff (join projection needs it).
  if (assigneeDiscordId) {
    const [existing] = await db.select("support_staff", `discord_id=eq.${assigneeDiscordId}&select=discord_id`);
    if (!Array.isArray(existing.body) || !existing.body.length) {
      await db.insert("support_staff", {
        discord_id: assigneeDiscordId,
        role: "SUPPORT",
        display_name: body.assigneeName ?? null,
      }).catch(() => undefined);
    }
  }

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: assigneeDiscordId ? (ticket.assigned_to ? "ticket_reassigned" : "ticket_assigned") : "ticket_unassigned",
    metadata: { assignee: assigneeDiscordId, from: ticket.assigned_to ?? null },
  });

  return json({ ok: true, assignedTo: assigneeDiscordId });
}
