import { json, requireSession } from "./_session.js";
import { supabase } from "./_supabase.js";

/**
 * GET /api/support/audit
 * Returns recent audit-log entries (across all tickets) with ticket numbers.
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const [res] = await db.select(
    "support_audit_log",
    `select=id,action,actor_name,metadata,created_at,ticket_id&order=created_at.desc&limit=${limit}`,
  );
  const items = Array.isArray(res.body) ? res.body : [];

  const withNumbers = await Promise.all(
    items.map(async (entry) => {
      if (!entry.ticket_id) return { ...entry, ticketNumber: null, ticketSubject: null };
      const [t] = await db.select("support_tickets", `id=eq.${entry.ticket_id}&select=public_number,subject`);
      const ticket = Array.isArray(t.body) ? t.body[0] : null;
      return { ...entry, ticketNumber: ticket?.public_number ?? null, ticketSubject: ticket?.subject ?? null };
    }),
  );

  return json({ audit: withNumbers });
}
