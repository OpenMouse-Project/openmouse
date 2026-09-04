import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";
import { postToThread } from "../../_discord.js";

const VALID = ["LOW", "NORMAL", "HIGH", "URGENT"];

/**
 * POST /api/support/ticket/:id/priority
 * { priority: "LOW"|"NORMAL"|"HIGH"|"URGENT", notify?: boolean }
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const newPriority = body.priority;
  if (!VALID.includes(newPriority)) return json({ message: "Invalid priority." }, 400);
  const notify = body.notify !== false;

  const [ticketRes] = await db.select("support_tickets", `id=eq.${ticketId}&select=id,priority,discord_thread_id`);
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  await db.update("support_tickets", "id", ticketId, {
    priority: newPriority,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  });

  let posted = false;
  if (notify && ticket.discord_thread_id) {
    try {
      await postToThread(env, ticket.discord_thread_id, {
        content: `**Priority updated:** ${ticket.priority} → **${newPriority}**`,
        embeds: [],
      });
      posted = true;
    } catch (err) {
      console.error("[om-support] Priority Discord post failed:", err);
    }
  }

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: "priority_changed",
    metadata: { from: ticket.priority, to: newPriority, notify, posted },
  });

  return json({ ok: true, priority: newPriority, posted });
}
