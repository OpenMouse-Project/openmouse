import { json, requireSession, canManageStaff } from "./_session.js";
import { supabase } from "./_supabase.js";

/**
 * GET /api/support/staff
 * Returns the list of known staff members (for the assignee dropdown).
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const [res] = await db.select("support_staff", "select=discord_id,role,display_name,discord_username,last_login_at&order=role.asc");
  return json({ staff: res.body ?? [] });
}
