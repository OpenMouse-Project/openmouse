// Creates a Stripe Checkout Session for a donation and hands the browser
// its redirect URL. The amount is priced ad hoc via `price_data` at
// session-creation time -- no pre-built Stripe Product/Price catalog to
// maintain, the amount comes straight from whatever the donor picked on
// /donate.html. STRIPE_SECRET_KEY lives only as a Cloudflare environment
// secret, never sent to the browser.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100_000; // sanity ceiling, not a real limit on generosity

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  if (!env.STRIPE_SECRET_KEY) return json({ message: "Payments are not configured." }, 503);

  const { type, amount } = await request.json().catch(() => ({}));
  if (type !== "once" && type !== "monthly") return json({ message: "Invalid donation type." }, 400);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return json({ message: "Invalid amount." }, 400);
  }

  const unitAmountCents = Math.round(amount * 100);
  const donateUrl = `${requestUrl.origin}/donate.html`;

  const params = new URLSearchParams({
    mode: type === "monthly" ? "subscription" : "payment",
    success_url: `${donateUrl}?donated=1`,
    cancel_url: donateUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(unitAmountCents),
    "line_items[0][price_data][product_data][name]":
      type === "monthly" ? "OpenMouse monthly donation" : "OpenMouse donation",
  });
  if (type === "monthly") {
    params.set("line_items[0][price_data][recurring][interval]", "month");
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    return json({ message: error?.error?.message ?? "Could not start checkout." }, 502);
  }

  const session = await response.json();
  if (typeof session.url !== "string") return json({ message: "Could not start checkout." }, 502);

  return json({ url: session.url });
}
