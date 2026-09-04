import { json, requireSession } from "./_session.js";

/** GET /api/support/me — returns the current session (identity + role) or 401. */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);
  return json(session);
}
