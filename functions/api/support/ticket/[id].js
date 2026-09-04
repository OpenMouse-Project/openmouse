import { json, requireSession, isWhitelisted } from "../_session.js";
import { supabase } from "../_supabase.js";
import { getMessages, mapDiscordMessage } from "../_discord.js";
import { maybeLazyReopen } from "../_reopen.js";

const MAX_CONVERSATION_MESSAGES = 200;
const LAZY_PAGE_SIZE = 100;

/**
 * GET /api/support/ticket/:id?before=<messageId>
 * Returns the ticket detail, plus the conversation which is read LIVE from
 * Discord. Discord is the source of truth for the conversation.
 *
 * Conversation composition:
 *   - Discord messages  -> read from the ticket thread (source of truth).
 *   - Internal notes    -> read from Supabase (never on Discord).
 *   - Pending outbox    -> staff replies not yet delivered to Discord
 *                          (is_internal_note=false, delivered_to_discord=false).
 * The three are merged and sorted chronologically into a single `messages`
 * list in the same shape the dashboard UI expects.
 *
 * Pagination / lazy-load:
 *   - Without `before`: returns the newest window of the conversation (capped
 *     at MAX_CONVERSATION_MESSAGES) plus `hasMoreOlder` so the UI can offer
 *     "load older".
 *   - With `before=<messageId>`: returns the next page of Discord messages
 *     OLDER than that message id (capped at LAZY_PAGE_SIZE), plus
 *     `hasMoreOlder`. Stored notes/outbox are not re-returned here (they were
 *     fully loaded on the initial call).
 *
 * If Discord is unreachable or the thread is gone, `conversationUnavailable`
 * is true and only the stored notes/outbox are returned — ticket metadata,
 * participants and audit still render from Supabase.
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const lazyLoading = !!before;

  const db = supabase(env);
  const ticketId = params.id;

  const [ticketRes] = await db.select(
    "support_tickets",
    `id=eq.${ticketId}&select=*,assigned:support_staff!support_tickets_assigned_to_fkey(discord_id,display_name,discord_username)`,
  );
  const ticket = Array.isArray(ticketRes.body) ? ticketRes.body[0] : null;
  if (!ticket) return json({ message: "Ticket not found." }, 404);

  const [participantsRes] = await db.select(
    "support_ticket_participants",
    `ticket_id=eq.${ticketId}&select=*`,
  );
  const [auditRes] = await db.select(
    "support_audit_log",
    `ticket_id=eq.${ticketId}&select=*&order=created_at.desc`,
  );

  let storedMapped = [];
  let conversationUnavailable = false;
  let discordMapped = [];
  let hasMoreOlder = false;
  const threadId = ticket.discord_thread_id;

  if (lazyLoading) {
    // Only fetch the next older page of the Discord conversation. Stored
    // notes/outbox were already delivered on the initial call.
    if (threadId) {
      try {
        const page = await fetchOlderPage(env, threadId, before, LAZY_PAGE_SIZE);
        const isStaffAuthor = (authorId) => isWhitelisted(env, authorId);
        discordMapped = page.messages.map((m) => mapDiscordMessage(m, isStaffAuthor));
        hasMoreOlder = page.hasMore;
      } catch (err) {
        console.error("[om-support] Failed to read older conversation from Discord:", err);
        conversationUnavailable = true;
      }
    }
  } else {
    // The staff-only content that lives in Supabase (notes + pending outbox).
    const [storedRes] = await db.select(
      "support_ticket_messages",
      `ticket_id=eq.${ticketId}&select=*&order=created_at.asc`,
    );
    const storedMessages = Array.isArray(storedRes.body) ? storedRes.body : [];

    if (threadId) {
      try {
        const conv = await fetchConversation(env, threadId);
        const isStaffAuthor = (authorId) => isWhitelisted(env, authorId);
        discordMapped = conv.messages.map((m) => mapDiscordMessage(m, isStaffAuthor));
        hasMoreOlder = conv.hasMore;
      } catch (err) {
        console.error("[om-support] Failed to read conversation from Discord:", err);
        conversationUnavailable = true;
      }
    }

    // Discord messages have their own ids; stored notes/outbox have a separate
    // uuid space. To keep the UI's dedup (keyed by id) unambiguous, prefix ids.
    storedMapped = storedMessages.map((m) => ({
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
  }

  // Lazy auto-reopen: a user's latest reply to a resolved/closed ticket reopens
  // it (no gateway needed — checked when the ticket is opened/polled).
  if (!lazyLoading && threadId && !conversationUnavailable) {
    const reopened = await maybeLazyReopen(env, ticket).catch(() => false);
    if (reopened) ticket.status = "OPEN";
  }

  const messages = [...discordMapped, ...storedMapped].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at),
  );

  return json({
    ticket,
    messages,
    participants: participantsRes.body ?? [],
    audit: auditRes.body ?? [],
    conversationUnavailable,
    hasMoreOlder,
  });
}

// Initial load: newest window of the conversation, capped at MAX.
async function fetchConversation(env, threadId) {
  // Discord returns newest-first, max 100/page. Page backwards with `before`
  // until we've collected the window we want or run out of history.
  const all = [];
  let before;
  while (all.length < MAX_CONVERSATION_MESSAGES) {
    const page = await getMessages(env, threadId, { before, limit: 100 });
    if (!page.length) break;
    all.push(...page);
    before = page[page.length - 1].id; // oldest id on this page
    if (page.length < 100) break;
  }
  const slice = all.slice(0, MAX_CONVERSATION_MESSAGES);
  // If we stopped because we hit the cap (not because history ran out) there
  // is likely more older history to lazy-load.
  const hasMore = slice.length === MAX_CONVERSATION_MESSAGES;
  return { messages: slice.reverse(), hasMore }; // oldest-first
}

// Lazy-load: one page of messages OLDER than `before`, oldest-first.
async function fetchOlderPage(env, threadId, before, limit) {
  const page = await getMessages(env, threadId, { before, limit });
  // Discord returns these newest-first; reverse to oldest-first for prepend.
  const messages = page.reverse();
  const hasMore = page.length === limit;
  return { messages, hasMore };
}
