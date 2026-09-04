import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";
import { postToThread } from "../../_discord.js";

/**
 * POST /api/support/ticket/:id/reply
 * { content: string }
 *
 * Posts a staff reply into the *existing* ticket thread via the bot token.
 * Discord is the source of truth for the conversation, so a successfully posted
 * reply is NOT stored in Supabase — it is simply read back from Discord.
 *
 * If Discord is unavailable (API failure, thread deleted, missing permission),
 * the reply is written to a Supabase "outbox" row (is_internal_note=false,
 * delivered_to_discord=false) so it is never silently lost; staff can retry
 * delivery from the dashboard. Ticket metadata (status, first_response_at,
 * activity) is always updated.
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) return json({ message: "Reply content is required." }, 400);
  if (content.length > 2000) return json({ message: "Reply is too long (2000 max)." }, 400);
  if (/@(everyone|here)\b/i.test(content)) {
    // Prevent mention spam / pings from the dashboard.
    return json({ message: "@everyone/@here mentions are not allowed." }, 400);
  }

  const [ticketRes] = await db.select(
    "support_tickets",
    `id=eq.${ticketId}&select=id,public_number,subject,discord_thread_id,status,opened_at,first_response_at`,
  );
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  const threadId = ticket.discord_thread_id;

  // Update status to IN_PROGRESS when a staff member responds to an OPEN ticket.
  const statusUpdate =
    ticket.status === "OPEN" || ticket.status === "RESOLVED" || ticket.status === "CLOSED"
      ? { status: ticket.status === "CLOSED" || ticket.status === "RESOLVED" ? ticket.status : "IN_PROGRESS" }
      : {};

  // Post to Discord. The reply is part of the Discord conversation; only queue
  // it locally if Discord is unreachable.
  let discordMessageId = null;
  let posted = false;
  if (threadId) {
    try {
      discordMessageId = await postToThread(env, threadId, { content, embeds: [] });
      posted = true;
    } catch (err) {
      console.error("[om-support] Discord post failed (queuing to outbox):", err);
    }
  }

  const isFirstResponse = ticket.first_response_at == null;
  const nowIso = new Date().toISOString();

  const patch = {
    ...statusUpdate,
    ...(isFirstResponse ? { first_response_at: nowIso } : {}),
    last_activity_at: nowIso,
    updated_at: nowIso,
  };

  // If reopening a closed ticket, clear the closure.
  if (ticket.status === "CLOSED") patch.closed_at = null;

  await db.update("support_tickets", "id", ticketId, patch);

  // If delivery failed, persist an outbox item so the reply is not lost.
  if (!posted) {
    await db.insert("support_ticket_messages", {
      ticket_id: ticketId,
      discord_message_id: null,
      discord_channel_id: threadId,
      author_discord_id: session.discordId,
      author_name: session.name,
      content,
      message_type: "STAFF",
      source: "dashboard",
      staff_discord_id: session.discordId,
      is_internal_note: false,
      delivered_to_discord: false,
      attachments: [],
    });
  }

  // Audit log the staff reply.
  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: "staff_reply",
    metadata: { posted, discordMessageId, queued: !posted },
  });

  return json({
    ok: true,
    posted,
    queued: !posted,
    discordMessageId,
    isFirstResponse,
    status: patch.status ?? ticket.status,
  });
}
