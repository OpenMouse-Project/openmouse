const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "Origin not allowed." }, 403);

  const { requestId, turnstileToken } = await request.json().catch(() => ({}));
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || typeof turnstileToken !== "string" || !turnstileToken) return json({ message: "Invalid vote." }, 400);
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return json({ message: "Could not verify this voter." }, 400);
  if (!env.TURNSTILE_SECRET_KEY || !env.VOTER_HASH_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ message: "Voting protection is not configured." }, 503);
  }

  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken, remoteip: ip }),
  }).then((response) => response.json());
  if (!verification.success || verification.action !== "mouse-vote" || verification.hostname !== new URL(request.url).hostname) {
    return json({ message: "Anti-spam verification failed. Try again." }, 403);
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/cast_protected_mouse_vote`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_request_id: requestId, p_voter_hash: await hmac(ip, env.VOTER_HASH_SECRET) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const raw = detail.message ?? "";
    const message = /already voted/i.test(raw) ? "You already voted for this mouse."
      : /daily vote limit/i.test(raw) ? "Daily vote limit reached. Try again tomorrow."
      : "Could not record your vote.";
    return json({ message }, 409);
  }
  return json({ ok: true });
}
