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

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const input = await request.json().catch(() => ({}));
  const manufacturer = typeof input.manufacturer === "string" ? input.manufacturer.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const connection = typeof input.connection === "string" ? input.connection.trim() : "Not sure";
  if (!manufacturer || manufacturer.length > 80 || !model || model.length > 120 || connection.length > 80
    || typeof input.turnstileToken !== "string" || !input.turnstileToken) return json({ message: "Invalid mouse request." }, 400);

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return json({ message: "Could not verify this requester." }, 400);
  if (!env.TURNSTILE_SECRET_KEY || !env.VOTER_HASH_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ message: "Request protection is not configured." }, 503);
  }

  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: input.turnstileToken, remoteip: ip }),
  }).then((response) => response.json());
  if (!verification.success || verification.action !== "mouse-vote" || verification.hostname !== requestUrl.hostname) {
    return json({ message: "Anti-spam verification failed. Try again." }, 403);
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/cast_protected_mouse_request`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_manufacturer: manufacturer,
      p_model: model,
      p_connection: connection || "Not sure",
      p_voter_hash: await hmac(ip, env.VOTER_HASH_SECRET),
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const raw = detail.message ?? "";
    console.error("Protected mouse request RPC failed", { status: response.status, code: detail.code, message: raw });
    const message = /request limit/i.test(raw) ? "Request limit reached. Try again next week."
      : /already voted/i.test(raw) ? "That mouse is already listed and you already voted for it."
      : /daily vote limit/i.test(raw) ? "Daily vote limit reached. Try again tomorrow."
      : detail.code === "42702" ? `Database query is ambiguous: ${raw}`
      : detail.code === "PGRST202" ? "Protected request database migration is not installed."
      : detail.code === "42883" ? "Protected voting database migration is not installed."
      : "Could not save this request.";
    return json({ message, code: detail.code ?? "REQUEST_REJECTED" }, detail.code === "PGRST202" || detail.code === "42883" ? 503 : 409);
  }
  const rows = await response.json();
  if (!rows[0]) return json({ message: "The request was accepted but no record was returned." }, 502);
  return json(rows[0]);
}
