import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";
import { postToThread } from "../../_discord.js";

const VALID = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];

/**
 * POST /api/support/ticket/:id/status
 * { status: "OPEN"|..., notify?: boolean }
 *
 * Updates the ticket status and records it in the audit log. When the ticket
 * has a Discord thread, optionally posts a short status notice into that same
 * thread (default: true) so the user sees the change. RESOLVED sets resolved_at
 * / resolved_by; CLOSED sets closed_at.
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const newStatus = body.status;
  if (!VALID.includes(newStatus)) return json({ message: "Invalid status." }, 400);
  const notify = body.notify !== false;

  const [ticketRes] = await db.select("support_tickets", `id=eq.${ticketId}&select=id,public_number,discord_thread_id,status,resolved_by`);
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  const nowIso = new Date().toISOString();
  const patch = { status: newStatus, updated_at: nowIso, last_activity_at: nowIso };

  if (newStatus === "RESOLVED") {
    patch.resolved_at = nowIso;
    patch.resolved_by = session.discordId;
    patch.first_response_at = patch.first_response_at ?? nowIso;
  } else if (newStatus === "CLOSED") {
    patch.closed_at = nowIso;
    // If we're closing from resolved, resolved_at already set.
  } else {
    patch.closed_at = null;
    patch.reopened_at = patch.reopened_at ?? (ticket.status === "RESOLVED" || ticket.status === "CLOSED" ? nowIso : undefined);
  }

  await db.update("support_tickets", "id", ticketId, patch);

  // Optionally notify in Discord.
  let posted = false;
  if (notify && ticket.discord_thread_id) {
    try {
      await postToThread(env, ticket.discord_thread_id, {
        content: `**Status updated:** ${ticket.status} → **${newStatus}**`,
        embeds: [],
      });
      posted = true;
    } catch (err) {
      console.error("[om-support] Status Discord post failed:", err);
    }
  }

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: "status_changed",
    metadata: { from: ticket.status, to: newStatus, notify, posted },
  });

  return json({ ok: true, status: newStatus, posted });
}
