import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/feedback.js";

const payload = { content: "@everyone feedback", username: "Admin", avatar_url: "https://evil.test/a", tts: true, allowed_mentions: { parse: ["everyone"] }, embeds: [{ title: "Game request", description: "details", color: 42, fields: [{ name: "Game", value: "Example", inline: true }], footer: { text: "@user" } }] };
const env = { DISCORD_FEEDBACK_WEBHOOK: "https://discord.com/api/webhooks/fake/fake" };
for (const multipart of [false, true]) {
  test(`feedback rebuilds authority-safe ${multipart ? "multipart" : "JSON"} payload`, async () => {
    const original = globalThis.fetch;
    let sent: Request | undefined;
    globalThis.fetch = async (url, init) => { sent = new Request(url, { ...init, duplex: "half" } as RequestInit); return new Response(null, { status: 204 }); };
    try {
      const form = new FormData();
      form.set("payload_json", JSON.stringify(payload));
      form.set("files[0]", new Blob(["diagnostics"]), "report.txt");
      const request = new Request("https://example.test/api/feedback", multipart ? { method: "POST", body: form } : { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
      assert.equal((await onRequest({ request, env })).status, 200);
      assert.ok(sent);
      const sentForm = multipart ? await sent.formData() : null;
      const body = sentForm ? JSON.parse(String(sentForm.get("payload_json"))) : await sent.json();
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      for (const key of ["username", "avatar_url", "tts"]) assert.equal(key in body, false, key);
      assert.equal(body.content, payload.content);
      assert.deepEqual(body.embeds, payload.embeds);
      if (sentForm) assert.equal(await (sentForm.get("files[0]") as File).text(), "diagnostics");
    } finally { globalThis.fetch = original; }
  });
}

test("feedback rejects invalid schemas and multipart authority fields without sending", async () => {
  const original = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => { sends++; return new Response(null, { status: 204 }); };
  try {
    for (const value of [null, [], { embeds: "not-an-array" }, { embeds: [{ fields: [{ name: "x", value: 3 }] }] }, { content: "x".repeat(2001) }]) {
      const request = new Request("https://example.test/api/feedback", { method: "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" } });
      assert.equal((await onRequest({ request, env })).status, 400);
    }
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("payload_json", JSON.stringify(payload));
    assert.equal((await onRequest({ request: new Request("https://example.test/api/feedback", { method: "POST", body: form }), env })).status, 400);
    assert.equal(sends, 0);
  } finally { globalThis.fetch = original; }
});

test("feedback caps actual multipart bytes before form parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const request = new Request("https://example.test/api/feedback", { method: "POST", body, duplex: "half", headers: { "Content-Type": "multipart/form-data; boundary=fake" } } as RequestInit);
  assert.equal((await onRequest({ request, env })).status, 413);
  assert.equal(cancelled, true);
});

test("feedback bounds streamed bodies before JSON parsing or sending", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network denied"); };
  try {
    const request = new Request("https://example.test/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body: JSON.stringify({ content: "x".repeat(70 * 1024) }) });
    assert.equal((await onRequest({ request, env })).status, 413);
  } finally { globalThis.fetch = original; }
});
