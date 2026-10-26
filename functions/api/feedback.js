import { boundedRequest, BodyTooLarge } from "../_lib/body-limit.js";
import { feedbackPayload } from "../_lib/feedback-payload.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "Origin not allowed." }, 403);
  let webhook;
  try { webhook = new URL(env.DISCORD_FEEDBACK_WEBHOOK); } catch { return json({ message: "Feedback is not configured." }, 503); }
  if (webhook.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(webhook.hostname) || !webhook.pathname.startsWith("/api/webhooks/")) return json({ message: "Feedback is not configured." }, 503);
  let body;
  let headers;
  try {
    const type = request.headers.get("Content-Type") ?? "";
    const multipart = /^multipart\/form-data(?:;|$)/i.test(type);
    if (!multipart && !/^application\/json(?:;|$)/i.test(type)) return json({ message: "Unsupported content type." }, 415);
    request = await boundedRequest(request, multipart ? 8 * 1024 * 1024 : 64 * 1024);
    if (multipart) {
      const input = await request.formData();
      const raw = input.getAll("payload_json");
      if (raw.length !== 1 || typeof raw[0] !== "string" || new TextEncoder().encode(raw[0]).length > 64 * 1024) throw new Error("Invalid payload_json");
      const payload = feedbackPayload(JSON.parse(raw[0]));
      const form = new FormData();
      const names = new Set();
      for (const [key, file] of input) {
        if (key === "payload_json") continue;
        if (!/^files\[[0-3]\]$/.test(key) || names.has(key) || typeof file === "string" || file.size > 2 * 1024 * 1024) throw new Error("Invalid attachment");
        names.add(key);
        form.append(key, file, file.name);
      }
      form.set("payload_json", JSON.stringify(payload));
      body = form;
    } else {
      body = JSON.stringify(feedbackPayload(await request.json()));
      headers = { "Content-Type": "application/json" };
    }
  } catch (error) {
    return json({ message: error instanceof BodyTooLarge ? "Feedback too large." : "Invalid feedback." }, error instanceof BodyTooLarge ? 413 : 400);
  }
  try {
    const response = await fetch(webhook.href, { method: "POST", headers, body });
    if (!response.ok) return json({ message: "Discord rejected the feedback." }, 502);
    return json({ ok: true });
  } catch {
    return json({ message: "Discord unreachable." }, 502);
  }
}
