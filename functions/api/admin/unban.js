// Admin unban endpoint. Clears a permanent IP ban (and the counters that led
// to it) written by functions/_middleware.js.
//
// Auth: requires env.ADMIN_TOKEN and a matching bearer token. Fails closed when
// the secret is unset, so the route is inert until configured.
//
//   curl -X POST https://openmouse.app/api/admin/unban \
//     -H "Authorization: Bearer $ADMIN_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"ip":"203.0.113.7"}'
//
// Env:
//   ADMIN_TOKEN — shared secret (Pages dashboard → Settings → Environment
//                 variables); unset disables the route entirely.

import { isAdminRequest } from "../../_lib/admin.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  if (!isAdminRequest(request, env)) {
    return json({ message: "Unauthorized." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Expected a JSON body." }, 400);
  }

  const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
  if (!ip) return json({ message: "Missing ip." }, 400);

  const kv = env.SECURITY_KV;
  if (!kv) return json({ message: "Security storage is not configured." }, 503);

  const cleared = [];
  const remove = async (key) => {
    try {
      await kv.delete(key);
      cleared.push(key);
    } catch {
      /* Deleting a missing key is a no-op on real KV. */
    }
  };

  await remove(`ban:${ip}`);
  await remove(`strikes:${ip}`);

  // Wipe every artwork-rejection bucket for this IP so a near-threshold
  // spammer doesn't get re-banned by one more bad upload.
  try {
    if (typeof kv.list === "function") {
      const { keys } = await kv.list({ prefix: `artscreen:${ip}:` });
      for (const entry of keys ?? []) await remove(entry.name);
    }
  } catch {
    /* Best effort; the ban itself is already cleared. */
  }

  return json({ ok: true, ip, cleared });
}
