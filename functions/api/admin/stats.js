import { hasValidSession, json } from "./_session.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  if (!env.ADMIN_SESSION_SECRET || !(await hasValidSession(request, env.ADMIN_SESSION_SECRET))) {
    return json({ message: "Not authenticated." }, 401);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ message: "Stats backend is not configured." }, 503);
  }

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 90, 1), 365);

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/admin_dashboard_stats`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_days: days, p_top: 10 }),
  });
  if (!response.ok) return json({ message: "Could not load stats." }, 502);

  const stats = await response.json().catch(() => null);
  return json(stats ?? { live: null, allTimePeak: null, allTimePeakAt: null, daily: [], regions: [], mice: [] });
}
