const COOKIE_NAME = "om_license_session";

function readCookie(request, name) {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/license/")) return next();

  const sessionToken = readCookie(request, COOKIE_NAME);
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  let allowed = false;

  if (sessionToken && supabaseUrl && serviceKey) {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/validate_license_session`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_hash: await sha256(sessionToken) }),
    });
    if (response.ok) {
      const result = await response.json();
      allowed = result?.allowed === true;
    }
  }

  if (!allowed) {
    if (url.pathname.startsWith("/protected-assets/")) return new Response("Not found", { status: 404 });
    return Response.redirect(new URL("/control", url), 302);
  }

  const response = await next();
  const protectedResponse = new Response(response.body, response);
  protectedResponse.headers.set("Cache-Control", "private, no-store");
  protectedResponse.headers.set("X-Content-Type-Options", "nosniff");
  return protectedResponse;
}
