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

  // A JSON body here is one short string; cap the raw bytes before parsing so
  // oversized or streaming bodies fail cheaply instead of buffering forever.
  const MAX_BODY_BYTES = 1024;
  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ message: "Expected a JSON body." }, 400);
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ message: "Body too large." }, 413);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ message: "Expected a JSON body." }, 400);
  }

  const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
  // Strict literal validation: unbanning keys KV deletes, so a weird value
  // must not become a key prefix probe. IPv4 dotted quads and full/compact
  // IPv6 only; hostnames, CIDR, and zone ids are rejected.
  const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  // String-split group counting: at most 7 explicit groups with "::", exactly
  // 8 without. Rejects "1:2:3:4:5:6:7:8::" and other overlong literals.
  const isIPv6Literal = (value) => {
    const halves = value.split("::");
    if (halves.length > 2) return false;
    const groups = (part) => (part === "" ? [] : part.split(":"));
    const head = groups(halves[0]);
    const tail = halves.length === 2 ? groups(halves[1]) : [];
    if (![...head, ...tail].every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return false;
    return halves.length === 2 ? head.length + tail.length <= 7 : head.length === 8;
  };
  if (!IPV4.test(ip) && !isIPv6Literal(ip)) {
    return json({ message: "Missing ip." }, 400);
  }
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
