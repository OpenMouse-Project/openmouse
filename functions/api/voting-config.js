const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  if (!env.VITE_TURNSTILE_SITE_KEY) return json({ message: "Voting protection is not configured." }, 503);
  return json({ siteKey: env.VITE_TURNSTILE_SITE_KEY });
}
