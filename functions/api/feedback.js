// Feedback relay to Discord. The webhook URL lives only in a Cloudflare
// Pages secret (env.DISCORD_FEEDBACK_WEBHOOK, set via the Pages dashboard →
// Settings → Environment variables → encrypt) — it never ships to the
// browser and never lives in this repository. The client's payload (the
// JSON embed, or the multipart form with the diagnostics attachment) is
// streamed straight to Discord.
//
// Cross-origin blocking and per-IP/global rate limiting are already handled
// site-wide by functions/_middleware.js (SECURITY_KV) before this ever runs,
// so this function only needs to relay the payload and fail closed if the
// webhook isn't configured.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  const webhook = env.DISCORD_FEEDBACK_WEBHOOK;
  if (!webhook || !webhook.startsWith("https://discord")) {
    return json({ message: "Feedback is not configured." }, 503);
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
      body: request.body,
    });
    if (!response.ok) {
      return json({ message: "Discord rejected the feedback." }, response.status);
    }
    return json({ ok: true });
  } catch {
    return json({ message: "Discord unreachable." }, 502);
  }
}
