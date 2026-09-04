import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";
import { postToThread } from "../../_discord.js";

/**
 * POST /api/support/ticket/:id/retry
 * { outboxId?: string }
 *
 * Retries delivery of one or all of a ticket's pending outbox replies — staff
 * replies that previously failed to post to Discord (delivered_to_discord=false,
 * is_internal_note=false). Posting succeeds only if the ticket still has a
 * Discord thread. On success the item is marked delivered; if it still cannot be
 * posted it remains queued (delivery_status stays pending).
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const outboxId = typeof body.outboxId === "string" ? body.outboxId : null;

  const [ticketRes] = await db.select(
    "support_tickets",
    `id=eq.${ticketId}&select=id,public_number,discord_thread_id,last_activity_at`,
  );
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  const threadId = ticket.discord_thread_id;

  // Load the pending outbox items (optionally just one by its stored uuid).
  let p = `ticket_id=eq.${ticketId}&is_internal_note=eq.false&delivered_to_discord=eq.false&select=id,ticket_id,discord_channel_id,author_discord_id,author_name,content,created_at&order=created_at.asc`;
  if (outboxId) p += `&id=eq.${outboxId}`;
  const [res] = await db.select("support_ticket_messages", p);
  const pending = Array.isArray(res.body) ? res.body : [];

  const results = [];
  for (const item of pending) {
    try {
      if (!threadId) throw new Error("Ticket has no Discord thread.");
      const discordMessageId = await postToThread(env, threadId, { content: item.content, embeds: [] });
      // Mark delivered now that it has actually reached Discord.
      await db.update("support_ticket_messages", "id", item.id, {
        delivered_to_discord: true,
        discord_message_id: discordMessageId,
        discord_channel_id: threadId,
      });
      results.push({ id: item.id, delivered: true, discordMessageId });
    } catch (err) {
      console.error("[om-support] Outbox retry failed:", err);
      results.push({ id: item.id, delivered: false, error: "Discord unavailable" });
    }
  }

  const deliveredCount = results.filter((r) => r.delivered).length;

  // Reflect fresh activity if anything reached Discord.
  if (deliveredCount > 0) {
    await db
      .update("support_tickets", "id", ticketId, {
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: "outbox_retry",
    metadata: { attempted: results.length, delivered: deliveredCount },
  });

  return json({ ok: true, attempted: results.length, delivered: deliveredCount, results });
}
