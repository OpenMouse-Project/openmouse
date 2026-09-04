// Lazy auto-reopen helper.
//
// There is no persistent Discord gateway anymore (everything runs on Cloudflare
// Pages Functions), so we cannot reopen a ticket the instant a user replies.
// Instead, this helper runs whenever the dashboard reads or polls a ticket: it
// checks the newest Discord messages and, if the ORIGINAL user has replied to a
// RESOLVED/CLOSED ticket AFTER it was closed, reopens it. The reopen is decided
// from timestamps, so it fires at most once per real user reply.

import { supabase } from "./_supabase.js";
import { getMessages, postToThread } from "./_discord.js";
import { isWhitelisted } from "./_session.js";

/**
 * @param env Cloudflare env
 * @param ticket the support_tickets row
 * @returns true if the ticket was reopened by this call
 */
export async function maybeLazyReopen(env, ticket) {
  if (!ticket) return false;
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") return false;
  const threadId = ticket.discord_thread_id;
  if (!threadId) return false;

  let messages;
  try {
    // Newest-first, top of the thread. Enough to inspect the latest activity.
    messages = await getMessages(env, threadId, { limit: 10 });
  } catch (err) {
    console.error("[om-support] Reopen check: failed to read thread:", err);
    return false;
  }
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const newest = messages[0];
  if (!newest.author || newest.author.bot) return false;
  if (isWhitelisted(env, newest.author.id)) return false;
  if (newest.author.id !== ticket.user_discord_id) return false;

  // Only reopen if the reply came after the ticket was closed/resolved (or after
  // the last known activity), so an old thread's history doesn't re-trigger it.
  const replyAt = new Date(newest.timestamp ?? newest.created_timestamp ?? 0).getTime();
  const closedAt = new Date(ticket.closed_at ?? ticket.last_activity_at ?? 0).getTime();
  if (!replyAt || replyAt < closedAt) return false;

  const db = supabase(env);
  const nowIso = new Date().toISOString();
  await db.update("support_tickets", "id", ticket.id, {
    status: "OPEN",
    reopened_at: nowIso,
    closed_at: null,
    updated_at: nowIso,
    last_activity_at: nowIso,
  }).catch((err) => console.error("[om-support] Failed to reopen ticket:", err));

  // Notify in the thread that the ticket was reopened.
  await postToThread(env, threadId, { content: "📥 This ticket was **reopened** because you replied. A staff member will get back to you.", embeds: [] }).catch(() => undefined);
  return true;
}
