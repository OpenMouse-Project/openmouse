const COOKIE_NAME = "om_license_session";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405, { Allow: "POST" });
  }
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json({ message: "License service is not configured." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Invalid request." }, 400);
  }
  const licenseCode = typeof body.licenseCode === "string" ? body.licenseCode.trim() : "";
  if (licenseCode.length < 12 || licenseCode.length > 200) {
    return json({ message: "Invalid license code." }, 400);
  }

  const sessionToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const sessionHash = await sha256(sessionToken);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/activate_license_session`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ license_key: licenseCode, session_hash: sessionHash }),
  });

  if (!response.ok) {
    return json({ message: "Invalid, expired, or disabled license code." }, 401);
  }
  const result = await response.json();
  const expiresAt = new Date(result.session_expires_at);
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const cookie = `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}
