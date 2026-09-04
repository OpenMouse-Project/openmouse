import { json, requireSession, canManageStaff } from "../../_session.js";
import { supabase } from "../../_supabase.js";

/**
 * POST /api/support/ticket/:id/participants
 * { action: "add"|"remove", discordId: string, name?: string }
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);
  // Participant management is limited to ADMIN/OWNER.
  if (!canManageStaff(session.role)) return json({ message: "Insufficient role." }, 403);

  const db = supabase(env);
  const ticketId = params.id;
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const discordId = body.discordId;
  if (!["add", "remove"].includes(action)) return json({ message: "Invalid action." }, 400);
  if (typeof discordId !== "string" || !discordId) return json({ message: "Invalid discord id." }, 400);

  if (action === "add") {
    await db.insert("support_ticket_participants", {
      ticket_id: ticketId,
      discord_id: discordId,
      discord_username: body.name ?? null,
      added_by: session.discordId,
    }).catch(() => undefined);
  } else {
    await db.remove("support_ticket_participants", `ticket_id=eq.${ticketId}&discord_id=eq.${discordId}`);
  }

  await db.insert("support_audit_log", {
    ticket_id: ticketId,
    actor_discord_id: session.discordId,
    actor_name: session.name,
    action: action === "add" ? "participant_added" : "participant_removed",
    metadata: { discordId },
  });

  return json({ ok: true });
}
