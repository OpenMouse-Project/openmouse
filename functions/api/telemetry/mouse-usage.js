// Anonymous "this mouse model was connected" ping, fired once per session
// per model from the control app when a device connects. Feeds the admin
// dashboard's "most used mice" list — no session/device id is stored, only
// the model name and the day.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

// Keep this generous but bounded — model names come from the protocol's
// own device metadata (e.g. "Logitech G Pro X Superlight"), not free text.
const MODEL_RE = /^[\w][\w .+/()-]{0,79}$/;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "Origin not allowed." }, 403);

  const { mouseModel } = await request.json().catch(() => ({}));
  if (typeof mouseModel !== "string" || !MODEL_RE.test(mouseModel)) {
    return json({ message: "Invalid mouse model." }, 400);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false });

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/record_mouse_usage`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_mouse_model: mouseModel }),
  });
  return json({ ok: response.ok });
}
