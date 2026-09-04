import { json, requireSession } from "../../_session.js";
import { supabase } from "../../_supabase.js";

/**
 * POST /api/support/ticket/:id/note
 * { content: string }
 *
 * Adds an internal staff-only note. Stored in Supabase only, visibly distinct
 * from normal messages, and NEVER sent to Discord.
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return json({ message: "Note content is required." }, 400);
  if (content.length > 4000) return json({ message: "Note is too long (4000 max)." }, 400);

  const { response } = await db.insert("support_ticket_messages", {
    ticket_id: ticketId,
    discord_message_id: null,
    discord_channel_id: null,
    author_discord_id: session.discordId,
    author_name: session.name,
    content,
    message_type: "STAFF",
    source: "dashboard",
    staff_discord_id: session.discordId,
    is_internal_note: true,
    attachments: [],
  });

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: "internal_note",
    metadata: {},
  });

  await db
    .update("support_tickets", "id", ticketId, {
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .catch(() => undefined);

  return json({ ok: response.ok });
}
