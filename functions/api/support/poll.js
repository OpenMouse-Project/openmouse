import { json, requireSession, isWhitelisted } from "./_session.js";
import { supabase } from "./_supabase.js";
import { getMessagesAfter, mapDiscordMessage, postToThread } from "./_discord.js";
import { maybeLazyReopen } from "./_reopen.js";

/**
 * GET /api/support/poll?after=<messageId>&ticket=<ticketId>
 *
 * Lightweight polling feed so the dashboard reflects new conversation activity
 * and ticket/status/assignment/priority changes without a manual refresh.
 *
 * Because Discord is the source of truth for the conversation, new messages are
 * read from Discord by message-id cursor (`after` = the newest message id the
 * client already has). Discord pages by id, not timestamp, so this replaces the
 * old `since=<iso>` timestamp cursor.
 *
 * Stored (Supabase) staff-only items that may also have appeared since the last
 * fetch are returned too: new internal notes and newly-delivered outbox replies.
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const ticketId = url.searchParams.get("ticket");
  if (!ticketId) return json({ message: "ticket is required." }, 400);

  const db = supabase(env);
  const nowIso = new Date().toISOString();

  // Ticket-level state changes (status/priority/assignment/etc. live in Supabase).
  const [ticketRes] = await db.select(
    "support_tickets",
    `id=eq.${ticketId}&select=status,priority,assigned_to,last_activity_at,updated_at,first_response_at,resolved_at,closed_at,user_discord_id,discord_thread_id`
  );
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;

  // Lazy auto-reopen: a user's reply to a resolved/closed ticket reopens it.
  let reopened = false;
  if (ticket) {
    try {
      reopened = await maybeLazyReopen(env, ticket);
    } catch (err) {
      console.error("[om-support] Poll reopen check failed:", err);
    }
  }

  // New staff-only items in Supabase (internal notes + newly delivered outbox).
  const [storedRes] = await db.select(
    "support_ticket_messages",
    `ticket_id=eq.${ticketId}&created_at=gt.${encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString())}&select=*&order=created_at.asc`
  );
  const storedNew = (Array.isArray(storedRes.body) ? storedRes.body : []).map((m) => ({
    id: `ln:${m.id}`,
    content: m.content,
    message_type: m.message_type || "STAFF",
    source: "dashboard",
    author_discord_id: m.author_discord_id,
    author_name: m.author_name,
    is_internal_note: !!m.is_internal_note,
    delivered_to_discord: !!m.delivered_to_discord,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    created_at: m.created_at,
  }));

  // Auto-retry: atomically claim and deliver ONE pending outbox reply so queued
  // staff messages reach Discord as soon as it's reachable again, without any
  // manual step and without risk of double-posting (claim is FOR UPDATE SKIP
  // LOCKED + the row is marked delivered once posted). Best-effort — poll must
  // never fail because a retry failed.
  let retried = 0;
  if (ticket?.discord_thread_id) {
    try {
      const claim = await db.rpc("claim_pending_outbox", { p_ticket: ticketId, p_claimant: "poll" });
      const item = Array.isArray(claim.body) ? claim.body[0] : null;
      if (item) {
        const discordMessageId = await postToThread(env, ticket.discord_thread_id, { content: item.content, embeds: [] });
        await db
          .update("support_ticket_messages", "id", item.id, {
            delivered_to_discord: true,
            discord_message_id: discordMessageId,
            discord_channel_id: ticket.discord_thread_id,
          })
          .catch(() => undefined);
        retried = 1;
      }
    } catch (err) {
      // A failed retry must not break polling; the outbox retains the item and
      // it will be claimed again once the transient condition clears.
      console.error("[om-support] Auto-retry failed:", err);
    }
  }

  // New Discord conversation messages since the message-id cursor.
  let discordMessages = [];
  const threadId = ticket?.discord_thread_id;
  if (after && threadId) {
    try {
      const isStaffAuthor = (authorId) => isWhitelisted(env, authorId);
      discordMessages = (await getMessagesAfter(env, threadId, after))
        .map((m) => mapDiscordMessage(m, isStaffAuthor))
        .reverse(); // newest-first -> oldest-first for append
    } catch (err) {
      console.error("[om-support] Poll read from Discord failed:", err);
    }
  }

  if (reopened && ticket) ticket.status = "OPEN";

  return json({
    messages: [...storedNew, ...discordMessages].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    ),
    ticket,
    serverTime: nowIso,
    retried,
    reopened,
  });
}
